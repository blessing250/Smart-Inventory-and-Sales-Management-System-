package com.bizflowjewelry.backend.sales;

import java.net.URI;
import java.net.http.*;
import java.sql.DriverManager;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
class SalesPostgresTest {
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired ObjectMapper json;
    @Autowired Environment env;
    @Autowired JwtEncoder encoder;
    private final UUID session = UUID.randomUUID();
    private final String product = UUID.randomUUID().toString();
    private final String second = UUID.randomUUID().toString();
    private String owner, token, customer, cash, bank, mobile;
    private boolean createdOwner;
    private HttpClient http;

    @BeforeEach
    void fixture() throws Exception {
        assertTrue(db.sql("SELECT success FROM bizflow_foundation.flyway_schema_history WHERE version='6'").query(Boolean.class).single());
        owner = db.sql("SELECT id FROM bizflow_foundation.owner_accounts").query(String.class).optional().orElse(null);
        createdOwner = owner == null;
        if (createdOwner) {
            owner = UUID.randomUUID().toString();
            db.sql("""
                    INSERT INTO bizflow_foundation.owner_accounts(id,email,display_name,password_hash)
                    VALUES (?,'sales-fixture@example.test','Sales fixture','fixture-no-login')
                    """).param(owner).update();
        }
        Instant expiry = Instant.now().plusSeconds(600);
        db.sql("INSERT INTO bizflow_foundation.owner_sessions(id,owner_id,expires_at) VALUES (?,?,?)")
                .params(session,owner,Timestamp.from(expiry)).update();
        token = issue(expiry);
        http = HttpClient.newHttpClient();
        seedProduct(product,"SALE-A",101);
        seedProduct(second,"SALE-B",202);
        cash = id(call("POST","/financial-accounts",Map.of("name","Till","kind","CASH","openingRwf",100),201));
        bank = id(call("POST","/financial-accounts",Map.of("name","Bank","kind","BANK"),201));
        mobile = id(call("POST","/financial-accounts",Map.of("name","Mobile","kind","MOBILE_MONEY"),201));
        customer = id(call("POST","/customers",Map.of("name","Fixture customer","phone","5550100"),201));
    }

    @AfterEach
    void clearDisposableFixture() {
        if (http!=null) http.close();
        db.sql("""
                TRUNCATE bizflow_foundation.online_order_items, bizflow_foundation.online_orders,
                  bizflow_foundation.sale_returns, bizflow_foundation.sale_payments, bizflow_foundation.sale_items,
                  bizflow_foundation.retail_sales, bizflow_foundation.customers, bizflow_foundation.sales_audit,
                  bizflow_foundation.discrepancy_resolutions,bizflow_foundation.discrepancy_claims,
                  bizflow_foundation.operating_expense_receipts,bizflow_foundation.operating_expenses,
                  bizflow_foundation.supplier_payment_allocations,bizflow_foundation.shipment_payment_allocations,bizflow_foundation.finance_audit,
                  bizflow_foundation.financial_postings, bizflow_foundation.financial_accounts,
                  bizflow_foundation.procurement_receipt_correction_moves,bizflow_foundation.procurement_receipt_corrections,
                  bizflow_foundation.procurement_receipt_lines,bizflow_foundation.procurement_receipts,
                  bizflow_foundation.procurement_charges,bizflow_foundation.procurement_manifest_lines,bizflow_foundation.procurement_shipments,
                  bizflow_foundation.procurement_lines,bizflow_foundation.procurement_orders,bizflow_foundation.procurement_contacts,
                  bizflow_foundation.procurement_audit,bizflow_foundation.inventory_counts,
                  bizflow_foundation.inventory_movements, bizflow_foundation.inventory_balances
                """).update();
        db.sql("DELETE FROM bizflow_foundation.catalog_audit WHERE product_id IN (?,?)").params(product,second).update();
        db.sql("DELETE FROM bizflow_foundation.catalog_products WHERE id IN (?,?)").params(product,second).update();
        db.sql("DELETE FROM bizflow_foundation.owner_sessions WHERE id=?").param(session).update();
        if (createdOwner) db.sql("DELETE FROM bizflow_foundation.owner_accounts WHERE id=?").param(owner).update();
    }

