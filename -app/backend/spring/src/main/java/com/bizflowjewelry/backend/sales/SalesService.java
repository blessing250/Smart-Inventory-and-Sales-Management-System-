package com.bizflowjewelry.backend.sales;

import com.bizflowjewelry.backend.finance.FinancialPostingService;
import com.bizflowjewelry.backend.inventory.InventoryLedger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

import static com.bizflowjewelry.backend.sales.SalesController.*;

@Service
class SalesService {
    private static final long MAX_TOTAL = 1_000_000_000_000L;
    private final JdbcClient db;
    private final InventoryLedger inventory;
    private final FinancialPostingService finance;
    private final ObjectMapper json;

    SalesService(JdbcClient db, InventoryLedger inventory, FinancialPostingService finance, ObjectMapper json) {
        this.db = db;
        this.inventory = inventory;
        this.finance = finance;
        this.json = json;
    }

    record Customer(String id, String name, String phone, String email, String actorId, OffsetDateTime createdAt) {}
    record CustomerBalance(String customerId, long outstandingRwf, long openSales) {}
    record Product(String id, String name, String sku, long sellingPrice,String category) {}
    record Sale(String id, String reference, String customerId, String customerName, LocalDate saleDate, String channel,
                long grossRwf, long discountRwf, long totalRwf, long creditRwf, long receivedRwf, long reversedRwf,
                long refundedRwf, long paidRwf, long outstandingRwf, long costRwf, long restoredRwf, long grossProfitRwf,
                String status, String actorId, OffsetDateTime createdAt) {}
    record Item(String id, String saleId, String productId, String productName, String sku, long quantity, long unitPriceRwf,
                long unitDiscountRwf, long revenueRwf, long costRwf, long returned, UUID movementId, OffsetDateTime createdAt) {}
    record Payment(String id, String saleId, String reference, String method, String postingId, long amountRwf, String accountId,
                   String actorId, OffsetDateTime recordedAt, String reversalId, String reversalReason) {}
    record Return(String id, String saleId, String itemId, String reference, long quantity, String reason, String condition,
                  long revenueCreditRwf, long restoredCostRwf, long refundRwf, String refundAccountId, String refundPostingId,
                  UUID movementId, String actorId, OffsetDateTime recordedAt) {}
    record SaleDetail(Sale sale, List<Item> items, List<Payment> payments, List<Return> returns) {}
    record Reconciliation(long itemRevenueRwf, long itemCostRwf, long stockValueRemovedRwf, long stockValueRestoredRwf,
                          long brokenLinks, boolean matches) {}
    record Page<T>(List<T> items, int page, int size, long total) {}
    private record Existing(String id, String saleId, String requestHash) {}
    private record Priced(Product product, long quantity, long price, long discount) {
        long gross() { return price * quantity; }
        long reduction() { return discount * quantity; }
        long revenue() { return gross() - reduction(); }
    }

    private static final String ITEMS = """
            SELECT i.*, (SELECT coalesce(sum(quantity),0)::bigint FROM bizflow_foundation.sale_returns WHERE item_id=i.id) AS returned
            FROM bizflow_foundation.sale_items i
            """;
    private static final String PAYMENTS = """
            SELECT sp.*, p.amount_rwf, p.to_account AS account_id, p.actor_id, p.recorded_at,
                   rev.id AS reversal_id, rev.reason AS reversal_reason
            FROM bizflow_foundation.sale_payments sp JOIN bizflow_foundation.financial_postings p ON p.id=sp.posting_id
            LEFT JOIN bizflow_foundation.financial_postings rev ON rev.reverses_id=p.id
            """;
    private static final String RETURNS = """
            SELECT r.*, coalesce(f.amount_rwf,0) AS refund_rwf, f.from_account AS refund_account_id
            FROM bizflow_foundation.sale_returns r LEFT JOIN bizflow_foundation.financial_postings f ON f.id=r.refund_posting_id
            """;

    @Transactional
    Customer createCustomer(CustomerInput input, String actor) {
        String id = id();
        db.sql("INSERT INTO bizflow_foundation.customers(id,name,phone,email,actor_id) VALUES (?,?,?,?,?)")
                .params(id, input.name().strip(), clean(input.phone()), clean(input.email()), actor).update();
        audit("customer_created", id, actor);
        return customer(id);
    }

