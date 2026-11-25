package com.bizflowjewelry.backend.auth;

import java.net.URI;
import java.net.http.*;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import static org.junit.jupiter.api.Assertions.*;

@EnabledIfEnvironmentVariable(named = "BIZFLOW_FOUNDATION_TEST", matches = "1")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = "bizflow.auth.mail.enabled=false")
@Import(OwnerAuthPostgresTest.PrivateMail.class)
class OwnerAuthPostgresTest {
    private static final String EMAIL = "fixture-owner@example.test";
    private static final String OLD = "migration-fixture-password";
    private static final String NEW = "replacement-fixture-password";
    private static final String LEGACY_BCRYPTJS_HASH = "$2b$12$C5K7uDtsM.ovTogOEoh.ouUrtW3w50n3a3UFY5UbuGUwise98vdbe";
    private static final String LOGIN = "/login";
    private static final String PROFILE = "/me";
    @LocalServerPort int port;
    @Autowired JdbcClient database;
    @Autowired AuthStore store;
    @Autowired OwnerPassword bcrypt;
    @Autowired JwtEncoder encoder;
    @Autowired JwtDecoder decoder;
    @Autowired Outbox outbox;

    @Test
    void protectsOwnerSessionsAndCommitsSingleUseRecoveryOnPostgreSql() throws Exception {
        assertTrue(bcrypt.matches(OLD, LEGACY_BCRYPTJS_HASH), "Spring must accept the bcryptjs fixture hash");
        store.provision(EMAIL, "Fixture owner", LEGACY_BCRYPTJS_HASH, true);
        assertThrows(org.springframework.dao.DuplicateKeyException.class,
                () -> store.provision("second@example.test", "Second owner", LEGACY_BCRYPTJS_HASH, false));

        try (var client = HttpClient.newHttpClient()) {
            var wrong = send(client, LOGIN, login(EMAIL, "wrong-fixture-password"), null, null);
            var unknown = send(client, LOGIN, login("unknown@example.test", OLD), null, null);
            assertEquals(401, wrong.statusCode());
            assertEquals(wrong.statusCode(), unknown.statusCode());
            assertTrue(wrong.body().equals(unknown.body()));
            assertEquals(403, send(client, LOGIN, login(EMAIL, OLD), null, "https://foreign.example.test").statusCode());
            assertEquals(401, send(client, PROFILE, null, null, null).statusCode());

            String first = issued(send(client, LOGIN, login(EMAIL, OLD), null, null));
            String second = issued(send(client, LOGIN, login(EMAIL, OLD), null, null));
            String concurrent = issued(send(client, LOGIN, login(EMAIL, OLD), null, null));
            String origin="http://localhost:8081";
            assertEquals(403,send(client,"/browser-login",login(EMAIL,OLD),null,null).statusCode());
            var browser=send(client,"/browser-login",login(EMAIL,OLD),null,origin);
            assertEquals(200,browser.statusCode());
            String header=browser.headers().firstValue("set-cookie").orElseThrow();
            assertTrue(header.contains("HttpOnly") && header.contains("SameSite=Strict"));
            String initialCookie=header.split(";",2)[0];
            var refresh=browserRefresh(client,initialCookie,origin);
            assertEquals(200,refresh.statusCode());
            String refreshCookie=refresh.headers().firstValue("set-cookie").orElseThrow().split(";",2)[0];
            assertNotEquals(initialCookie,refreshCookie);
            assertEquals(401,browserRefresh(client,initialCookie,origin).statusCode());
            var profile = send(client, PROFILE, null, first, null);
            assertEquals(200, profile.statusCode());
            assertTrue(profile.body().contains("\"role\":\"OWNER\""));
            assertFalse(profile.body().contains("password"));
            assertEquals(403, send(client, "/api/products", null, first, null).statusCode());
            assertEquals(403, send(client, "/api/health/live", "", first, null).statusCode());
            Jwt correct = decoder.decode(first);
            byte[] wrongKey = new byte[32];
            new SecureRandom().nextBytes(wrongKey);
            var otherEncoder = NimbusJwtEncoder.withSecretKey(new SecretKeySpec(wrongKey, "HmacSHA256"))
                    .algorithm(MacAlgorithm.HS256).build();
            assertEquals(401, send(client, PROFILE, null, signed(otherEncoder, correct, Instant.now().plusSeconds(60),
                    correct.getAudience().getFirst()), null).statusCode());
            assertEquals(401, send(client, PROFILE, null, signed(encoder, correct, Instant.now().minusSeconds(2),
                    correct.getAudience().getFirst()), null).statusCode());
            assertEquals(401, send(client, PROFILE, null, signed(encoder, correct, Instant.now().plusSeconds(60),
                    "wrong-audience"), null).statusCode());
            assertEquals(204, send(client, "/logout", "", first, null).statusCode());
            assertEquals(401, send(client, PROFILE, null, first, null).statusCode());
            assertEquals(200, send(client, PROFILE, null, second, null).statusCode());

            var missing = send(client, "/forgot-password", email("unknown@example.test"), null, null);
            var known = send(client, "/forgot-password", email(EMAIL), null, null);
            assertEquals(202, missing.statusCode());
            assertEquals(202, known.statusCode());
            assertTrue(missing.body().equals(known.body()));
            String expired = outbox.takeToken();
            assertEquals(204, send(client, "/verify-reset", token(expired), null, null).statusCode());
            database.sql("""
                    UPDATE bizflow_foundation.owner_password_resets
                    SET requested_at=CURRENT_TIMESTAMP - INTERVAL '31 minutes',
                        expires_at=CURRENT_TIMESTAMP - INTERVAL '1 minute'
                    """).update();
            assertEquals(400, send(client, "/reset-password", reset(expired, NEW, NEW), null, null).statusCode());

            outbox.fail.set(true);
            assertEquals(202, send(client, "/forgot-password", email(EMAIL), null, null).statusCode());
            for (int i = 0; i < 100 && events("recovery_delivery_failed") == 0; i++) Thread.sleep(30);
            assertEquals(1, events("recovery_delivery_failed"));
            outbox.fail.set(false);
            assertEquals(202, send(client, "/forgot-password", email(EMAIL), null, null).statusCode());
            String recovery = outbox.takeToken();
            String stored = database.sql("SELECT token_hash FROM bizflow_foundation.owner_password_resets").query(String.class).single();
            assertTrue(stored.matches("[a-f0-9]{64}") && !stored.equals(recovery));
            assertEquals(400, send(client, "/reset-password", reset(recovery, NEW, OLD), null, null).statusCode());
            var resetOne = client.sendAsync(request("/reset-password", reset(recovery, NEW, NEW), null, null),
                    HttpResponse.BodyHandlers.ofString());
            var resetTwo = client.sendAsync(request("/reset-password", reset(recovery, NEW, NEW), null, null),
                    HttpResponse.BodyHandlers.ofString());
            assertEquals(List.of(204, 400), java.util.stream.Stream.of(resetOne.join().statusCode(), resetTwo.join().statusCode()).sorted().toList());
            assertEquals(400, send(client, "/verify-reset", token(recovery), null, null).statusCode());
            assertEquals(401, send(client, PROFILE, null, second, null).statusCode());
            assertEquals(401, send(client, PROFILE, null, concurrent, null).statusCode());
            assertEquals(401,browserRefresh(client,refreshCookie,origin).statusCode());
            assertEquals(401, send(client, LOGIN, login(EMAIL, OLD), null, null).statusCode());
            String renewed = issued(send(client, LOGIN, login(EMAIL, NEW), null, null));
            store.recoverOffline(bcrypt.hash("offline-fixture-password"));
            assertEquals(401, send(client, PROFILE, null, renewed, null).statusCode());
            assertEquals(1, events("password_reset"));
            assertEquals(1, events("logout"));
            assertEquals(1, events("owner_password_recovered_offline"));

            for (int i = 0; i < 6; i++) {
                assertEquals(202, send(client, "/forgot-password", email("unknown@example.test"), null, null).statusCode());
            }
            assertEquals(429, send(client, "/forgot-password", email(EMAIL), null, null).statusCode());
        }
    }