    @Test
    void nativeExchangeAndReversalPreserveBothMinorLegs() throws Exception {
        var usd=call("POST","/financial-accounts/native",Map.of("name","USD reserve","kind","BANK","currency","USD",
                "openingMinor",1000,"rwfRateMicros",150_000_000),201);
        var cny=call("POST","/financial-accounts/native",Map.of("name","CNY reserve","kind","BANK","currency","CNY"),201);
        var exchange=Map.of("reference","exchange-fixture","fromAccount",id(usd),"toAccount",id(cny),"sourceMinor",200,
                "destinationMinor",1400,"feeMinor",25,"rwfRateMicros",150_000_000,"exchangeRateMicros",7_000_000);
        var first=call("POST","/finance/exchanges",exchange,200);
        assertEquals(first,call("POST","/finance/exchanges",exchange,200));
        assertEquals(300,number(first,"amountRwf"));
        assertEquals(38,number(first,"feeRwf"));
        assertEquals(775,number(call("GET","/financial-accounts/"+id(usd)+"/native-reconciliation",null,200),"balanceMinor"));
        assertEquals(1400,number(call("GET","/financial-accounts/"+id(cny)+"/native-reconciliation",null,200),"balanceMinor"));
        reversePosting(id(first),"undo-exchange");
        assertEquals(1000,number(call("GET","/financial-accounts/"+id(usd),null,200),"balanceMinor"));
        assertEquals(0,number(call("GET","/financial-accounts/"+id(cny),null,200),"balanceMinor"));
    }

    @Test
    void nativeSupplierSettlementUsesCapturedPurchaseAndActualSettlementRates() throws Exception {
        var usd=call("POST","/financial-accounts/native",Map.of("name","Supplier USD","kind","BANK","currency","USD",
                "openingMinor",1000,"rwfRateMicros",150_000_000),201);
        String supplier=contact("SUPPLIER","USD vendor");
        String purchase=id(purchase(supplier,"native-order","USD",150_000_000,2,100).get("order"));
        String path="/suppliers/"+supplier;
        var body=Map.of("accountId",id(usd),"reference","native-settlement","rwfRateMicros",175_000_000,"allocations",
                List.of(Map.of("purchaseId",purchase,"amountRwf",175,"sourceMinor",100,"payableMinor",100)));
        var result=call("POST",path+"/payments",body,200);
        assertEquals(900,number(call("GET","/financial-accounts/"+id(usd),null,200),"balanceMinor"));
        assertEquals(150,number(obligation(path,purchase),"outstandingRwf"));
        assertEquals(25,number(result.get("allocations").get(0),"fxLossRwf"));
        reversePosting(id(result.get("posting")),"native-pay-reversed");
        assertEquals(1000,number(call("GET","/financial-accounts/"+id(usd),null,200),"balanceMinor"));
        assertEquals(300,number(obligation(path,purchase),"outstandingRwf"));
        assertTrue(call("GET","/finance/reconciliation",null,200).get("matches").asBoolean());
    }

    @Test
    void filteredSalesReportsReconcileWithSpreadsheetAndPdf() throws Exception {
        opening(product,2,101);
        var sale=call("POST","/sales",checkout("report-sale",customer,List.of(line(product,1,1)),List.of()),200);
        String route="/reports/sales";
        String filters="group=week&from=2026-01-01&to=2026-01-01";
        var report=call("GET",route+"?"+filters,null,200);
        assertEquals(1,number(report,"total"));
        assertEquals(100,number(report.get("totals"),"revenue_rwf"));
        assertEquals(49,number(report.get("totals"),"gross_profit_rwf"));
        var trend=call("GET","/reports/dashboard?from=2026-01-01&to=2026-01-01",null,200);
        assertEquals(49,number(trend.get(0),"gross_profit_rwf"));
        for(String kind:List.of("receivables","payables","expenses","accounts","transactions","settlements","inventory","movements","purchases","receipts","discrepancies")) {
            call("GET","/reports/"+kind,null,200);
        }
        var xlsx=http.send(request("GET",route+"/export?format=xlsx&"+filters,null,token),HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200,xlsx.statusCode());
        try(var workbook=new org.apache.poi.xssf.usermodel.XSSFWorkbook(new java.io.ByteArrayInputStream(xlsx.body()))) {
            assertEquals(100,workbook.getSheetAt(0).getRow(4).getCell(2).getNumericCellValue());
            assertEquals(49,workbook.getSheetAt(0).getRow(5).getCell(4).getNumericCellValue());
        }
        var pdf=http.send(request("GET",route+"/export?format=pdf&"+filters,null,token),HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200,pdf.statusCode());
        try(var document=org.apache.pdfbox.Loader.loadPDF(pdf.body())) {
            String content=new org.apache.pdfbox.text.PDFTextStripper().getText(document);
            assertTrue(content.contains("100") && content.contains("49") && content.contains("Page 1 of 1"));
        }
        String receiptPath="/reports/sale-receipt/"+id(sale.get("sale"))+"/export?format=pdf";
        var receipt=http.send(request("GET",receiptPath,null,token),HttpResponse.BodyHandlers.ofByteArray());
        assertEquals(200,receipt.statusCode());
        try(var document=org.apache.pdfbox.Loader.loadPDF(receipt.body())) {
            String content=new org.apache.pdfbox.text.PDFTextStripper().getText(document);
            assertTrue(content.contains("Balance due") && content.contains("100"));
        }
    }

