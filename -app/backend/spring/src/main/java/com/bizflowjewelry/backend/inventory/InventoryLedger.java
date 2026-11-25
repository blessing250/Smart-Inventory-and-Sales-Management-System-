package com.bizflowjewelry.backend.inventory;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.web.server.ResponseStatusException;

@Service
public class InventoryLedger {
    private static final long MAX_QUANTITY = 1_000_000_000L;
    private static final long MAX_VALUE = 9_007_199_254_740_991L;
    private final JdbcClient sql;

    InventoryLedger(JdbcClient sql) { this.sql = sql; }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID receivePurchase(String productId, long quantity, long landedValue, String receiptLine, String tracking, String actor) {
        requireQuantity(quantity);
        if (landedValue < 0) throw invalid("Landed cost cannot be negative.");
        lockProduct(productId);
        return post(position(productId), "PURCHASE_RECEIPT", quantity, landedValue,
                "receipt:" + receiptLine, "Confirmed usable receipt for shipment " + tracking, actor, null).id();
    }

    public record SaleMovement(UUID id, long costRwf) {}

    @Transactional(propagation=Propagation.MANDATORY)
    public UUID correctPurchaseReceipt(UUID id,String reason,String actor) {
        Movement original=movement(id);
        lockProduct(original.productId());
        Position current=position(original.productId());
        if(!"PURCHASE_RECEIPT".equals(original.kind()) || current.version()!=original.balanceVersion()
                || current.quantity()!=original.afterQuantity() || current.valueRwf()!=original.afterValueRwf()) {
            throw conflict("Stock moved after this receipt. Reconcile later sales, returns or adjustments before correcting it.");
        }
        return post(current,"REVERSAL",-original.delta(),-original.valueDeltaRwf(),
                "receipt:correction:"+id,reason,actor,id).id();
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void lockProducts(java.util.Collection<String> products) {
        products.stream().distinct().sorted().forEach(this::lockProduct);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void requireAvailable(String productId, long quantity) {
        lockProduct(productId);
        if (quantity > position(productId).quantity()) throw conflict("Insufficient available stock.");
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public SaleMovement sell(String productId, long quantity, String itemId, String actor) {
        requireQuantity(quantity);
        Product product = lockProduct(productId);
        Position before = position(productId);
        Movement movement = post(before, "SALE", -quantity, adjustmentValue(product, before, -quantity),
                "sale:" + itemId, "Completed sale", actor, null);
        return new SaleMovement(movement.id(), -movement.valueDeltaRwf());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public UUID returnSale(String productId, long quantity, long originalCost, String returnId, String actor) {
        requireQuantity(quantity);
        if (originalCost < 0) throw invalid("Restored cost cannot be negative.");
        lockProduct(productId);
        return post(position(productId), "SALE_RETURN", quantity, originalCost,
                "return:" + returnId, "Confirmed usable sale return", actor, null).id();
    }

    record Position(String productId, long quantity, long valueRwf, long version) {}
    record Product(String id, long estimatedUnitCost, OffsetDateTime archivedAt) {}
    record Movement(UUID id, String productId, String kind, String reference, String reason, String actorId,
                    long quantity, String direction, long delta, long beforeQuantity, long afterQuantity,
                    long valueDeltaRwf, long beforeValueRwf, long afterValueRwf, long balanceVersion,
                    UUID reversesId, OffsetDateTime recordedAt) {}
    record Count(UUID id, String productId, String reference, long expectedQuantity, long observedQuantity,
                 long difference, long expectedVersion, String reason, String countedBy, OffsetDateTime countedAt,
                 String confirmedBy, OffsetDateTime confirmedAt, UUID movementId) {}

    static final String MOVEMENT_FIELDS = """
            m.*, abs(m.delta) AS quantity, CASE WHEN m.delta > 0 THEN 'IN' ELSE 'OUT' END AS direction
            """;

    @Transactional
    Movement open(String productId, long quantity, long valueRwf, String reference, String reason, String actor) {
        requireQuantity(quantity);
        if (valueRwf < 0) throw invalid("Opening stock value cannot be negative.");
        lockProduct(productId);
        Position before = position(productId);
        if (before.version() != 0) throw conflict("Opening stock is only allowed before the first movement.");
        return post(before, "OPENING", quantity, valueRwf, externalReference(reference), reason, actor, null);
    }

    @Transactional
    Movement adjust(String productId, String type, long quantity, String reference, String reason, String actor) {
        requireQuantity(quantity);
        Product product = lockProduct(productId);
        Position before = position(productId);
        long delta = switch (type) {
            case "INCREASE" -> quantity;
            case "DECREASE", "DAMAGE_OUT", "MISSING_OUT" -> -quantity;
            default -> throw invalid("Choose a supported adjustment type.");
        };
        String kind = type.equals("DAMAGE_OUT") || type.equals("MISSING_OUT") ? type : "ADJUSTMENT";
        return post(before, kind, delta, adjustmentValue(product, before, delta), externalReference(reference), reason, actor, null);
    }

    @Transactional
    Count draftCount(String productId, long observed, long expectedVersion, String reference, String reason, String actor) {
        lockProduct(productId);
        Position before = position(productId);
        assertVersion(before, expectedVersion);
        UUID id = UUID.randomUUID();
        sql.sql("""
                INSERT INTO bizflow_foundation.inventory_counts
                    (id,product_id,reference,expected_quantity,observed_quantity,expected_version,reason,counted_by)
                VALUES (?,?,?,?,?,?,?,?)
                """).params(id, productId, externalReference(reference), before.quantity(), observed,
                before.version(), required(reason), actor).update();
        return count(id);
    }

    @Transactional
    Count confirm(UUID id, String actor) {
        Count draft = count(id);
        if (draft.confirmedAt() != null) return draft;
        Product product = lockProduct(draft.productId());
        draft = count(id);
        if (draft.confirmedAt() != null) return draft;
        Position before = position(draft.productId());
        assertVersion(before, draft.expectedVersion());
        if (before.quantity() != draft.expectedQuantity()) throw conflict("Stock changed. Review and prepare a new count.");
        long delta = draft.observedQuantity() - draft.expectedQuantity();
        UUID movement = delta == 0 ? null : post(before, "COUNT", delta, adjustmentValue(product, before, delta),
                "count:" + id, draft.reason(), actor, null).id();
        sql.sql("""
                UPDATE bizflow_foundation.inventory_counts
                SET movement_id=?, confirmed_by=?, confirmed_at=clock_timestamp() WHERE id=?
                """).params(movement, actor, id).update();
        return count(id);
    }

    @Transactional
    Movement reverse(UUID id, String reference, String reason, String actor) {
        var original = movement(id);
        lockProduct(original.productId());
        if ("PURCHASE_RECEIPT".equals(original.kind())) throw conflict("A purchase receipt requires a coordinated receiving correction.");
        if ("SALE".equals(original.kind()) || "SALE_RETURN".equals(original.kind())) {
            throw conflict("Sale movements require a coordinated sales correction.");
        }
        Position current = position(original.productId());
        if (original.reversesId() != null || current.version() != original.balanceVersion()
                || current.quantity() != original.afterQuantity() || current.valueRwf() != original.afterValueRwf()) {
            throw conflict("Only the latest unreversed movement with a matching balance can be reversed.");
        }
        return post(current, "REVERSAL", -original.delta(), -original.valueDeltaRwf(),
                externalReference(reference), reason, actor, id);
    }

    Count count(UUID id) {
        return sql.sql("SELECT * FROM bizflow_foundation.inventory_counts WHERE id=?").param(id).query(Count.class)
                .optional().orElseThrow(() -> missing("Stock count not found."));
    }

    Movement movement(UUID id) {
        return sql.sql("SELECT " + MOVEMENT_FIELDS + " FROM bizflow_foundation.inventory_movements m WHERE m.id=?")
                .param(id).query(Movement.class).optional().orElseThrow(() -> missing("Stock movement not found."));
    }

    private Product lockProduct(String id) {
        var product = sql.sql("""
                SELECT id, estimated_unit_cost, archived_at FROM bizflow_foundation.catalog_products WHERE id=? FOR UPDATE
                """).param(id).query(Product.class).optional().orElseThrow(() -> missing("Product not found."));
        if (product.archivedAt() != null) throw conflict("Product is archived.");
        return product;
    }

    private Position position(String productId) {
        sql.sql("INSERT INTO bizflow_foundation.inventory_balances (product_id) VALUES (?) ON CONFLICT DO NOTHING")
                .param(productId).update();
        return sql.sql("SELECT product_id,quantity,value_rwf,version FROM bizflow_foundation.inventory_balances WHERE product_id=?")
                .param(productId).query(Position.class).single();
    }

    private Movement post(Position before, String kind, long delta, long valueDelta, String reference, String reason,
                          String actor, UUID reversesId) {
        if (delta == 0 || delta < -MAX_QUANTITY || delta > MAX_QUANTITY) throw invalid("Movement quantity is invalid.");
        long quantity = before.quantity() + delta;
        if (quantity < 0) throw conflict("Insufficient available stock.");
        if (quantity > MAX_QUANTITY) throw invalid("Available stock exceeds the supported range.");
        if (valueDelta < -MAX_VALUE || valueDelta > MAX_VALUE) throw invalid("Stock value exceeds the supported range.");
        long value = before.valueRwf() + valueDelta;
        if (value < 0 || value > MAX_VALUE || (quantity == 0 && value != 0)) throw invalid("Stock valuation is invalid.");
        long version = Math.incrementExact(before.version());
        UUID id = UUID.randomUUID();
        sql.sql("""
                UPDATE bizflow_foundation.inventory_balances
                SET quantity=?, value_rwf=?, version=?, updated_at=clock_timestamp() WHERE product_id=?
                """).params(quantity, value, version, before.productId()).update();
        sql.sql("""
                INSERT INTO bizflow_foundation.inventory_movements
                    (id,product_id,kind,reference,reason,actor_id,delta,before_quantity,after_quantity,
                     value_delta_rwf,before_value_rwf,after_value_rwf,balance_version,reverses_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """).params(id, before.productId(), kind, reference, required(reason), actor, delta, before.quantity(),
                quantity, valueDelta, before.valueRwf(), value, version, reversesId).update();
        return movement(id);
    }

    private static long adjustmentValue(Product product, Position before, long delta) {
        if (delta < -before.quantity()) throw conflict("Insufficient available stock.");
        if (before.quantity() == 0) return Math.multiplyExact(delta, product.estimatedUnitCost());
        var denominator = BigInteger.valueOf(before.quantity());
        var value = BigInteger.valueOf(before.valueRwf()).multiply(BigInteger.valueOf(Math.abs(delta)))
                .add(denominator.divide(BigInteger.TWO)).divide(denominator);
        if (value.compareTo(BigInteger.valueOf(MAX_VALUE)) > 0) throw invalid("Stock value exceeds the supported range.");
        return delta < 0 ? -value.longValueExact() : value.longValueExact();
    }

    private static void assertVersion(Position balance, long expectedVersion) {
        if (balance.version() != expectedVersion) throw conflict("Stock changed. Review and prepare a new count.");
    }

    private static void requireQuantity(long quantity) {
        if (quantity < 1 || quantity > MAX_QUANTITY) throw invalid("Movement quantity is invalid.");
    }

    private static String externalReference(String value) {
        String result = required(value);
        String prefix = result.toLowerCase(Locale.ROOT);
        if (prefix.startsWith("count:") || prefix.startsWith("receipt:") || prefix.startsWith("sale:") || prefix.startsWith("return:")) {
            throw invalid("This reference prefix is reserved.");
        }
        return result;
    }

    private static String required(String value) {
        if (value == null || value.isBlank()) throw invalid("A reference and reason are required.");
        return value.strip();
    }
    private static ResponseStatusException invalid(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT, message); }
    private static ResponseStatusException missing(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND, message); }
}
