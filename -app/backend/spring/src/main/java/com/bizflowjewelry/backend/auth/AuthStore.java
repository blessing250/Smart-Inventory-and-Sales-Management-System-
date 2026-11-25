package com.bizflowjewelry.backend.auth;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
class AuthStore {
    private final JdbcClient sql;

    AuthStore(JdbcClient sql) {
        this.sql = sql;
    }

    record Owner(String id, String email, String name, String hash, boolean active, boolean verified) {}

    private Owner owner(String condition, Object... args) {
        return sql.sql("""
                SELECT id,email,display_name,password_hash,active,recovery_verified_at IS NOT NULL AS verified
                FROM bizflow_foundation.owner_accounts
                """ + condition).params(args).query((row, number) -> new Owner(
                row.getString("id"), row.getString("email"), row.getString("display_name"),
                row.getString("password_hash"), row.getBoolean("active"), row.getBoolean("verified")))
                .optional().orElse(null);
    }

    Owner findByEmail(String email) {
        return owner("WHERE email = ?", email);
    }

    Owner findById(String id) {
        return owner("WHERE id = ?", id);
    }

    boolean sessionActive(String id, UUID session) {
        return sql.sql("""
                SELECT EXISTS (SELECT 1 FROM bizflow_foundation.owner_sessions s
                  JOIN bizflow_foundation.owner_accounts o ON s.owner_id=o.id
                  WHERE s.id=? AND o.id=? AND o.active AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP)
                """).params(session, id).query(Boolean.class).single();
    }

    void audit(String owner, String event) {
        sql.sql("INSERT INTO bizflow_foundation.security_audit (owner_id,event) VALUES (?,?)")
                .param(1, owner, java.sql.Types.VARCHAR).param(2, event).update();
    }

    @Transactional
    boolean login(Owner checked, UUID session, Instant expiration,String refreshHash) {
        Owner current = owner("WHERE id=? FOR UPDATE", checked.id());
        if (current == null || !current.active() || !current.hash().equals(checked.hash())
                || !current.email().equals(checked.email())) return false;
        sql.sql("INSERT INTO bizflow_foundation.owner_sessions (id,owner_id,expires_at,refresh_hash) VALUES (?,?,?,?)")
                .params(session, current.id(), Timestamp.from(expiration),refreshHash).update();
        audit(current.id(), "login_succeeded");
        return true;
    }

    record BrowserSession(UUID id,String ownerId) {}

    @Transactional
    BrowserSession rotate(String current,String next) {
        return sql.sql("""
                UPDATE bizflow_foundation.owner_sessions s SET refresh_hash=?
                FROM bizflow_foundation.owner_accounts o WHERE o.id=s.owner_id AND o.active
                    AND s.refresh_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP
                RETURNING s.id,s.owner_id
                """).params(next,current).query(BrowserSession.class).optional().orElse(null);
    }

    @Transactional
    void revokeBrowser(String hash) {
        sql.sql("""
                UPDATE bizflow_foundation.owner_sessions SET revoked_at=CURRENT_TIMESTAMP
                WHERE refresh_hash=? AND revoked_at IS NULL RETURNING owner_id
                """).param(hash).query(String.class).optional().ifPresent(owner->audit(owner,"logout"));
    }

    @Transactional
    void logout(String ownerId, UUID session) {
        int updated = sql.sql("""
                UPDATE bizflow_foundation.owner_sessions SET revoked_at=CURRENT_TIMESTAMP
                WHERE id=? AND owner_id=? AND revoked_at IS NULL
                """).params(session, ownerId).update();
        if (updated == 1) audit(ownerId, "logout");
    }

    @Transactional
    boolean issueReset(String email, String hash) {
        Owner owner = owner("WHERE email=? FOR UPDATE", email);
        if (owner == null || !owner.verified() || !owner.active()) return false;
        int written = sql.sql("""
                INSERT INTO bizflow_foundation.owner_password_resets (owner_id,token_hash,expires_at)
                VALUES (?,?,CURRENT_TIMESTAMP + INTERVAL '30 minutes')
                ON CONFLICT (owner_id) DO UPDATE SET token_hash=excluded.token_hash,
                    expires_at=excluded.expires_at, requested_at=CURRENT_TIMESTAMP, consumed_at=NULL
                WHERE owner_password_resets.requested_at <= CURRENT_TIMESTAMP - INTERVAL '1 minute'
                   OR owner_password_resets.consumed_at IS NOT NULL
                """).params(owner.id(), hash).update();
        if (written == 1) audit(owner.id(), "recovery_requested");
        return written == 1;
    }

    @Transactional
    void deliveryFailed(String hash) {
        sql.sql("""
                UPDATE bizflow_foundation.owner_password_resets SET consumed_at=CURRENT_TIMESTAMP
                WHERE token_hash=? AND consumed_at IS NULL RETURNING owner_id
                """).param(hash).query(String.class).optional().ifPresent(id -> audit(id, "recovery_delivery_failed"));
    }

    String resetOwner(String hash) {
        return sql.sql("""
                SELECT r.owner_id FROM bizflow_foundation.owner_password_resets r
                JOIN bizflow_foundation.owner_accounts o ON o.id=r.owner_id
                WHERE r.token_hash=? AND r.consumed_at IS NULL AND r.expires_at > CURRENT_TIMESTAMP
                    AND o.active AND o.recovery_verified_at IS NOT NULL
                """).param(hash).query(String.class).optional().orElse(null);
    }

    @Transactional
    boolean resetPassword(String id, String tokenHash, String passwordHash) {
        Owner owner = owner("WHERE id=? FOR UPDATE", id);
        if (owner == null || !owner.active() || !owner.verified() || !id.equals(resetOwner(tokenHash))) return false;
        replacePassword(id, passwordHash, "password_reset");
        return true;
    }

    @Transactional
    void provision(String email, String name, String hash, boolean verified) {
        String id = UUID.randomUUID().toString();
        sql.sql("""
                INSERT INTO bizflow_foundation.owner_accounts (id,email,display_name,password_hash,recovery_verified_at)
                VALUES (?,?,?,?,CASE WHEN ? THEN CURRENT_TIMESTAMP END)
                """).params(id, email, name, hash, verified).update();
        audit(id, "owner_provisioned_offline");
    }

    @Transactional
    void recoverOffline(String hash) {
        Owner owner = owner("WHERE singleton FOR UPDATE");
        if (owner == null || !owner.active()) throw new IllegalStateException("No active owner is registered.");
        replacePassword(owner.id(), hash, "owner_password_recovered_offline");
    }

    private void replacePassword(String id, String hash, String event) {
        sql.sql("""
                UPDATE bizflow_foundation.owner_accounts SET password_hash=?, password_changed_at=CURRENT_TIMESTAMP WHERE id=?
                """).params(hash, id).update();
        sql.sql("""
                UPDATE bizflow_foundation.owner_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE owner_id=? AND revoked_at IS NULL
                """).param(id).update();
        sql.sql("""
                UPDATE bizflow_foundation.owner_password_resets SET consumed_at=CURRENT_TIMESTAMP WHERE owner_id=? AND consumed_at IS NULL
                """).param(id).update();
        audit(id, event);
    }
}
