package com.bizflowjewelry.backend.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

@Service
class OwnerRecovery {
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{43}");
    private static final Logger LOG = LoggerFactory.getLogger(OwnerRecovery.class);
    private final SecureRandom random = new SecureRandom();
    private final AuthStore store;
    private final OwnerPassword password;
    private final AuthOrigin origin;
    private final RecoveryDelivery delivery;
    private final Executor executor;

    OwnerRecovery(AuthStore store, OwnerPassword password, AuthOrigin origin, ObjectProvider<RecoveryDelivery> delivery,
            @Qualifier("recoveryExecutor") Executor executor) {
        this.store = store;
        this.password = password;
        this.origin = origin;
        this.delivery = delivery.getIfAvailable();
        this.executor = executor;
    }

    boolean available() { return delivery != null; }

    void request(String email) {
        try {
            executor.execute(() -> {
                try {
                    send(OwnerAuthentication.normalizeEmail(email));
                } catch (RuntimeException ignored) {
                    LOG.warn("Owner password recovery request failed.");
                }
            });
        } catch (RejectedExecutionException ignored) {
            LOG.warn("Owner password recovery queue is full.");
        }
    }

    private void send(String email) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String hash = digest(token);
        if (!store.issueReset(email, hash)) return;
        try {
            delivery.send(email, origin.resetLink(token));
        } catch (RuntimeException ignored) {
            store.deliveryFailed(hash);
            LOG.warn("Owner password recovery delivery failed.");
        }
    }

    boolean valid(String token) {
        return token != null && TOKEN.matcher(token).matches() && store.resetOwner(digest(token)) != null;
    }

    boolean reset(String token, String secret) {
        if (token == null || !TOKEN.matcher(token).matches() || !password.meetsPolicy(secret)) return false;
        String hash = digest(token);
        String id = store.resetOwner(hash);
        return id != null && store.resetPassword(id, hash, password.hash(secret));
    }

    private static String digest(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 unavailable.", error);
        }
    }
}
