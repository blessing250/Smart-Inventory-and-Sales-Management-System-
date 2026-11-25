package com.bizflowjewelry.backend.procurement;

import java.net.URI;
import java.net.http.*;
import java.sql.DriverManager;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="BIZFLOW_FOUNDATION_TEST",matches="1")
@EnabledIfEnvironmentVariable(named="BIZFLOW_FOUNDATION_DATABASE",matches="bizflow_foundation_test_[a-z0-9]+")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
class ProcurementPostgresTest {
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired ObjectMapper json;
    @Autowired Environment env;
    @Autowired JwtEncoder encoder;
    private final UUID session=UUID.randomUUID();
    private final String product=UUID.randomUUID().toString();
    private String owner, token, supplier, agent;
    private boolean createdOwner;
    private HttpClient http;

    @BeforeEach
    void fixture() throws Exception {
        assertTrue(db.sql("SELECT success FROM bizflow_foundation.flyway_schema_history WHERE version='5'").query(Boolean.class).single());
        owner=db.sql("SELECT id FROM bizflow_foundation.owner_accounts").query(String.class).optional().orElse(null);
        createdOwner=owner==null;
        if(createdOwner){
            owner=UUID.randomUUID().toString();
            db.sql("""
                    INSERT INTO bizflow_foundation.owner_accounts(id,email,display_name,password_hash)
                    VALUES (?,'procurement-fixture@example.test','Procurement fixture','fixture-no-login')
                    """).param(owner).update();
        }
        var expiry=Instant.now().plusSeconds(600);
        db.sql("INSERT INTO bizflow_foundation.owner_sessions(id,owner_id,expires_at) VALUES (?,?,?)")
                .params(session,owner,Timestamp.from(expiry)).update();
        token=issue(expiry);
        db.sql("""
                INSERT INTO bizflow_foundation.catalog_products(id,sku,name,category,selling_price,estimated_unit_cost,reorder_threshold)
                VALUES (?,'PROC-FIXTURE','Fixture ring','Jewelry',1000,1,0)
                """).param(product).update();
        http=HttpClient.newHttpClient();
        supplier=id(call("POST","/procurement-contacts",Map.of("kind","SUPPLIER","name","Fixture supplier"),201));
        agent=id(call("POST","/procurement-contacts",Map.of("kind","AGENT","name","Fixture carrier"),201));
    }

    @AfterEach
    void clearDisposableFixture() {
        if(http!=null)http.close();
        db.sql("""
                TRUNCATE bizflow_foundation.discrepancy_resolutions,bizflow_foundation.discrepancy_claims,
                  bizflow_foundation.supplier_payment_allocations,bizflow_foundation.shipment_payment_allocations,
                  bizflow_foundation.procurement_receipt_correction_moves,bizflow_foundation.procurement_receipt_corrections,
                  bizflow_foundation.procurement_receipt_lines,bizflow_foundation.procurement_receipts,
                  bizflow_foundation.procurement_charges,bizflow_foundation.procurement_manifest_lines,
                  bizflow_foundation.procurement_shipments,bizflow_foundation.procurement_lines,
                  bizflow_foundation.procurement_orders,bizflow_foundation.procurement_contacts,bizflow_foundation.procurement_audit,
                  bizflow_foundation.online_order_items,bizflow_foundation.online_orders,bizflow_foundation.sale_returns,
                  bizflow_foundation.sale_payments,bizflow_foundation.sale_items,bizflow_foundation.retail_sales,
                  bizflow_foundation.customers,bizflow_foundation.sales_audit,
                  bizflow_foundation.inventory_counts,bizflow_foundation.inventory_movements,bizflow_foundation.inventory_balances
                """).update();
        db.sql("DELETE FROM bizflow_foundation.catalog_products WHERE id=?").param(product).update();
        db.sql("DELETE FROM bizflow_foundation.owner_sessions WHERE id=?").param(session).update();
        if(createdOwner) db.sql("DELETE FROM bizflow_foundation.owner_accounts WHERE id=?").param(owner).update();
    }

