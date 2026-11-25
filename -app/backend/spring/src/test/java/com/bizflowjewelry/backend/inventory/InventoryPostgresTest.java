package com.bizflowjewelry.backend.inventory;

import java.net.URI;
import java.net.http.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "BIZFLOW_FOUNDATION_TEST", matches = "1")
@EnabledIfEnvironmentVariable(named = "BIZFLOW_FOUNDATION_DATABASE", matches = "bizflow_foundation_test_[a-z0-9]+")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class InventoryPostgresTest {
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired InventoryLedger ledger;
    @Autowired JwtEncoder encoder;
    @Autowired Environment env;
    @Autowired ObjectMapper json;
    private final String product = UUID.randomUUID().toString();
    private final UUID session = UUID.randomUUID();
    private String owner;
    private boolean createdOwner;
    private String bearer;
    private HttpClient client;

    @BeforeEach
    void fixture() {
        assertTrue(db.sql("SELECT success FROM bizflow_foundation.flyway_schema_history WHERE version='4'")
                .query(Boolean.class).single());
        owner = db.sql("SELECT id FROM bizflow_foundation.owner_accounts").query(String.class).optional().orElse(null);
        createdOwner = owner == null;
        if (createdOwner) {
            owner = UUID.randomUUID().toString();
            db.sql("""
                    INSERT INTO bizflow_foundation.owner_accounts (id,email,display_name,password_hash)
                    VALUES (?,'inventory-fixture@example.test','Inventory fixture','fixture-has-no-login-password')
                    """).param(owner).update();
        }
        Instant expires = Instant.now().plusSeconds(600);
        db.sql("INSERT INTO bizflow_foundation.owner_sessions (id,owner_id,expires_at) VALUES (?,?,?)")
                .params(session, owner, Timestamp.from(expires)).update();
        db.sql("""
                INSERT INTO bizflow_foundation.catalog_products
                    (id,sku,name,category,selling_price,estimated_unit_cost,reorder_threshold)
                VALUES (?,'INV-TEST','Fixture inventory ring','Jewelry',300,80,2)
                """).param(product).update();
        bearer = issue(expires);
        client = HttpClient.newHttpClient();
    }

    @AfterEach
    void cleanDisposableFixture() {
        if (client != null) client.close();
        db.sql("""
                TRUNCATE bizflow_foundation.discrepancy_resolutions, bizflow_foundation.discrepancy_claims,
                         bizflow_foundation.procurement_receipt_correction_moves,
                         bizflow_foundation.procurement_receipt_lines, bizflow_foundation.sale_returns, bizflow_foundation.sale_items,
                         bizflow_foundation.inventory_counts, bizflow_foundation.inventory_movements,
                         bizflow_foundation.inventory_balances
                """).update();
        db.sql("DELETE FROM bizflow_foundation.catalog_audit WHERE product_id=?").param(product).update();
        db.sql("DELETE FROM bizflow_foundation.catalog_products WHERE id=?").param(product).update();
        db.sql("DELETE FROM bizflow_foundation.owner_sessions WHERE id=?").param(session).update();
        if (createdOwner) db.sql("DELETE FROM bizflow_foundation.owner_accounts WHERE id=?").param(owner).update();
    }

    @Test
    void preservesValuationAndRejectsDuplicateWritesAndConcurrentOversell() throws Exception {
        assertEquals(0, row("GET", path("/balance"), null, 200).get("quantity").asLong());
        assertEquals(0, db.sql("SELECT count(*) FROM bizflow_foundation.inventory_balances WHERE product_id=?")
                .param(product).query(Integer.class).single());
        var opening = open();
        assertEquals("OPENING", opening.get("kind").asString());
        assertEquals(owner, opening.get("actorId").asString());
        row("POST", path("/opening"), opening("another-opening"), 409);
        var inbound = row("POST", path("/adjustments"), adjustment("INCREASE", 2, "found-stock"), 201);
        assertEquals(201, inbound.get("valueDeltaRwf").asLong());
        var outbound = row("POST", path("/adjustments"), adjustment("DECREASE", 3, "corrected-stock"), 201);
        assertEquals(-302, outbound.get("valueDeltaRwf").asLong());
        String latest = outbound.get("id").asString();
        assertEquals("OUT", row("GET", "/movements/" + latest, null, 200).get("direction").asString());
        row("POST", path("/adjustments"), adjustment("INCREASE", 1, "found-stock"), 409);
        row("POST", path("/adjustments"), adjustment("DECREASE", 10, "overdraw"), 409);
        assertThrows(DataIntegrityViolationException.class,
                () -> ledger.adjust(product, "INCREASE", 1, "rollback", "Fixture invalid actor", "unknown-actor"));
        assertEquals(904, row("GET", path("/balance"), null, 200).get("valueRwf").asLong());
        assertThrows(DataAccessException.class, () -> db.sql(
                "DELETE FROM bizflow_foundation.inventory_movements WHERE id=?").param(UUID.fromString(latest)).update());

        var first = client.sendAsync(request("POST", path("/adjustments"), adjustment("DECREASE", 6, "race-one"), bearer),
                HttpResponse.BodyHandlers.ofString());
        var second = client.sendAsync(request("POST", path("/adjustments"), adjustment("DECREASE", 6, "race-two"), bearer),
                HttpResponse.BodyHandlers.ofString());
        assertEquals(List.of(201, 409), java.util.stream.Stream.of(first.join().statusCode(), second.join().statusCode()).sorted().toList());
        var balance = row("GET", path("/balance"), null, 200);
        assertEquals(3, balance.get("quantity").asLong());
        assertEquals(301, balance.get("valueRwf").asLong());
        assertEquals(4, balance.get("version").asLong());

        LocalDate today = LocalDate.now(ZoneId.of("Africa/Kigali"));
        var page = row("GET", "/movements?productId=" + product + "&from=" + today.minusDays(1)
                + "&to=" + today.plusDays(1) + "&q=Fixture&size=1&page=1", null, 200);
        assertEquals(4, page.get("total").asInt());
        assertEquals(1, page.get("items").size());
        assertEquals(0, row("GET", "/movements?productId=" + product + "&kind=COUNT", null, 200).get("total").asInt());
        assertEquals(1, row("GET", "/balances?q=inv-test", null, 200).get("total").asInt());
        assertTrue(row("GET", path("/reconciliation"), null, 200).get("matches").asBoolean());
        assertEquals(409, client.send(request("POST", "/api/v1/products/" + product + "/archive", null, bearer),
                HttpResponse.BodyHandlers.ofString()).statusCode());
    }

    @Test
    void auditsCountsAndDispositionsAndReportsDiscrepanciesWithoutCorrection() throws Exception {
        assertEquals(401, send("GET", path("/balance"), null, null).statusCode());
        assertEquals(401, send("GET", path("/balance"), null, issue(Instant.now().minusSeconds(1))).statusCode());
        row("GET", "/products/missing/balance", null, 404);
        row("POST", "/products/missing/opening", opening("invalid-product"), 404);
        row("POST", path("/adjustments"), adjustment("INCREASE", 0, "zero-invalid"), 400);
        open();
        String stale = id(row("POST", path("/counts"), count(1, 8, "stale-observation"), 201));
        row("POST", path("/adjustments"), adjustment("INCREASE", 2, "changed-since-count"), 201);
        row("POST", "/counts/" + stale + "/confirm", null, 409);
        row("POST", path("/counts"), count(1, 12, "stale-draft"), 409);
        String zero = id(row("POST", path("/counts"), count(2, 12, "zero-observation"), 201));
        var confirmed = row("POST", "/counts/" + zero + "/confirm", null, 200);
        assertTrue(confirmed.get("movementId").isNull());
        assertEquals(owner, confirmed.get("confirmedBy").asString());
        assertEquals(2, row("GET", path("/balance"), null, 200).get("version").asLong());
        var correction = row("POST", path("/counts"), count(2, 10, "physical-adjustment"), 201);
        assertEquals(-2, correction.get("difference").asLong());
        String countId = id(correction);
        var adjusted = row("POST", "/counts/" + countId + "/confirm", null, 200);
        String adjustmentId = adjusted.get("movementId").asString();
        assertEquals(adjustmentId, row("POST", "/counts/" + countId + "/confirm", null, 200).get("movementId").asString());
        assertEquals(adjustmentId, row("GET", "/counts/" + countId, null, 200).get("movementId").asString());
        assertEquals(2, row("GET", "/counts?productId=" + product + "&status=confirmed", null, 200).get("total").asInt());

        String damaged = id(row("POST", path("/adjustments"), adjustment("DAMAGE_OUT", 1, "damaged-stock"), 201));
        String missing = id(row("POST", path("/adjustments"), adjustment("MISSING_OUT", 1, "missing-stock"), 201));
        var unavailable = row("GET", path("/unavailable"), null, 200);
        assertEquals(1, unavailable.get("damagedRecorded").asLong());
        assertEquals(1, unavailable.get("missingRecorded").asLong());
        assertTrue(unavailable.get("awaitingReceiptQuantity").isNull());
        row("POST", "/movements/" + damaged + "/reverse", reversal("not-latest"), 409);
        var reverse = row("POST", "/movements/" + missing + "/reverse", reversal("approved-compensation"), 201);
        assertEquals(missing, reverse.get("reversesId").asString());
        assertEquals(100, reverse.get("valueDeltaRwf").asLong());
        row("POST", "/movements/" + missing + "/reverse", reversal("attempt-repeat"), 409);
        assertEquals(0, row("GET", path("/unavailable"), null, 200).get("missingRecorded").asLong());
        var good = row("GET", path("/reconciliation"), null, 200);
        assertTrue(good.get("matches").asBoolean());
        assertEquals(9, good.get("ledger").get("quantity").asLong());
        assertEquals(-2, good.get("counts").get("countDelta").asLong());

        db.sql("UPDATE bizflow_foundation.inventory_balances SET value_rwf=value_rwf+1 WHERE product_id=?").param(product).update();
        var bad = row("GET", path("/reconciliation"), null, 200);
        assertFalse(bad.get("matches").asBoolean());
        assertEquals(good.get("balance").get("valueRwf").asLong() + 1, bad.get("balance").get("valueRwf").asLong());
        assertEquals(bad.get("balance"), row("GET", path("/balance"), null, 200));
        db.sql("UPDATE bizflow_foundation.catalog_products SET archived_at=CURRENT_TIMESTAMP WHERE id=?").param(product).update();
        row("POST", path("/adjustments"), adjustment("INCREASE", 1, "archived"), 409);
        db.sql("UPDATE bizflow_foundation.owner_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").param(session).update();
        row("GET", path("/balance"), null, 401);
    }

    private JsonNode open() throws Exception { return row("POST", path("/opening"), opening("opening"), 201); }
    private String path(String suffix) { return "/products/" + product + suffix; }
    private Map<String, ?> opening(String ref) { return Map.of("quantity", 10, "valueRwf", 1005, "reference", ref, "reason", "Fixture opening"); }
    private Map<String, ?> adjustment(String type, int qty, String ref) {
        return Map.of("type", type, "quantity", qty, "reference", ref, "reason", "Fixture correction");
    }
    private Map<String, ?> count(int expected, int observed, String ref) {
        return Map.of("expectedVersion", expected, "observedQuantity", observed, "reference", ref, "reason", "Fixture count");
    }
    private Map<String, ?> reversal(String ref) { return Map.of("reference", ref, "reason", "Fixture reversal"); }
    private String id(JsonNode entity) { return entity.get("id").asString(); }

    private String issue(Instant expires) {
        var claims = JwtClaimsSet.builder().issuer(env.getRequiredProperty("bizflow.auth.issuer"))
                .audience(List.of(env.getRequiredProperty("bizflow.auth.audience"))).subject(owner).id(session.toString())
                .issuedAt(Instant.now().minusSeconds(60)).expiresAt(expires).claim("role", "OWNER").build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }

    private JsonNode row(String method, String route, Map<String, ?> body, int expected) throws Exception {
        var response = send(method, route, body, bearer);
        assertEquals(expected, response.statusCode(), method + " " + route);
        return json.readTree(response.body());
    }

    private HttpResponse<String> send(String method, String route, Map<String, ?> body, String token) throws Exception {
        return client.send(request(method, route, body, token), HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest request(String method, String route, Map<String, ?> body, String token) {
        String path = route.startsWith("/api/") ? route : "/api/v1/inventory" + route;
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
        if (token != null) builder.header("Authorization", "Bearer " + token);
        if (body != null) return builder.header("Content-Type", "application/json")
                .method(method, HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build();
        return builder.method(method, HttpRequest.BodyPublishers.noBody()).build();
    }
}
