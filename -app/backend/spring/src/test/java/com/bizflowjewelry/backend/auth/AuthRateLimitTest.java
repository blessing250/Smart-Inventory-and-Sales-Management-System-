package com.bizflowjewelry.backend.auth;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthRateLimitTest {
    @Test
    void throttlesLoginWithoutBlockingRecoveryChecks() {
        var limiter = new AuthRateLimit(Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC));
        for (int i = 0; i < 20; i++) assertTrue(limiter.allow(AuthRateLimit.Action.LOGIN));
        assertFalse(limiter.allow(AuthRateLimit.Action.LOGIN));
        assertTrue(limiter.allow(AuthRateLimit.Action.FORGOT));
    }
}