    @Test
    void correctionReversesLedgerAndReopensManifestExactlyOnce() throws Exception {
        var order=call("POST","/purchases",order("correct-order","RWF",1_000_000,List.of(item(product,2,200))),201);
        String line=lineWithQuantity(order,2);
        String id=shipment("correct-manifest",List.of(plan(line,2)));
        String base="/shipments/"+id;
        call("PUT",base+"/charges",charges("QUANTITY",20),200);
        var event=call("POST",base+"/receipts",receipt("original",List.of(received(line,2,0,0))),200);
        String receipt=id(event.get("receipt"));
        String path=base+"/receipts/"+receipt+"/correction";
        var command=Map.of("reference","correct-one","reason","Confirmed count was incorrect");
        var both=race(path,command,command);
        assertTrue(both.stream().allMatch(response->response.statusCode()==200),both.toString());
        assertEquals(0,balance().get("quantity").asLong());
        assertTrue(call("GET",base+"/receipts/"+receipt,null,200).get("receipt").get("corrected").asBoolean());
        assertEquals(2,call("GET",base+"/reconciliation",null,200).get("outstanding").asLong());
        call("PUT",base+"/charges",charges("QUANTITY",30),200);
        var replacement=call("POST",base+"/receipts",receipt("replacement",List.of(received(line,2,0,0))),200);
        String customer=id(call("POST","/customers",Map.of("name","Correction test customer"),201));
        call("POST","/sales",Map.of("reference","later-sale","date","2026-01-04","channel","Physical shop","customerId",customer,
                "items",List.of(Map.of("productId",product,"quantity",1))),200);
        call("POST",base+"/receipts/"+id(replacement.get("receipt"))+"/correction",Map.of("reference","too-late","reason","Review"),409);
        assertEquals(215,balance().get("valueRwf").asLong());
    }

    @Test
    void partialReceiptsPreserveCostsAndOnlyUsableStock() throws Exception {
        var input=order("purchase-a","USD",150_000_000,List.of(item(product,6,101),item(product,1,0)));
        call("POST","/purchases",order("bad-supplier","RWF",1_000_000,List.of(item(product,1,100)),agent),400);
        call("POST","/purchases",order("bad-product","RWF",1_000_000,List.of(item("missing",1,100))),400);
        call("POST","/purchases",order("bad-rate","RWF",2_000_000,List.of(item(product,1,100))),400);
        var purchase=call("POST","/purchases",input,201);
        assertEquals(909,purchase.get("order").get("totalRwf").asLong());
        assertEquals(150_000_000,purchase.get("order").get("rateMicros").asLong());
        assertEquals(2,purchase.get("lines").size());
        String a=lineWithQuantity(purchase,6);
        String b=lineWithQuantity(call("POST","/purchases",order("purchase-b","CNY",20_000_000,List.of(item(product,2,200))),201),2);
        String shipment=shipment("tracking-one",List.of(plan(a,4),plan(b,2)));
        String second=shipment("tracking-two",List.of(plan(a,2)));
        assertEquals(0,balance().get("quantity").asLong());
        assertEquals(0,balance().get("valueRwf").asLong());
        call("POST","/shipments",manifest("overbooked",List.of(plan(a,1))),409);
        call("PUT","/shipments/"+shipment+"/charges",charges("QUANTITY",101),200);
        String path="/shipments/"+shipment+"/receipts";
        var good=receipt("first",List.of(received(a,2,0,0)));
        var first=call("POST",path,good,200);
        assertEquals(first,call("POST",path,good,200));
        call("POST",path,receipt("first",List.of(received(a,1,0,0))),409);
        call("POST",path,receipt("too-many",List.of(received(a,3,0,0))),409);
        call("PUT","/shipments/"+shipment+"/charges",charges("QUANTITY",102),409);
        call("PUT","/shipments/"+shipment+"/manifest",Map.of("lines",List.of(plan(a,1))),409);
        assertEquals(337,balance().get("valueRwf").asLong());
        call("POST",path,receipt("second",List.of(received(a,1,0,1),received(b,1,1,0))),200);
        var result=call("GET","/shipments/"+shipment+"/reconciliation",null,200);
        assertTrue(result.get("matches").asBoolean());
        assertEquals(101,result.get("allocatedRwf").asLong());
        assertEquals(67,result.get("capitalizedChargeRwf").asLong());
        assertEquals(34,result.get("heldChargeRwf").asLong());
        assertEquals(562,result.get("landedRwf").asLong());
        assertEquals(562,balance().get("valueRwf").asLong());
        assertEquals(4,balance().get("quantity").asLong());
        assertEquals(2,call("GET",path,null,200).get("total").asInt());
        assertEquals(first,call("GET",path+"/"+id(first.get("receipt")),null,200));
        call("PUT","/shipments/"+second+"/charges",charges("VALUE",0),200);
        call("POST","/shipments/"+second+"/receipts",receipt("third",List.of(received(a,2,0,0))),200);
        assertEquals(865,balance().get("valueRwf").asLong());
        var order=call("GET","/purchases/"+id(purchase.get("order")),null,200);
        var receivedLine=findLine(order,a);
        assertEquals(5,receivedLine.get("usable").asLong());
        assertEquals(1,receivedLine.get("missing").asLong());
        assertEquals(1,receivedLine.get("outstanding").asLong());
        assertEquals(150_000_000,order.get("order").get("rateMicros").asLong());
        assertEquals(1,call("GET","/purchases?status=PARTIAL&q=purchase-a",null,200).get("total").asInt());
        assertEquals(2,call("GET","/shipments?status=RECEIVED",null,200).get("total").asInt());
        assertTrue(call("GET","/inventory/products/"+product+"/reconciliation",null,200).get("matches").asBoolean());
        try(var connection=DriverManager.getConnection(env.getRequiredProperty("spring.datasource.url"),
                env.getRequiredProperty("spring.datasource.username"),env.getRequiredProperty("spring.datasource.password"));
                var statement=connection.prepareStatement("SELECT count(*) FROM bizflow_foundation.procurement_receipts");
                var rows=statement.executeQuery()) {
            assertTrue(rows.next());
            assertEquals(3,rows.getInt(1));
        }
    }