    private long events(String event) {
        return database.sql("SELECT count(*) FROM bizflow_foundation.security_audit WHERE event=?")
                .param(event).query(Long.class).single();
    }

    private HttpResponse<String> browserRefresh(HttpClient client,String cookie,String origin) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/v1/auth/browser-refresh"))
                .header("Origin",origin).header("Cookie",cookie).POST(HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static String signed(JwtEncoder signer, Jwt template, Instant expires, String audience) {
        var claims = JwtClaimsSet.builder().issuer(template.getIssuer().toString()).audience(List.of(audience))
                .subject(template.getSubject()).id(template.getId()).issuedAt(Instant.now().minusSeconds(60))
                .expiresAt(expires).claim("role", "OWNER").build();
        return signer.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
    }

    private static String issued(HttpResponse<String> response) {
        assertEquals(200, response.statusCode());
        assertTrue(response.headers().allValues("Set-Cookie").isEmpty());
        var match = Pattern.compile("\"accessToken\":\"([^\"]+)\"").matcher(response.body());
        assertTrue(match.find(), "Expected a bearer token");
        return match.group(1);
    }

    private HttpResponse<String> send(HttpClient client, String path, String body, String bearer, String origin) throws Exception {
        return client.send(request(path, body, bearer, origin), HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest request(String path, String body, String bearer, String origin) {
        String route = path.startsWith("/api/") ? path : "/api/v1/auth" + path;
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + route));
        if (body == null) request.GET();
        else request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body));
        if (bearer != null) request.header("Authorization", "Bearer " + bearer);
        if (origin != null) request.header("Origin", origin);
        return request.build();
    }

    private static String login(String email, String password) {
        return "{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password);
    }
    private static String email(String email) { return "{\"email\":\"%s\"}".formatted(email); }
    private static String token(String token) { return "{\"token\":\"%s\"}".formatted(token); }
    private static String reset(String token, String password, String confirmation) {
        return "{\"token\":\"%s\",\"password\":\"%s\",\"confirmation\":\"%s\"}".formatted(token, password, confirmation);
    }

    static final class Outbox implements RecoveryDelivery {
        final AtomicBoolean fail = new AtomicBoolean();
        final LinkedBlockingQueue<URI> links = new LinkedBlockingQueue<>();

        @Override
        public void send(String email, URI link) {
            if (fail.get()) throw new IllegalStateException("Fixture mail failure.");
            if (EMAIL.equals(email)) links.add(link);
        }

        String takeToken() throws InterruptedException {
            URI link = links.poll(8, TimeUnit.SECONDS);
            assertNotNull(link, "Expected a reset link in the private outbox");
            assertEquals("/reset-password", link.getPath());
            assertNull(link.getQuery());
            return link.getFragment();
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class PrivateMail {
        @Bean Outbox outbox() { return new Outbox(); }
    }
}
