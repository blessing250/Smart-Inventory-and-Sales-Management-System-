package com.bizflowjewelry.backend.inventory;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class InventoryQueries {
    private static final ZoneId KIGALI = ZoneId.of("Africa/Kigali");
    private static final String PRODUCT_JOIN = """
            FROM bizflow_foundation.catalog_products p
            LEFT JOIN bizflow_foundation.inventory_balances b ON b.product_id=p.id
            """;
    private static final String BALANCE_FIELDS = """
            p.id AS product_id, p.sku, p.name, p.archived_at IS NOT NULL AS archived, COALESCE(b.quantity,0) AS quantity,
            COALESCE(b.value_rwf,0) AS value_rwf, COALESCE(b.version,0) AS version, b.updated_at
            """;
    private final JdbcClient sql;

    InventoryQueries(JdbcClient sql) { this.sql = sql; }

    record Page<T>(List<T> items, int page, int size, long total) {}
    record Balance(String productId, String sku, String name, boolean archived, long quantity, long valueRwf,
                   long version, OffsetDateTime updatedAt) {}
    record Unavailable(long damagedRecorded, long missingRecorded, Long awaitingReceiptQuantity) {}
    record LedgerTotals(long quantity, long valueRwf, long movementCount, long openingQuantity,
                        long openingValueRwf, long countDelta, long brokenLinks) {}
    record CountTotals(long confirmedCount, long countDelta, long brokenLinks) {}
    record Reconciliation(Balance balance, LedgerTotals ledger, CountTotals counts, Unavailable unavailable,
                          boolean matches) {}

    Balance balance(String productId) {
        return sql.sql("SELECT " + BALANCE_FIELDS + PRODUCT_JOIN + " WHERE p.id=?").param(productId)
                .query(Balance.class).optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Product not found."));
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Page<Balance> balances(String q, int page, int size) {
        var query = new Filter(PRODUCT_JOIN);
        query.search(q, "p.sku || ' ' || p.name");
        return query.page(BALANCE_FIELDS, "lower(p.name),p.id", page, size, Balance.class);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Page<InventoryLedger.Movement> movements(String product, String q, String kind, LocalDate from, LocalDate to, int page, int size) {
        if (product != null) balance(product);
        var query = new Filter("""
                FROM bizflow_foundation.inventory_movements m JOIN bizflow_foundation.catalog_products p ON p.id=m.product_id
                """);
        query.equal(product, "m.product_id");
        query.equal(kind, "m.kind");
        query.search(q, "p.sku || ' ' || p.name || ' ' || m.reference || ' ' || m.reason");
        query.dates(from, to, "m.recorded_at");
        return query.page(InventoryLedger.MOVEMENT_FIELDS, "m.recorded_at DESC,m.balance_version DESC,m.id", page, size,
                InventoryLedger.Movement.class);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Page<InventoryLedger.Count> counts(String product, String q, String status, LocalDate from, LocalDate to, int page, int size) {
        if (product != null) balance(product);
        var query = new Filter("""
                FROM bizflow_foundation.inventory_counts c JOIN bizflow_foundation.catalog_products p ON p.id=c.product_id
                """);
        query.equal(product, "c.product_id");
        if ("pending".equals(status)) query.where.append(" AND c.confirmed_at IS NULL");
        if ("confirmed".equals(status)) query.where.append(" AND c.confirmed_at IS NOT NULL");
        if (status != null && !List.of("all", "pending", "confirmed").contains(status)) {
            throw invalid("Choose a valid count status.");
        }
        query.search(q, "p.sku || ' ' || p.name || ' ' || c.reference || ' ' || c.reason");
        query.dates(from, to, "c.counted_at");
        return query.page("c.*", "c.counted_at DESC,c.id", page, size, InventoryLedger.Count.class);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Unavailable unavailable(String productId) {
        balance(productId);
        return dispositions(productId);
    }

    private Unavailable dispositions(String productId) {
        return sql.sql("""
                SELECT COALESCE(SUM(-m.delta) FILTER (WHERE m.kind='DAMAGE_OUT'),0),
                       COALESCE(SUM(-m.delta) FILTER (WHERE m.kind='MISSING_OUT'),0)
                FROM bizflow_foundation.inventory_movements m WHERE m.product_id=?
                    AND m.kind IN ('DAMAGE_OUT','MISSING_OUT')
                    AND NOT EXISTS (SELECT 1 FROM bizflow_foundation.inventory_movements r WHERE r.reverses_id=m.id)
                """).param(productId).query((row, index) -> new Unavailable(row.getLong(1), row.getLong(2), null)).single();
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Reconciliation reconcile(String productId) {
        Balance current = balance(productId);
        var ledger = sql.sql("""
                WITH ordered AS (
                    SELECT m.*, row_number() OVER w AS position,
                           lag(after_quantity,1,0::bigint) OVER w AS previous_quantity,
                           lag(after_value_rwf,1,0::bigint) OVER w AS previous_value
                    FROM bizflow_foundation.inventory_movements m WHERE product_id=?
                    WINDOW w AS (ORDER BY balance_version)
                )
                SELECT COALESCE(SUM(delta),0) AS quantity, COALESCE(SUM(value_delta_rwf),0) AS value_rwf,
                       count(*) AS movement_count, COALESCE(SUM(delta) FILTER (WHERE kind='OPENING'),0) AS opening_quantity,
                       COALESCE(SUM(value_delta_rwf) FILTER (WHERE kind='OPENING'),0) AS opening_value_rwf,
                       COALESCE(SUM(delta) FILTER (WHERE kind='COUNT'),0) AS count_delta,
                       count(*) FILTER (WHERE balance_version<>position OR before_quantity<>previous_quantity
                           OR before_value_rwf<>previous_value OR (kind='COUNT' AND NOT EXISTS (
                               SELECT 1 FROM bizflow_foundation.inventory_counts c
                               WHERE c.movement_id=ordered.id AND c.confirmed_at IS NOT NULL))) AS broken_links
                FROM ordered
                """).param(productId).query(LedgerTotals.class).single();
        var counts = sql.sql("""
                SELECT count(*) AS confirmed_count, COALESCE(SUM(c.difference),0) AS count_delta,
                       count(*) FILTER (WHERE c.expected_quantity<>c.observed_quantity AND
                           (m.id IS NULL OR m.kind<>'COUNT' OR m.before_quantity<>c.expected_quantity
                            OR m.after_quantity<>c.observed_quantity OR m.balance_version<>c.expected_version+1)) AS broken_links
                FROM bizflow_foundation.inventory_counts c
                LEFT JOIN bizflow_foundation.inventory_movements m ON m.id=c.movement_id
                WHERE c.product_id=? AND c.confirmed_at IS NOT NULL
                """).param(productId).query(CountTotals.class).single();
        boolean matches = current.quantity() == ledger.quantity() && current.valueRwf() == ledger.valueRwf()
                && current.version() == ledger.movementCount() && ledger.brokenLinks() == 0
                && counts.brokenLinks() == 0 && counts.countDelta() == ledger.countDelta();
        return new Reconciliation(current, ledger, counts, dispositions(productId), matches);
    }

    private final class Filter {
        private final StringBuilder where;
        private final List<Object> params = new ArrayList<>();

        private Filter(String from) { where = new StringBuilder(from).append(" WHERE true"); }

        private void equal(String value, String column) {
            if (value == null) return;
            where.append(" AND ").append(column).append("=?");
            params.add(value);
        }

        private void search(String query, String columns) {
            if (query == null || query.isBlank()) return;
            where.append(" AND strpos(lower(").append(columns).append("),lower(?))>0");
            params.add(query.strip());
        }

        private void dates(LocalDate from, LocalDate to, String column) {
            if (from != null && to != null && from.isAfter(to)) throw invalid("Start date follows end date.");
            if (from != null) {
                where.append(" AND ").append(column).append(">=?");
                params.add(from.atStartOfDay(KIGALI).toOffsetDateTime());
            }
            if (to != null) {
                if (to.getYear() >= 9999) throw invalid("End date exceeds the supported range.");
                where.append(" AND ").append(column).append("<?");
                params.add(to.plusDays(1).atStartOfDay(KIGALI).toOffsetDateTime());
            }
        }

        private <T> Page<T> page(String fields, String order, int page, int size, Class<T> type) {
            long total = sql.sql("SELECT count(*) " + where).params(params).query(Long.class).single();
            params.add(size);
            params.add((long) page * size);
            var rows = sql.sql("SELECT " + fields + where + " ORDER BY " + order + " LIMIT ? OFFSET ?")
                    .params(params).query(type).list();
            return new Page<>(rows, page, size, total);
        }
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