    @Test
    void serializesReservationsAndReceiptsAndRollsBackAMultiLineFailure() throws Exception {
        assertEquals(401,send("GET","/purchases",null,null).statusCode());
        assertEquals(401,send("GET","/shipments",null,issue(Instant.now().minusSeconds(1))).statusCode());
        String a=lineWithQuantity(call("POST","/purchases",order("value-a","RWF",1_000_000,List.of(item(product,2,100))),201),2);
        String b=lineWithQuantity(call("POST","/purchases",order("value-b","RWF",1_000_000,List.of(item(product,1,300))),201),1);
        var plans=List.of(plan(a,2),plan(b,1));
        var reservations=race("/shipments",manifest("race-plan-a",plans),manifest("race-plan-b",plans));
        assertEquals(List.of(201,409),reservations.stream().map(HttpResponse::statusCode).sorted().toList());
        String reserved=id(json.readTree(reservations.stream().filter(r->r.statusCode()==201).findFirst().orElseThrow().body()).get("shipment"));
        call("PUT","/shipments/"+reserved+"/manifest",Map.of("lines",List.of(plan(a,1))),200);
        String released=shipment("released",List.of(plan(a,1),plan(b,1)));
        call("POST","/shipments/"+released+"/cancel",null,200);
        call("POST","/shipments/"+reserved+"/cancel",null,200);
        String shipment=shipment("confirmed",plans);
        String base="/shipments/"+shipment;
        call("PUT",base+"/charges",charges("VALUE",101),200);
        boolean aFirst=a.compareTo(b)<0;
        call("POST",base+"/receipts",receipt("rollback",List.of(received(a,aFirst?1:3,0,0),received(b,aFirst?2:1,0,0))),409);
        assertEquals(0,balance().get("quantity").asLong());
        assertEquals(0,call("GET",base+"/receipts",null,200).get("total").asInt());
        var lines=List.of(received(a,2,0,0),received(b,1,0,0));
        var events=race(base+"/receipts",receipt("race-receipt-a",lines),receipt("race-receipt-b",lines));
        assertEquals(List.of(200,409),events.stream().map(HttpResponse::statusCode).sorted().toList());
        var event=json.readTree(events.stream().filter(r->r.statusCode()==200).findFirst().orElseThrow().body());
        assertEquals(40,findLine(event,a).get("allocatedRwf").asLong());
        assertEquals(61,findLine(event,b).get("allocatedRwf").asLong());
        assertEquals(601,balance().get("valueRwf").asLong());
        db.sql("UPDATE bizflow_foundation.owner_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").param(session).update();
        call("GET",base,null,401);
    }