    @Test
    void expensesCanSaveWithoutReceiptsAndReconcileAfterReversal() throws Exception {
        assertEquals(401,send("GET","/expenses",null,null).statusCode());
        assertEquals(401,send("GET","/finance/reconciliation",null,issue(Instant.now().minusSeconds(1))).statusCode());
        var basic=Map.of("amountRwf",20,"categoryId","rent","accountId",cash);
        var one=call("POST","/expenses",basic,200);
        assertEquals(0,number(one,"receiptCount"));
        var example=Map.of("amountRwf",15,"categoryId","rent","accountId",cash,"reference","rent-extra","receiptReference","paper-123",
                "description","Storage rental","date","2026-01-03");
        var expense=call("POST","/expenses",example,200);
        assertEquals(expense,call("POST","/expenses",example,200));
        assertEquals(65,accountBalance(cash));
        assertEquals(1,number(call("GET","/expenses?q=paper-123&categoryId=rent&accountId="+cash+"&from=2026-01-03&to=2026-01-03",null,200),"total"));
        assertEquals(35,number(call("GET","/expenses/category-totals?categoryId=rent",null,200).get(0),"amountRwf"));
        String boundary="bizflow-receipt-boundary";
        String multipart="--"+boundary+"\r\nContent-Disposition: form-data; name=\"receipt\"; filename=\"rent.pdf\"\r\n"
                +"Content-Type: application/pdf\r\n\r\n%PDF-1.7\n%%EOF\r\n--"+boundary+"--\r\n";
        String path="/expenses/"+id(one)+"/receipts";
        var attachment=http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+path))
                .header("Authorization","Bearer "+token).header("Content-Type","multipart/form-data; boundary="+boundary)
                .POST(HttpRequest.BodyPublishers.ofString(multipart)).build(),HttpResponse.BodyHandlers.ofString());
        assertEquals(200,attachment.statusCode(),attachment.body());
        assertEquals(1,call("GET",path,null,200).size());
        assertEquals(200,send("GET",path+"/"+id(json.readTree(attachment.body())),null,token).statusCode());
        reversePosting(id(expense),"expense-reversal");
        assertEquals(80,accountBalance(cash));
        assertEquals(20,number(call("GET","/expenses/category-totals?categoryId=rent",null,200).get(0),"amountRwf"));
        assertTrue(call("GET","/finance/reconciliation",null,200).get("matches").asBoolean());
    }

    @Test
    void transfersSerializeReverseAtomicallyAndRespectArchivedAccounts() throws Exception {
        call("PATCH","/financial-accounts/"+bank,Map.of("name","Updated bank"),200);
        String path="/finance/transfers";
        var first=transfer("transfer-a",cash,bank,70);
        var blocked=transfer("transfer-b",cash,bank,70);
        var a=http.sendAsync(request("POST",path,first,token),HttpResponse.BodyHandlers.ofString());
        var b=http.sendAsync(request("POST",path,blocked,token),HttpResponse.BodyHandlers.ofString());
        assertEquals(List.of(200,409),List.of(a.join().statusCode(),b.join().statusCode()).stream().sorted().toList());
        var winner=a.join().statusCode()==200?a.join():b.join();
        assertEquals(30,accountBalance(cash));
        assertEquals(70,accountBalance(bank));
        call("POST","/financial-accounts/"+bank+"/archive",null,409);
        reversePosting(id(json.readTree(winner.body())),"transfer-reversal");
        assertEquals(100,accountBalance(cash));
        assertEquals(0,accountBalance(bank));
        call("POST","/financial-accounts/"+bank+"/archive",null,200);
        call("POST",path,transfer("archived",cash,bank,10),400);
        assertEquals(100,accountBalance(cash));
        assertTrue(call("GET","/finance/reconciliation",null,200).get("matches").asBoolean());
    }

    @Test
    void supplierPaymentAllocatesCashAndReleasesCapturedForeignPayables() throws Exception {
        String source=financeAccount("Purchasing",1000);
        String supplier=contact("SUPPLIER","Supplier");
        var rwf=purchase(supplier,"rwf-order","RWF",1_000_000,2,100);
        var usd=purchase(supplier,"usd-order","USD",150_000_000,2,100);
        String idRwf=id(rwf.get("order"));
        String idUsd=id(usd.get("order"));
        String base="/suppliers/"+supplier;
        var payment=Map.of("accountId",source,"reference","mixed-supplier","allocations",List.of(
                Map.of("purchaseId",idRwf,"amountRwf",100),
                Map.of("purchaseId",idUsd,"amountRwf",160,"payableMinor",100)));
        var posted=call("POST",base+"/payments",payment,200);
        assertEquals(2,posted.get("allocations").size());
        assertEquals(posted,call("POST",base+"/payments",payment,200));
        assertEquals(740,accountBalance(source));
        assertEquals(150,number(obligation(base,idUsd),"outstandingRwf"));
        assertEquals(100,number(obligation(base,idUsd),"outstandingMinor"));
        assertEquals(100,number(obligation(base,idRwf),"outstandingRwf"));
        call("POST",base+"/payments",Map.of("accountId",source,"reference","too-much","allocations",
                List.of(Map.of("purchaseId",idRwf,"amountRwf",101))),409);
        call("POST","/purchases/"+idRwf+"/cancel",null,409);
        reversePosting(id(posted.get("posting")),"supplier-reversal");
        assertEquals(1000,accountBalance(source));
        assertEquals(300,number(obligation(base,idUsd),"outstandingRwf"));
        assertTrue(call("GET","/finance/reconciliation",null,200).get("matches").asBoolean());
    }

    @Test
    void shipmentPaymentsAndDiscrepanciesDoNotPostLandedCostAgain() throws Exception {
        String source=financeAccount("Shipment bank",1000);
        String supplier=contact("SUPPLIER","Vendor");
        String agent=contact("AGENT","Carrier");
        var order=purchase(supplier,"shipment-order","RWF",1_000_000,4,100);
        String item=id(order.get("lines").get(0));
        var shipped=call("POST","/shipments",Map.of("tracking","shipment","agentId",agent,"plannedDate","2026-01-01",
                "lines",List.of(Map.of("lineId",item,"quantity",4))),201);
        String base="/shipments/"+id(shipped.get("shipment"));
        call("PUT",base+"/charges",Map.of("allocation","QUANTITY","shipping",80,"customs",0,"clearing",0,"other",0),200);
        var event=call("POST",base+"/receipts",Map.of("reference","finance-receipt","date","2026-01-02","lines",
                List.of(Map.of("lineId",item,"usable",1,"damaged",2,"missing",1,"explanation","Inspected"))),200);
        String receipt=id(event.get("receipt"));
        call("POST",base+"/payments",Map.of("reference","freight","accountId",source,"chargeKind","SHIPPING","amountRwf",50),200);
        assertEquals(120,number(balance(product),"valueRwf"));
        var claim=call("POST",base+"/claims",Map.of("receiptId",receipt,"lineId",item,"kind","DAMAGE","reference","damage",
                "claimant","Vendor","amountRwf",150),201);
        call("POST",base+"/claims/"+id(claim)+"/decision",Map.of("acceptedRwf",150,"notes","Accepted"),200);
        resolve(base,receipt,item,"DAMAGE","CREDIT","credit",100,null,201);
        assertEquals("PARTIALLY_COMPENSATED",call("GET",base+"/claims",null,200).get(0).get("claim").get("status").asString());
        resolve(base,receipt,item,"DAMAGE","CASH","compensation",50,source,201);
        resolve(base,receipt,item,"DAMAGE","CASH","compensation",50,source,409);
        resolve(base,receipt,item,"DAMAGE","LOSS","damage-loss",90,null,201);
        claim=call("POST",base+"/claims",Map.of("receiptId",receipt,"lineId",item,"kind","SHORTAGE","reference","shortage",
                "claimant","Carrier","amountRwf",20),201);
        call("POST",base+"/claims/"+id(claim)+"/decision",Map.of("acceptedRwf",0,"notes","Rejected"),200);
        resolve(base,receipt,item,"SHORTAGE","LOSS","shortage-loss",20,null,201);
        var summary=call("GET",base+"/financial-reconciliation",null,200);
        assertTrue(summary.get("matches").asBoolean());
        assertEquals(20,number(summary,"capitalizedRwf"));
        assertEquals(30,number(summary,"outstandingRwf"));
        assertEquals(110,number(summary,"lossesRwf"));
        assertEquals(100,number(summary,"supplierCreditsRwf"));
        assertEquals(1000,accountBalance(source));
        assertEquals(120,number(balance(product),"valueRwf"));
        assertEquals(1,number(balance(product),"quantity"));
        assertTrue(call("GET","/finance/reconciliation",null,200).get("matches").asBoolean());
    }

    @Test
    void usableReturnForArchivedProductRecordsHeldDispositionWithoutReactivating() throws Exception {
        opening(product,1,101);
        var sold=call("POST","/sales",checkout("archived-return",null,List.of(line(product,1,0)),
                List.of(payment("archived-payment",cash,"CASH",101))),200);
        call("POST","/products/"+product+"/archive",null,200);
        var result=call("POST","/sales/"+id(sold.get("sale"))+"/returns",returned("held-return",id(sold.get("items").get(0)),1,"USABLE",cash),200);
        assertEquals("ARCHIVED_HELD",result.get("condition").asString());
        assertEquals(101,number(result,"refundRwf"));
        assertEquals(0,number(result,"restoredCostRwf"));
        assertEquals(0,number(balance(product),"quantity"));
        assertTrue(db.sql("SELECT archived_at IS NOT NULL FROM bizflow_foundation.catalog_products WHERE id=?").param(product).query(Boolean.class).single());
    }

    private void reversePosting(String id,String reference) throws Exception {
        call("POST","/finance/transactions/"+id+"/reverse",Map.of("reference",reference,"reason","Fixture correction"),200);
    }

    private static Map<String,?> transfer(String ref,String from,String to,long amount) {
        return Map.of("reference",ref,"fromAccount",from,"toAccount",to,"amountRwf",amount);
    }

    private String financeAccount(String name,long opening) throws Exception {
        return id(call("POST","/financial-accounts",Map.of("name",name,"kind","BANK","openingRwf",opening),201));
    }

    private String contact(String kind,String name) throws Exception {
        return id(call("POST","/procurement-contacts",Map.of("kind",kind,"name",name),201));
    }

    private JsonNode purchase(String supplier,String ref,String currency,long rate,long qty,long price) throws Exception {
        return call("POST","/purchases",Map.of("supplierId",supplier,"reference",ref,"currency",currency,"rateMicros",rate,
                "date","2026-01-01","lines",List.of(Map.of("productId",product,"quantity",qty,"unitMinor",price))),201);
    }

    private JsonNode obligation(String supplier,String purchase) throws Exception {
        for(var entry:call("GET",supplier+"/obligations",null,200)) if(purchase.equals(entry.get("purchaseId").asString())) return entry;
        throw new AssertionError("Missing purchase obligation");
    }

    private void resolve(String shipment,String receipt,String item,String kind,String action,String reference,long amount,String account,int status) throws Exception {
        var input=new java.util.HashMap<String,Object>(Map.of("receiptId",receipt,"lineId",item,"kind",kind,
                "action",action,"reference",reference,"amountRwf",amount,"notes","Inspected"));
        if(account!=null) input.put("accountId",account);
        call("POST",shipment+"/resolutions",input,status);
    }

    @Test
    void checkoutLinksCapturedCostsAndCollectsMixedPaymentsWithoutChangingRevenue() throws Exception {
        opening(product,3,101);
        opening(second,2,19);
        String sameName = id(call("POST","/customers",Map.of("name","Fixture customer"),201));
        assertNotEquals(customer,sameName);
        var items = List.of(line(product,1,1),line(product,1,0),line(second,2,1));
        var input = checkout("checkout",customer,items,List.of(payment("initial-cash",cash,"CASH",100),payment("initial-mobile",mobile,"MOBILE_MONEY",50)));
        JsonNode result = call("POST","/sales",input,200);
        JsonNode sale = result.get("sale");
        String path = "/sales/"+id(sale);
        assertEquals(606, number(sale,"grossRwf"));
        assertEquals(3, number(sale,"discountRwf"));
        assertEquals(603, number(sale,"totalRwf"));
        assertEquals(453, number(sale,"outstandingRwf"));
        assertEquals(87, number(sale,"costRwf"));
        assertEquals(516, number(sale,"grossProfitRwf"));
        assertEquals(1, number(balance(product),"quantity"));
        assertEquals(0, number(balance(second),"quantity"));
        assertEquals(result,call("POST","/sales",input,200));
        call("POST","/sales",checkout("checkout",customer,List.of(line(product,1,8)),List.of()),409);
        call("POST",path+"/payments",payment("invalid-method",bank,"CASH",1),400);
        call("POST",path+"/payments",payment("initial-cash",bank,"BANK",1),409);
        call("POST",path+"/payments",payment("overpay",bank,"BANK",454),409);
        var additional = call("POST",path+"/payments",payment("balance-payment",bank,"BANK",453),201);
        assertEquals("PAID", call("GET",path,null,200).get("sale").get("status").asString());
        assertEquals(200, accountBalance(cash));
        assertEquals(453, accountBalance(bank));
        assertEquals(50, accountBalance(mobile));
        call("POST",path+"/payments/"+id(additional)+"/reverse",Map.of("reference","payment-correction","reason","Deposit cancelled"),200);
        assertEquals(0,accountBalance(bank));
        assertEquals(453,number(call("GET",path,null,200).get("sale"),"outstandingRwf"));
        assertEquals(1,number(call("GET","/sales?status=PARTIAL&from=2026-01-01&to=2026-01-01&q=checkout",null,200),"total"));
        assertEquals(1,number(call("GET","/customers/"+customer+"/sales",null,200),"total"));
        assertEquals(0,number(call("GET","/customers/"+sameName+"/sales",null,200),"total"));
        assertEquals(453,number(call("GET","/customers/"+customer+"/balance",null,200),"outstandingRwf"));
        assertTrue(call("GET",path+"/reconciliation",null,200).get("matches").asBoolean());
        assertTrue(call("GET","/inventory/products/"+product+"/reconciliation",null,200).get("matches").asBoolean());
    }

    @Test
    void creditsAndRefundsAreAtomicWithUsableAndDamagedReturns() throws Exception {
        opening(product,3,101);
        JsonNode sale = call("POST","/sales",checkout("return-sale",customer,List.of(line(product,3,1)),
                List.of(payment("return-payment",cash,"CASH",230))),200);
        String path = "/sales/"+id(sale.get("sale"));
        String itemId = id(sale.get("items").get(0));
        var first = returned("usable",itemId,1,"USABLE",cash);
        JsonNode usable = call("POST",path+"/returns",first,200);
        assertEquals(30,number(usable,"refundRwf"));
        assertEquals(34,number(usable,"restoredCostRwf"));
        assertEquals(usable,call("POST",path+"/returns",first,200));
        call("POST",path+"/returns",returned("usable",itemId,1,"DAMAGED",cash),409);
        call("POST",path+"/returns",returned("no-funds",itemId,1,"USABLE",bank),409);
        assertEquals(1,number(balance(product),"quantity"));
        assertEquals(34,number(balance(product),"valueRwf"));
        assertEquals(1,call("GET",path+"/returns",null,200).size());
        JsonNode damaged = call("POST",path+"/returns",returned("damaged",itemId,1,"DAMAGED",cash),200);
        assertEquals(100,number(damaged,"refundRwf"));
        assertEquals(0,number(damaged,"restoredCostRwf"));
        JsonNode last = call("POST",path+"/returns",returned("last",itemId,1,"USABLE",cash),200);
        assertEquals(34,number(last,"restoredCostRwf"));
        call("POST",path+"/returns",returned("excess",itemId,1,"USABLE",cash),409);
        assertEquals(100,accountBalance(cash));
        assertEquals(2,number(balance(product),"quantity"));
        JsonNode totals = call("GET",path,null,200).get("sale");
        assertEquals(230,number(totals,"refundedRwf"));
        assertEquals(-33,number(totals,"grossProfitRwf"));
        assertEquals("RETURNED",totals.get("status").asString());
        assertTrue(call("GET",path+"/reconciliation",null,200).get("matches").asBoolean());
    }

    @Test
    void validatesDuplicateQuantitiesAndRollsBackAConcurrentOrFailedCheckout() throws Exception {
        opening(product,2,101);
        call("POST","/sales",checkout("duplicate-items",customer,List.of(line(product,2,0),line(product,1,0)),List.of()),409);
        call("POST","/sales",checkout("anonymous-debt",null,List.of(line(product,1,0)),List.of()),400);
        call("POST","/sales",checkout("rollback-payment",null,List.of(line(product,1,0)),List.of(
                payment("rollback-good",cash,"CASH",100),payment("rollback-bad",bank,"CASH",1))),400);
        assertEquals(2,number(balance(product),"quantity"));
        assertEquals(100,accountBalance(cash));
        var a = checkout("race-a",null,List.of(line(product,2,0)),List.of(payment("payment-a",cash,"CASH",202)));
        var b = checkout("race-b",null,List.of(line(product,2,0)),List.of(payment("payment-b",cash,"CASH",202)));
        var first = http.sendAsync(request("POST","/sales",a,token),HttpResponse.BodyHandlers.ofString());
        var second = http.sendAsync(request("POST","/sales",b,token),HttpResponse.BodyHandlers.ofString());
        assertEquals(List.of(200,409),List.of(first.join().statusCode(),second.join().statusCode()).stream().sorted().toList());
        assertEquals(0,number(balance(product),"quantity"));
        assertEquals(302,accountBalance(cash));
    }

    @Test
    void confirmsOnlyPendingOrdersAndPersistsAnAuditedSale() throws Exception {
        assertEquals(401,send("GET","/sales",null,null).statusCode());
        assertEquals(401,send("GET","/online-orders",null,issue(Instant.now().minusSeconds(1))).statusCode());
        opening(product,2,101);
        String path = "/online-orders/"+id(call("POST","/online-orders",order("order",1),201).get("order"));
        String cancelled = "/online-orders/"+id(call("POST","/online-orders",order("cancelled",1),201).get("order"));
        String shortOrder = "/online-orders/"+id(call("POST","/online-orders",order("short",3),201).get("order"));
        assertEquals(2,number(balance(product),"quantity"));
        var confirmation = Map.of("date","2026-01-02");
        call("PUT",path+"/fulfillment",Map.of("status","READY"),409);
        call("POST",cancelled+"/cancel",null,200);
        call("POST",cancelled+"/confirm",confirmation,409);
        call("POST",shortOrder+"/confirm",confirmation,409);
        assertEquals("PENDING",call("GET",shortOrder,null,200).get("order").get("status").asString());
        db.sql("UPDATE bizflow_foundation.catalog_products SET selling_price=999 WHERE id=?").param(product).update();
        JsonNode confirmed = call("POST",path+"/confirm",confirmation,200);
        assertEquals(confirmed,call("POST",path+"/confirm",confirmation,200));
        call("POST",path+"/confirm",Map.of("date","2026-01-03"),409);
        assertEquals(1,number(balance(product),"quantity"));
        assertEquals("UNPAID",confirmed.get("order").get("paymentStatus").asString());
        String saleId = confirmed.get("order").get("saleId").asString();
        assertEquals(101,number(call("GET","/sales/"+saleId,null,200).get("sale"),"totalRwf"));
        call("PUT",path+"/fulfillment",Map.of("status","READY"),200);
        assertEquals(1,number(call("GET","/online-orders?status=CONFIRMED",null,200),"total"));
        try (var connection=DriverManager.getConnection(env.getRequiredProperty("spring.datasource.url"),
                env.getRequiredProperty("spring.datasource.username"),env.getRequiredProperty("spring.datasource.password"));
             var statement=connection.prepareStatement("SELECT count(*) FROM bizflow_foundation.sales_audit WHERE event='sale_completed' AND entity_id=? AND actor_id=?")) {
            statement.setString(1,saleId);
            statement.setString(2,owner);
            try (var rows=statement.executeQuery()) {
                assertTrue(rows.next());
                assertEquals(1,rows.getInt(1));
            }
        }
        db.sql("UPDATE bizflow_foundation.owner_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").param(session).update();
        call("GET",path,null,401);
    }

    private void seedProduct(String id, String sku, long price) {
        db.sql("""
                INSERT INTO bizflow_foundation.catalog_products(id,sku,name,category,selling_price,estimated_unit_cost,reorder_threshold)
                VALUES (?,?,'Fixture ring','Jewelry',?,1,0)
                """).params(id,sku,price).update();
    }

    private void opening(String id, long quantity, long value) throws Exception {
        call("POST","/inventory/products/"+id+"/opening",Map.of("quantity",quantity,"valueRwf",value,"reference","fixture-"+id,"reason","Fixture"),201);
    }

    private JsonNode balance(String id) throws Exception { return call("GET","/inventory/products/"+id+"/balance",null,200); }

    private long accountBalance(String id) throws Exception {
        JsonNode values = call("GET","/financial-accounts/"+id+"/reconciliation",null,200);
        assertTrue(values.get("matches").asBoolean());
        return number(values,"balanceRwf");
    }

    private Map<String,?> checkout(String ref, String customerId, List<?> items, List<?> payments) {
        var result = new java.util.HashMap<String,Object>(Map.of("reference",ref,"date","2026-01-01","channel","Physical shop",
                "items",items,"payments",payments));
        if (customerId!=null) result.put("customerId",customerId);
        return result;
    }
    private Map<String,?> order(String ref, long quantity) {
        return Map.of("reference",ref,"customerId",customer,"contact","Fixture phone","source","WhatsApp",
                "items",List.of(Map.of("productId",product,"quantity",quantity)));
    }
    private static Map<String,?> line(String id, long quantity, long discount) {
        return Map.of("productId",id,"quantity",quantity,"unitDiscountRwf",discount);
    }
    private static Map<String,?> payment(String reference, String account, String method, long amount) {
        return Map.of("reference",reference,"accountId",account,"method",method,"amountRwf",amount);
    }
    private static Map<String,?> returned(String ref, String item, long qty, String condition, String account) {
        return Map.of("reference",ref,"itemId",item,"quantity",qty,"condition",condition,"refundAccountId",account,"reason","Fixture inspection");
    }
    private static String id(JsonNode node) { return node.get("id").asString(); }
    private static long number(JsonNode node, String key) { return node.get(key).asLong(); }

    private String issue(Instant expires) {
        var claims = JwtClaimsSet.builder().issuer(env.getRequiredProperty("bizflow.auth.issuer"))
                .audience(List.of(env.getRequiredProperty("bizflow.auth.audience"))).subject(owner).id(session.toString())
                .issuedAt(Instant.now().minusSeconds(60)).expiresAt(expires).claim("role","OWNER").build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),claims)).getTokenValue();
    }
    private JsonNode call(String method, String path, Object body, int status) throws Exception {
        var response = send(method,path,body,token);
        assertEquals(status,response.statusCode(),() -> method+" "+path+" "+response.body());
        return response.body().isBlank() ? null : json.readTree(response.body());
    }
    private HttpResponse<String> send(String method, String path, Object body, String bearer) throws Exception {
        return http.send(request(method,path,body,bearer),HttpResponse.BodyHandlers.ofString());
    }
    private HttpRequest request(String method, String path, Object body, String bearer) {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1"+path));
        if (bearer!=null) request.header("Authorization","Bearer "+bearer);
        if (body==null) return request.method(method,HttpRequest.BodyPublishers.noBody()).build();
        return request.header("Content-Type","application/json").method(method,HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
    }
}
