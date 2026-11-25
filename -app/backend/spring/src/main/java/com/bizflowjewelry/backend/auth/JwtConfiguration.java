package com.bizflowjewelry.backend.auth;

import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;

@Configuration(proxyBeanMethods = false)
class JwtConfiguration {
    @Bean
    SecretKey ownerSigningKey(@Value("${bizflow.auth.signing-key}") String encoded) {
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException ignored) {
            throw new IllegalStateException("The owner signing key must be base64-encoded.");
        }
        if (bytes.length < 32) throw new IllegalStateException("The owner signing key must contain at least 32 random bytes.");
        return new SecretKeySpec(bytes, "HmacSHA256");
    }

    @Bean
    JwtEncoder ownerJwtEncoder(SecretKey key) {
        return NimbusJwtEncoder.withSecretKey(key).algorithm(MacAlgorithm.HS256).build();
    }

    @Bean
    JwtDecoder ownerJwtDecoder(SecretKey key, AuthStore store,
            @Value("${bizflow.auth.issuer}") String issuer, @Value("${bizflow.auth.audience}") String audience) {
        var decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                new JwtTimestampValidator(Duration.ZERO), new JwtIssuerValidator(issuer),
                jwt -> {
                    var error = OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
                    if (jwt.getExpiresAt() == null || jwt.getIssuedAt() == null
                            || jwt.getAudience() == null || !jwt.getAudience().contains(audience)
                            || !"OWNER".equals(jwt.getClaimAsString("role"))
                            || jwt.getSubject() == null || jwt.getId() == null) return error;
                    try {
                        return store.sessionActive(jwt.getSubject(), UUID.fromString(jwt.getId()))
                                ? OAuth2TokenValidatorResult.success() : error;
                    } catch (IllegalArgumentException | org.springframework.dao.DataAccessException ignored) {
                        return error;
                    }
                }));
        return decoder;
    }
}