    private List<HttpResponse<String>> race(String path,Object first,Object second) {
        var a=http.sendAsync(request("POST",path,first,token),HttpResponse.BodyHandlers.ofString());
        var b=http.sendAsync(request("POST",path,second,token),HttpResponse.BodyHandlers.ofString());
        return List.of(a.join(),b.join());
    }
    private String shipment(String tracking,List<?> lines) throws Exception {
        return id(call("POST","/shipments",manifest(tracking,lines),201).get("shipment"));
    }
    private Map<String,?> manifest(String tracking,List<?> lines) {
        return Map.of("tracking",tracking,"agentId",agent,"plannedDate","2026-01-02","lines",lines);
    }
    private Map<String,?> order(String ref,String currency,long rate,List<?> lines) {return order(ref,currency,rate,lines,supplier);}
    private Map<String,?> order(String ref,String currency,long rate,List<?> lines,String supplierId) {
        return Map.of("reference",ref,"supplierId",supplierId,"date","2026-01-01","currency",currency,"rateMicros",rate,"lines",lines);
    }
    private Map<String,?> item(String id,int quantity,long unit) {return Map.of("productId",id,"quantity",quantity,"unitMinor",unit);}
    private Map<String,?> plan(String id,int quantity) {return Map.of("lineId",id,"quantity",quantity);}
    private Map<String,?> received(String id,int usable,int damaged,int missing) {
        return Map.of("lineId",id,"usable",usable,"damaged",damaged,"missing",missing,"explanation","Fixture inspected");
    }
    private Map<String,?> receipt(String reference,List<?> lines) {return Map.of("reference",reference,"date","2026-01-03","lines",lines);}
    private Map<String,?> charges(String method,long amount) {return Map.of("allocation",method,"shipping",amount,"customs",0,"clearing",0,"other",0);}
    private JsonNode balance() throws Exception {return call("GET","/inventory/products/"+product+"/balance",null,200);}
    private static String id(JsonNode node){return node.get("id").asString();}
    private static String lineWithQuantity(JsonNode node,int quantity) {
        for(var line:node.get("lines")) if(line.get("ordered").asInt()==quantity)return id(line);
        throw new AssertionError("Fixture purchase line missing.");
    }
    private static JsonNode findLine(JsonNode node,String id) {
        for(var line:node.get("lines")) if(id.equals(line.has("lineId")?line.get("lineId").asString():line.get("id").asString()))return line;
        throw new AssertionError("Fixture result line missing.");
    }
    private String issue(Instant expires) {
        var claims=JwtClaimsSet.builder().issuer(env.getRequiredProperty("bizflow.auth.issuer"))
                .audience(List.of(env.getRequiredProperty("bizflow.auth.audience"))).subject(owner).id(session.toString())
                .issuedAt(Instant.now().minusSeconds(60)).expiresAt(expires).claim("role","OWNER").build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),claims)).getTokenValue();
    }
    private JsonNode call(String method,String path,Object body,int status) throws Exception {
        var response=send(method,path,body,token);
        assertEquals(status,response.statusCode(),method+" "+path);
        return json.readTree(response.body());
    }
    private HttpResponse<String> send(String method,String path,Object body,String bearer) throws Exception {
        return http.send(request(method,path,body,bearer),HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest request(String method,String path,Object body,String bearer) {
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+path));
        if(bearer!=null)request.header("Authorization","Bearer "+bearer);
        if(body==null)return request.method(method,HttpRequest.BodyPublishers.noBody()).build();
        return request.header("Content-Type","application/json").method(method,HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
    }
}
