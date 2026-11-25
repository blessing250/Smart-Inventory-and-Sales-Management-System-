package com.bizflowjewelry.backend.auth;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.Base64;
import java.util.HexFormat;
import java.security.SecureRandom;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;

@Service
class OwnerAuthentication {
    private static final long LIFETIME_SECONDS = 600;
    static final long BROWSER_SECONDS=28_800;
    private static final SecureRandom RANDOM=new SecureRandom();
    private final AuthStore store;
    private final OwnerPassword password;
    private final JwtEncoder encoder;
    private final String issuer;
    private final String audience;
    private final String dummyHash;

    OwnerAuthentication(AuthStore store, OwnerPassword password, JwtEncoder encoder,
            @Value("${bizflow.auth.issuer}") String issuer, @Value("${bizflow.auth.audience}") String audience) {
        this.store = store;
        this.password = password;
        this.encoder = encoder;
        this.issuer = issuer;
        this.audience = audience;
        this.dummyHash = password.hash(UUID.randomUUID().toString());
    }

    record Token(String accessToken, String tokenType, long expiresIn) {
        @Override public String toString() { return "Owner access token response"; }
    }

    Token login(String email, String secret) {
        BrowserToken result=login(email,secret,false);
        return result==null?null:result.token();
    }

    record BrowserToken(Token token,String refresh) {
        @Override public String toString() { return "Owner browser session response"; }
    }

    BrowserToken login(String email, String secret,boolean browser) {
        var owner = store.findByEmail(normalizeEmail(email));
        boolean matched = password.matches(secret, owner == null ? dummyHash : owner.hash());
        if (owner == null || !owner.active() || !matched) {
            store.audit(null, "login_rejected");
            return null;
        }
        UUID session = UUID.randomUUID();
        Instant now = Instant.now();
        String refresh=browser?random():null;
        if (!store.login(owner,session,now.plusSeconds(browser?BROWSER_SECONDS:LIFETIME_SECONDS),browser?digest(refresh):null)) return null;
        return new BrowserToken(token(owner.id(),session,now),refresh);
    }

    BrowserToken refresh(String prior) {
        if(prior==null || !prior.matches("[A-Za-z0-9_-]{43}")) return null;
        String refresh=random();
        var session=store.rotate(digest(prior),digest(refresh));
        return session==null?null:new BrowserToken(token(session.ownerId(),session.id(),Instant.now()),refresh);
    }

    void revoke(String prior) {
        if(prior!=null && prior.matches("[A-Za-z0-9_-]{43}")) store.revokeBrowser(digest(prior));
    }

    private Token token(String owner,UUID session,Instant now) {
        Instant expires = now.plusSeconds(LIFETIME_SECONDS);
        var claims = JwtClaimsSet.builder().issuer(issuer).audience(List.of(audience)).subject(owner)
                .id(session.toString()).issuedAt(now).expiresAt(expires).claim("role", "OWNER").build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return new Token(token, "Bearer", LIFETIME_SECONDS);
    }

    private static String random() {
        byte[] bytes=new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String digest(String secret) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
        } catch(NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required.",e);
        }
    }

    static String normalizeEmail(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
