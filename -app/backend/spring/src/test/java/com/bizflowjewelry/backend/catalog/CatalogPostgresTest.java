package com.bizflowjewelry.backend.catalog;

import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import tools.jackson.databind.ObjectMapper;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "BIZFLOW_FOUNDATION_TEST", matches = "1")
@EnabledIfEnvironmentVariable(named = "BIZFLOW_FOUNDATION_DATABASE", matches = "bizflow_foundation_test_[a-z0-9]+")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CatalogPostgresTest {
    @LocalServerPort int port;
    @Autowired JdbcClient db;
    @Autowired CatalogService catalog;
    @Autowired JwtEncoder encoder;
    @Autowired Environment environment;
    @Autowired ObjectMapper json;

    @Test
    void verifiesOwnerCatalogTransactionsAndMigration() throws Exception {
        assertTrue(db.sql("SELECT success FROM bizflow_foundation.flyway_schema_history WHERE version='3'")
                .query(Boolean.class).single());
        String owner = db.sql("SELECT id FROM bizflow_foundation.owner_accounts").query(String.class).optional().orElse(null);
        boolean createdOwner = owner == null;
        if (createdOwner) {
            owner = UUID.randomUUID().toString();
            db.sql("""
                    INSERT INTO bizflow_foundation.owner_accounts (id,email,display_name,password_hash)
                    VALUES (?,'catalog-fixture@example.test','Catalog fixture','fixture-has-no-login-password')
                    """).param(owner).update();
        }
        UUID session = UUID.randomUUID();
        Instant now = Instant.now();
        db.sql("INSERT INTO bizflow_foundation.owner_sessions (id,owner_id,expires_at) VALUES (?,?,?)")
                .params(session, owner, Timestamp.from(now.plusSeconds(600))).update();
        String bearer = issue(owner, session, now.plusSeconds(600));
        try (var client = HttpClient.newHttpClient()) {
            String products = "/products";
            String families = "/product-families";
            assertEquals(401, send(client, "GET", products, null, null).statusCode());
            int signature = bearer.lastIndexOf('.') + 1;
            String tampered = bearer.substring(0, signature) + (bearer.charAt(signature) == 'a' ? 'b' : 'a') + bearer.substring(signature + 1);
            assertEquals(401, send(client, "GET", products, null, tampered).statusCode());
            assertEquals(401, send(client, "GET", products, null, issue(owner, session, now.minusSeconds(1))).statusCode());
            String family = json.readTree(expect(201, send(client, "POST", families, "{\"name\":\"Gold Ring\"}", bearer)))
                    .get("id").asString();
            expect(200, send(client, "PATCH", families + "/" + family, "{\"name\":\"Rings\"}", bearer));
            assertEquals("Rings", json.readTree(expect(200, send(client, "GET", families + "/" + family, null, bearer))).get("name").asString());
            assertEquals(1, json.readTree(expect(200, send(client, "GET", families, null, bearer))).get("total").asInt());
            String six = createProduct(client, bearer, "RING-6", "Size 6", family, "6");
            String seven = createProduct(client, bearer, "RING-7", "Size 7", family, "7");
            assertNotEquals(six, seven);
            expect(409, send(client, "POST", products, product("ring-6", "Duplicate", family, "6"), bearer));
            expect(404, send(client, "POST", products, product("RING-9", "Unknown family", "missing-id", "9"), bearer));
            assertEquals(400, send(client, "PATCH", products + "/" + six, "{\"quantity\":9}", bearer).statusCode());
            assertEquals(400, send(client, "PATCH", products + "/" + six, "{\"sellingPrice\":1.8}", bearer).statusCode());
            expect(200, send(client, "PATCH", products + "/" + six, "{\"sellingPrice\":1200,\"description\":\"tagged\"}", bearer));
            var found = json.readTree(expect(200, send(client, "GET", products + "?q=tagged&category=jewelry&familyId=" + family, null, bearer)));
            assertEquals(1, found.get("total").asInt());
            assertEquals(1200, found.get("items").get(0).get("sellingPrice").asInt());
            assertEquals("7", json.readTree(expect(200, send(client, "GET", products + "/" + seven, null, bearer))).get("variantSize").asString());
            assertEquals(seven, json.readTree(expect(200, send(client, "GET", products + "?sort=sku&size=1&page=1", null, bearer)))
                    .get("items").get(0).get("id").asString());
            expect(200, send(client, "PATCH", products + "/" + seven + "/family", "{\"familyId\":null}", bearer));
            expect(200, send(client, "PATCH", products + "/" + seven + "/family", "{\"familyId\":\"" + family + "\"}", bearer));

            var first = client.sendAsync(request("POST", products, product("RACE", "Race 1", family, "1"), bearer),
                    HttpResponse.BodyHandlers.ofString());
            var second = client.sendAsync(request("POST", products, product("race", "Race 2", family, "2"), bearer),
                    HttpResponse.BodyHandlers.ofString());
            assertEquals(List.of(201, 409), java.util.stream.Stream.of(first.join().statusCode(), second.join().statusCode()).sorted().toList());
            assertEquals(1, db.sql("SELECT count(*) FROM bizflow_foundation.catalog_products WHERE lower(sku)='race'").query(Integer.class).single());
            assertEquals(3, db.sql("SELECT count(*) FROM bizflow_foundation.catalog_audit WHERE product_id IS NOT NULL AND action='created'")
                    .query(Integer.class).single());
            assertThrows(DataIntegrityViolationException.class, () -> db.sql(
                    "UPDATE bizflow_foundation.catalog_products SET family_id='unknown' WHERE id=?").param(six).update());
            var rolledBack = new CatalogController.CreateProduct("ROLLBACK", "Audit failure", "Jewelry",
                    null, null, null, null, null, null, null, 1L, 1L, 0);
            assertThrows(DataIntegrityViolationException.class, () -> catalog.create(rolledBack, "nonexistent-actor"));
            assertEquals(0, db.sql("SELECT count(*) FROM bizflow_foundation.catalog_products WHERE sku='ROLLBACK'")
                    .query(Integer.class).single());

            byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN3sAAAAASUVORK5CYII=");
            assertEquals(400, upload(client, six, bearer, png, "image/jpeg").statusCode());
            assertEquals(204, upload(client, six, bearer, png, "image/png").statusCode());
            var download = client.send(request("GET", products + "/" + six + "/image", null, bearer), HttpResponse.BodyHandlers.ofByteArray());
            assertEquals(200, download.statusCode());
            assertArrayEquals(png, download.body());
            expect(200, send(client, "POST", products + "/" + six + "/archive", "", bearer));
            assertEquals(409, send(client, "PATCH", products + "/" + six, "{\"sellingPrice\":0}", bearer).statusCode());
            assertEquals(1, json.readTree(expect(200, send(client, "GET", products + "?status=archived", null, bearer))).get("total").asInt());
            assertEquals(2, json.readTree(expect(200, send(client, "GET", products, null, bearer))).get("total").asInt());
            String importRow="{\"product\":"+product("IMPORT-1","Imported ring",family,"8")+",\"quantity\":5}";
            String upload="{\"mode\":\"SKIP\",\"reference\":\"catalog-fixture-import\",\"rows\":["+importRow+"]}";
            var preview=json.readTree(expect(200,send(client,"POST","/products/import/preview",upload,bearer)));
            assertEquals("CREATE",preview.get(0).get("action").asString());
            assertEquals(1,preview.get(0).get("warnings").size());
            String firstImport=expect(200,send(client,"POST","/products/import/confirm",upload,bearer));
            assertEquals(1,json.readTree(firstImport).get("created").asInt());
            assertEquals(json.readTree(firstImport),json.readTree(expect(200,send(client,"POST","/products/import/confirm",upload,bearer))));
            assertEquals(409,send(client,"POST","/products/import/confirm",upload.replace("\"quantity\":5","\"quantity\":6"),bearer).statusCode());
            assertEquals(0,db.sql("""
                    SELECT count(*) FROM bizflow_foundation.inventory_balances b
                    JOIN bizflow_foundation.catalog_products p ON p.id=b.product_id WHERE sku='IMPORT-1'
                    """).query(Integer.class).single());
            assertEquals("SKIP",json.readTree(expect(200,send(client,"POST","/products/import/preview",upload,bearer))).get(0).get("action").asString());
            String update="""
                    {"mode":"UPDATE","reference":"catalog-fixture-update","rows":[
                    {"product":{"sku":"IMPORT-1","name":"Updated ring","category":"Jewelry","sellingPrice":1400}}]}
                    """;
            assertEquals(1,json.readTree(expect(200,send(client,"POST","/products/import/confirm",update,bearer))).get("updated").asInt());
            assertEquals(500L,db.sql("SELECT estimated_unit_cost FROM bizflow_foundation.catalog_products WHERE sku='IMPORT-1'")
                    .query(Long.class).single());
            String duplicate="{\"mode\":\"SKIP\",\"rows\":["+importRow+","+importRow+"]}";
            assertEquals(1,json.readTree(expect(200,send(client,"POST","/products/import/preview",duplicate,bearer))).get(0).get("errors").size());
            db.sql("UPDATE bizflow_foundation.owner_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").param(session).update();
            assertEquals(401, send(client, "GET", products, null, bearer).statusCode());
        } finally {
            db.sql("DELETE FROM bizflow_foundation.catalog_imports").update();
            db.sql("DELETE FROM bizflow_foundation.catalog_audit").update();
            db.sql("DELETE FROM bizflow_foundation.catalog_images").update();
            db.sql("DELETE FROM bizflow_foundation.catalog_products").update();
            db.sql("DELETE FROM bizflow_foundation.catalog_families").update();
            db.sql("DELETE FROM bizflow_foundation.owner_sessions WHERE id=?").param(session).update();
            if (createdOwner) db.sql("DELETE FROM bizflow_foundation.owner_accounts WHERE id=?").param(owner).update();
        }
    }

    private String issue(String owner, UUID session, Instant expiry) {
        var claims = JwtClaimsSet.builder().issuer(environment.getRequiredProperty("bizflow.auth.issuer"))
                .audience(List.of(environment.getRequiredProperty("bizflow.auth.audience")))
                .subject(owner).id(session.toString()).issuedAt(Instant.now().minusSeconds(60)).expiresAt(expiry)
                .claim("role", "OWNER").build();
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }

    private String createProduct(HttpClient client, String bearer, String sku, String name, String family, String size) throws Exception {
        return json.readTree(expect(201, send(client, "POST", "/products", product(sku, name, family, size), bearer))).get("id").asString();
    }

    private String product(String sku, String name, String family, String size) {
        return json.writeValueAsString(java.util.Map.of("sku", sku,"name", name,"category","Jewelry","familyId",family,
                "variantSize",size,"sellingPrice",1000,"estimatedUnitCost",500,"reorderThreshold",2));
    }

    private HttpRequest request(String method, String path, String body, String bearer) {
        var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1" + path));
        if (bearer != null) builder.header("Authorization", "Bearer " + bearer);
        if (body != null) builder.header("Content-Type", "application/json");
        return builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build();
    }

    private HttpResponse<String> send(HttpClient client, String method, String path, String body, String bearer) throws Exception {
        return client.send(request(method, path, body, bearer), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> upload(HttpClient client, String id, String bearer, byte[] bytes, String contentType) throws Exception {
        var start = ("--fixture\r\nContent-Disposition: form-data; name=\"image\"; filename=\"ring.png\"\r\n"
                + "Content-Type: " + contentType + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
        var end = "\r\n--fixture--\r\n".getBytes(StandardCharsets.US_ASCII);
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/api/v1/products/" + id + "/image"))
                .header("Authorization", "Bearer " + bearer).header("Content-Type", "multipart/form-data; boundary=fixture")
                .PUT(HttpRequest.BodyPublishers.ofByteArrays(List.of(start, bytes, end))).build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    private String expect(int status, HttpResponse<String> response) {
        assertEquals(status, response.statusCode());
        return response.body();
    }
}
