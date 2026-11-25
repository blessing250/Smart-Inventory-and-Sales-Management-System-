package com.bizflowjewelry.backend.foundation;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@EnabledIfEnvironmentVariable(named = "BIZFLOW_FOUNDATION_TEST", matches = "1")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FoundationPostgresTest {
    @LocalServerPort
    private int port;

    @Autowired
    private JdbcClient database;

    @Test
    void flywayAppliesFoundationAndOwnerSchemaAndDeniesBusinessAccess() throws Exception {
        boolean applied = database.sql("""
                SELECT success FROM bizflow_foundation.flyway_schema_history WHERE version = '1'
                """).query(Boolean.class).single();
        assertTrue(applied);
        assertTrue(database.sql("""
                SELECT success FROM bizflow_foundation.flyway_schema_history WHERE version = '2'
                """).query(Boolean.class).single());
        try (var client = HttpClient.newHttpClient()) {
            var live = send(client, "GET", "/api/health/live");
            var ready = send(client, "GET", "/api/health/ready");
            assertEquals(200, live.statusCode());
            assertEquals("{\"status\":\"ok\"}", live.body());
            assertEquals(200, ready.statusCode());
            assertEquals("{\"status\":\"ready\"}", ready.body());
            assertEquals("no-store", ready.headers().firstValue("Cache-Control").orElseThrow());
            assertEquals(401, send(client, "GET", "/api/products").statusCode());
            assertEquals(401, send(client, "POST", "/api/health/live").statusCode());
        }
    }

    private HttpResponse<String> send(HttpClient client, String method, String path) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                .method(method, HttpRequest.BodyPublishers.noBody()).build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