    Customer customer(String id) {
        return db.sql("SELECT * FROM bizflow_foundation.customers WHERE id=?").param(id).query(Customer.class)
                .optional().orElseThrow(() -> missing("Customer not found."));
    }

    Product product(String id) {
        return db.sql("SELECT id,name,sku,selling_price,category FROM bizflow_foundation.catalog_products WHERE id=? AND archived_at IS NULL")
                .param(id).query(Product.class).optional().orElseThrow(() -> invalid("Choose an active product."));
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    Page<Customer> customers(String q, int page, int size) {
        return page(" FROM bizflow_foundation.customers WHERE (?='' OR strpos(lower(name || ' ' || phone || ' ' || email),lower(?))>0)",
                Arrays.asList(clean(q), clean(q)), "lower(name),id", page, size, Customer.class);
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    Page<Sale> customerSales(String id, int page, int size) {
        customer(id);
        return list(null, null, null, null, id, page, size);
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    CustomerBalance customerBalance(String id) {
        customer(id);
        return db.sql("""
                SELECT ?::text AS customer_id, coalesce(sum(outstanding_rwf),0)::bigint AS outstanding_rwf,
                       count(*) FILTER (WHERE outstanding_rwf>0) AS open_sales
                FROM bizflow_foundation.sale_balances WHERE customer_id=?
                """).params(id,id).query(CustomerBalance.class).single();
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    Page<Sale> list(String q, String status, LocalDate from, LocalDate to, String customer, int page, int size) {
        if (from != null && to != null && from.isAfter(to)) throw invalid("The date range is reversed.");
        return page("""
                 FROM bizflow_foundation.sale_balances
                 WHERE (?='' OR strpos(lower(reference || ' ' || coalesce(customer_name,'')),lower(?))>0)
                   AND status=coalesce(?,status) AND sale_date>=coalesce(?,sale_date) AND sale_date<=coalesce(?,sale_date)
                   AND (?::text IS NULL OR customer_id=?)
                """, Arrays.asList(clean(q), clean(q), status, from, to, customer, customer),
                "sale_date DESC,created_at DESC,id", page, size, Sale.class);
    }

    @Transactional
    SaleDetail checkout(SaleInput input, String actor) {
        if (input.reference().strip().startsWith("online:")) throw invalid("This sale reference prefix is reserved.");
        return complete(input, actor);
    }

    @Transactional(propagation=Propagation.MANDATORY)
    SaleDetail complete(SaleInput input, String actor) {
        lockWrites();
        String reference = input.reference().strip();
        List<PaymentInput> payments = paymentList(input.payments());
        String hash = hash(new SaleInput(reference, input.date(), input.channel().strip(), input.customerId(),
                clean(input.customerName()), input.items(), payments));
        var existing = db.sql("SELECT id, id AS sale_id, request_hash FROM bizflow_foundation.retail_sales WHERE reference=?")
                .param(reference).query(Existing.class).optional();
        if (existing.isPresent()) {
            if (!hash.equals(existing.get().requestHash())) throw conflict("The sale reference belongs to a different request.");
            return detail(existing.get().id());
        }
        var quantities = new TreeMap<String, Long>();
        input.items().forEach(line -> quantities.merge(line.productId(), line.quantity(), Long::sum));
        inventory.lockProducts(quantities.keySet());
        quantities.forEach(inventory::requireAvailable);
        var items = input.items().stream().map(line -> price(line, product(line.productId()))).toList();
        long gross = items.stream().mapToLong(Priced::gross).sum();
        long discount = items.stream().mapToLong(Priced::reduction).sum();
        long total = gross - discount;
        long paid = payments.stream().mapToLong(PaymentInput::amountRwf).sum();
        if (gross > MAX_TOTAL || paid > total) throw invalid("Sale total or payment amount is outside the supported range.");
        Customer customer = input.customerId() == null ? null : customer(input.customerId());
        if (total > paid && customer == null) throw invalid("Choose a registered customer for an unpaid balance.");
        finance.lockAccounts(payments.stream().map(PaymentInput::accountId).toList());
        String id = id();
        db.sql("""
                INSERT INTO bizflow_foundation.retail_sales(id,reference,request_hash,customer_id,customer_name,sale_date,channel,
                    gross_rwf,discount_rwf,total_rwf,actor_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """).params(id, reference, hash, input.customerId(), customer==null ? clean(input.customerName()) : customer.name(),
                input.date(), input.channel().strip(), gross, discount, total, actor).update();
        for (Priced item : items) {
            String itemId = id();
            var move = inventory.sell(item.product().id(), item.quantity(), itemId, actor);
            db.sql("""
                    INSERT INTO bizflow_foundation.sale_items(id,sale_id,product_id,product_name,sku,quantity,unit_price_rwf,
                        unit_discount_rwf,revenue_rwf,cost_rwf,movement_id,category_snapshot)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    """).params(itemId, id, item.product().id(), item.product().name(), item.product().sku(), item.quantity(),
                    item.price(), item.discount(), item.revenue(), move.costRwf(), move.id(),item.product().category()).update();
        }
        for (PaymentInput payment : payments) postPayment(id, payment, actor);
        audit("sale_completed", id, actor);
        return detail(id);
    }

    private static Priced price(LineInput line, Product product) {
        long price = line.unitPriceRwf() == null ? product.sellingPrice() : line.unitPriceRwf();
        long discount = line.unitDiscountRwf() == null ? 0 : line.unitDiscountRwf();
        if (discount > price) throw invalid("A discount cannot exceed the unit price.");
        return new Priced(product, line.quantity(), price, discount);
    }

    @Transactional
    Payment pay(String id, PaymentInput input, String actor) {
        lockWrites();
        if (input.amountRwf() > sale(id).outstandingRwf()) throw conflict("Payment exceeds the outstanding balance.");
        return postPayment(id, input, actor);
    }

    private Payment postPayment(String saleId, PaymentInput input, String actor) {
        String id = id();
        String reference = input.reference().strip();
        String posting = finance.receive(input.accountId(), input.method(), input.amountRwf(), reference, actor);
        db.sql("INSERT INTO bizflow_foundation.sale_payments(id,sale_id,reference,method,posting_id) VALUES (?,?,?,?,?)")
                .params(id, saleId, reference, input.method(), posting).update();
        audit("payment_recorded", id, actor);
        return payment(saleId, id);
    }

    @Transactional
    Payment reverse(String saleId, String paymentId, ReversalInput input, String actor) {
        lockWrites();
        Sale sale = sale(saleId);
        Payment payment = payment(saleId, paymentId);
        if (payment.reversalId()!=null || payment.amountRwf()>sale.paidRwf()) {
            throw conflict("This payment cannot be reversed after existing reversals or refunds.");
        }
        if (sale.customerId()==null) throw conflict("A payment reversal requires a registered customer to carry the receivable.");
        finance.reverseCustomerPayment(payment.postingId(), input.reference().strip(), input.reason().strip(), actor);
        audit("payment_reversed", paymentId, actor);
        return payment(saleId, paymentId);
    }

    @Transactional
    Return returnItem(String saleId, ReturnInput input, String actor) {
        lockWrites();
        String reference = input.reference().strip();
        String hash = hash(new ReturnInput(reference, input.itemId(), input.quantity(), input.reason().strip(),
                input.condition(), input.refundAccountId()));
        var existing = db.sql("SELECT id,sale_id,request_hash FROM bizflow_foundation.sale_returns WHERE reference=?")
                .param(reference).query(Existing.class).optional();
        if (existing.isPresent()) {
            var prior = existing.get();
            if (!saleId.equals(prior.saleId()) || !hash.equals(prior.requestHash())) {
                throw conflict("The return reference belongs to a different request.");
            }
            return returned(prior.id());
        }
        Sale sale = sale(saleId);
        Item item = db.sql(ITEMS+" WHERE i.sale_id=? AND i.id=?").params(saleId,input.itemId()).query(Item.class)
                .optional().orElseThrow(() -> missing("Sale item not found."));
        if (input.quantity() > item.quantity()-item.returned()) throw conflict("Return exceeds the remaining quantity sold.");
        String id = id();
        long credit = input.quantity() * (item.unitPriceRwf() - item.unitDiscountRwf());
        long refund = SaleMath.refund(credit, sale.outstandingRwf());
        String condition=input.condition();
        if ("USABLE".equals(condition) && db.sql("""
                SELECT archived_at IS NOT NULL FROM bizflow_foundation.catalog_products WHERE id=? FOR UPDATE
                """).param(item.productId()).query(Boolean.class).single()) condition="ARCHIVED_HELD";
        boolean usable = "USABLE".equals(condition);
        long restored = usable ? SaleMath.restoredCost(item.costRwf(), item.returned(), input.quantity(), item.quantity()) : 0;
        UUID movement = usable ? inventory.returnSale(item.productId(), input.quantity(), restored, id, actor) : null;
        String posting = refund == 0 ? null : finance.refund(refundAccount(saleId,input.refundAccountId()),refund,reference,actor);
        db.sql("""
                INSERT INTO bizflow_foundation.sale_returns(id,sale_id,item_id,reference,request_hash,quantity,reason,
                    condition,revenue_credit_rwf,restored_cost_rwf,refund_posting_id,movement_id,actor_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """).params(id, saleId, item.id(), reference, hash, input.quantity(), input.reason().strip(), condition,
                credit, restored, posting, movement, actor).update();
        audit("sale_item_returned", id, actor);
        return returned(id);
    }

    private String refundAccount(String saleId, String selected) {
        if (selected != null && !selected.isBlank()) return selected;
        var accounts = db.sql("""
                SELECT DISTINCT a.id FROM bizflow_foundation.sale_payments sp
                JOIN bizflow_foundation.financial_postings p ON p.id=sp.posting_id
                JOIN bizflow_foundation.financial_accounts a ON a.id=p.to_account
                WHERE sp.sale_id=? AND a.active AND a.currency='RWF'
                  AND NOT EXISTS (SELECT 1 FROM bizflow_foundation.financial_postings rev WHERE rev.reverses_id=p.id)
                """).param(saleId).query(String.class).list();
        if (accounts.size()!=1) throw invalid("Choose a funded RWF refund account.");
        return accounts.getFirst();
    }

    Sale sale(String id) {
        return db.sql("SELECT * FROM bizflow_foundation.sale_balances WHERE id=?")
                .param(id).query(Sale.class).optional().orElseThrow(() -> missing("Sale not found."));
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    SaleDetail detail(String id) {
        return new SaleDetail(sale(id), db.sql(ITEMS+" WHERE i.sale_id=? ORDER BY i.created_at,i.id")
                .param(id).query(Item.class).list(), paymentRows(id), returnRows(id));
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    List<Payment> payments(String id) {
        sale(id);
        return paymentRows(id);
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    List<Return> returns(String id) {
        sale(id);
        return returnRows(id);
    }

    private List<Payment> paymentRows(String id) {
        return db.sql(PAYMENTS+" WHERE sp.sale_id=? ORDER BY p.recorded_at,sp.id").param(id).query(Payment.class).list();
    }

    private List<Return> returnRows(String id) {
        return db.sql(RETURNS+" WHERE r.sale_id=? ORDER BY r.recorded_at,r.id").param(id).query(Return.class).list();
    }

    private Payment payment(String saleId, String id) {
        return db.sql(PAYMENTS+" WHERE sp.sale_id=? AND sp.id=?").params(saleId,id).query(Payment.class)
                .optional().orElseThrow(() -> missing("Payment not found."));
    }

    private Return returned(String id) {
        return db.sql(RETURNS+" WHERE r.id=?").param(id).query(Return.class).single();
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    Reconciliation reconcile(String id) {
        sale(id);
        return db.sql("""
                SELECT item_revenue_rwf,item_cost_rwf,stock_value_removed_rwf,stock_value_restored_rwf,
                       i.broken + r.broken + p.broken AS broken_links,
                       b.outstanding_rwf>=0 AND b.paid_rwf>=0 AND item_revenue_rwf=b.total_rwf AND
                       item_cost_rwf=stock_value_removed_rwf AND b.restored_rwf=stock_value_restored_rwf
                       AND i.broken+r.broken+p.broken=0 AS matches
                FROM bizflow_foundation.sale_balances b
                CROSS JOIN LATERAL (
                    SELECT coalesce(sum(i.revenue_rwf),0)::bigint AS item_revenue_rwf,
                           coalesce(sum(i.cost_rwf),0)::bigint AS item_cost_rwf,
                           coalesce(sum(-m.value_delta_rwf),0)::bigint AS stock_value_removed_rwf,
                           count(*) FILTER (WHERE m.kind<>'SALE' OR m.product_id<>i.product_id
                                                OR m.delta<>-i.quantity OR m.value_delta_rwf<>-i.cost_rwf) AS broken
                    FROM bizflow_foundation.sale_items i JOIN bizflow_foundation.inventory_movements m ON m.id=i.movement_id
                    WHERE i.sale_id=b.id
                ) i
                CROSS JOIN LATERAL (
                    SELECT coalesce(sum(m.value_delta_rwf),0)::bigint AS stock_value_restored_rwf,
                           count(*) FILTER (WHERE (r.condition='USABLE' AND
                               (m.kind<>'SALE_RETURN' OR m.product_id<>i.product_id OR m.delta<>r.quantity OR m.value_delta_rwf<>r.restored_cost_rwf))
                               OR (f.id IS NOT NULL AND f.kind<>'CUSTOMER_REFUND')) AS broken
                    FROM bizflow_foundation.sale_returns r JOIN bizflow_foundation.sale_items i ON i.id=r.item_id
                    LEFT JOIN bizflow_foundation.inventory_movements m ON m.id=r.movement_id
                    LEFT JOIN bizflow_foundation.financial_postings f ON f.id=r.refund_posting_id WHERE r.sale_id=b.id
                ) r
                CROSS JOIN LATERAL (
                    SELECT count(*) FILTER (WHERE p.kind<>'CUSTOMER_PAYMENT' OR sp.method<>a.kind OR a.currency<>'RWF'
                        OR (rev.id IS NOT NULL AND (rev.amount_rwf<>p.amount_rwf OR rev.from_account IS DISTINCT FROM p.to_account
                            OR rev.to_account IS NOT NULL))) AS broken
                    FROM bizflow_foundation.sale_payments sp JOIN bizflow_foundation.financial_postings p ON p.id=sp.posting_id
                    JOIN bizflow_foundation.financial_accounts a ON a.id=p.to_account
                    LEFT JOIN bizflow_foundation.financial_postings rev ON rev.reverses_id=p.id WHERE sp.sale_id=b.id
                ) p WHERE b.id=?
                """).param(id).query(Reconciliation.class).single();
    }

    private void lockWrites() {
        db.sql("SELECT pg_advisory_xact_lock(60812026)").query((rs, row) -> true).single();
    }

    void audit(String event, String entity, String actor) {
        db.sql("INSERT INTO bizflow_foundation.sales_audit(event,entity_id,actor_id) VALUES (?,?,?)")
                .params(event,entity,actor).update();
    }

    <T> Page<T> page(String from, List<?> params, String order, int page, int size, Class<T> type) {
        long total = db.sql("SELECT count(*)"+from).params(params).query(Long.class).single();
        var paginated = new ArrayList<Object>(params);
        paginated.add(size);
        paginated.add((long)page*size);
        var rows = db.sql("SELECT *"+from+" ORDER BY "+order+" LIMIT ? OFFSET ?").params(paginated).query(type).list();
        return new Page<>(rows,page,size,total);
    }

    String hash(Object input) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(input)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required.", e);
        }
    }

    static List<PaymentInput> paymentList(List<PaymentInput> payments) { return payments == null ? List.of() : payments; }
    static String id() { return UUID.randomUUID().toString(); }
    static String clean(String text) { return text == null ? "" : text.strip(); }
    static ResponseStatusException invalid(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
    static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT,message); }
    static ResponseStatusException missing(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND,message); }
}
