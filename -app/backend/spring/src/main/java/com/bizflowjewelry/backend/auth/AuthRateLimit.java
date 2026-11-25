package com.bizflowjewelry.backend.auth;

import java.time.Clock;
import java.time.Instant;
import java.util.EnumMap;
import org.springframework.stereotype.Component;

@Component
class AuthRateLimit {
    enum Action {
        LOGIN(20), FORGOT(10), VERIFY(30), RESET(8), REFRESH(120);
        final int limit;
        Action(int limit) { this.limit = limit; }
    }

    private record Window(Instant until, int used) {}
    private final EnumMap<Action, Window> windows = new EnumMap<>(Action.class);
    private final Clock clock;

    AuthRateLimit() { this(Clock.systemUTC()); }
    AuthRateLimit(Clock clock) { this.clock = clock; }

    synchronized boolean allow(Action action) {
        Instant now = clock.instant();
        Window prior = windows.get(action);
        if (prior == null || !now.isBefore(prior.until())) prior = new Window(now.plusSeconds(60), 0);
        if (prior.used() >= action.limit) return false;
        windows.put(action, new Window(prior.until(), prior.used() + 1));
        return true;
    }
}
