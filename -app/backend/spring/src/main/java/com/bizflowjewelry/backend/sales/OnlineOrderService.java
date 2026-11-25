package com.bizflowjewelry.backend.sales;

import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import static com.bizflowjewelry.backend.sales.SalesController.*;
import static com.bizflowjewelry.backend.sales.SalesService.*;

@Service
class OnlineOrderService {
    private final JdbcClient db;
    private final SalesService sales;

    OnlineOrderService(JdbcClient db, SalesService sales) {
        this.db = db;
        this.sales = sales;
    }

    record Order(String id, String reference, String customerId, String customerName, String contact, String source,
                 String status, String fulfillment, String saleId, String paymentStatus, Long outstandingRwf,
                 String actorId, OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
    record Item(String productId, String productName, long quantity, long quoteRwf) {}
    record OrderDetail(Order order, List<Item> items) {}
    private record State(String status, String customerId, String confirmationHash) {}

    private static final String ORDERS = """
             FROM (SELECT o.*, s.status AS payment_status, s.outstanding_rwf FROM bizflow_foundation.online_orders o
             LEFT JOIN bizflow_foundation.sale_balances s ON s.id=o.sale_id) orders
            """;

    @Transactional
    OrderDetail create(OrderInput input, String actor) {
        if (input.items().stream().map(OrderItemInput::productId).distinct().count() != input.items().size()) {
            throw invalid("Enter each order product once.");
        }
        var products = input.items().stream().map(item -> sales.product(item.productId())).toList();
        Customer customer;
        if (input.customerId() == null) {
            if (clean(input.customerName()).isEmpty()) throw invalid("Choose a customer or enter their name.");
            customer = sales.createCustomer(new CustomerInput(input.customerName(), null, null), actor);
        } else {
            customer = sales.customer(input.customerId());
        }
        String id = id();
        db.sql("""
                INSERT INTO bizflow_foundation.online_orders(id,reference,customer_id,customer_name,contact,source,actor_id)
                VALUES (?,?,?,?,?,?,?)
                """).params(id,input.reference().strip(),customer.id(),customer.name(),input.contact().strip(),
                input.source().strip(),actor).update();
        for (int i=0; i<products.size(); i++) {
            var product = products.get(i);
            db.sql("""
                    INSERT INTO bizflow_foundation.online_order_items(order_id,product_id,product_name,quantity,quote_rwf)
                    VALUES (?,?,?,?,?)
                    """).params(id,product.id(),product.name(),input.items().get(i).quantity(),product.sellingPrice()).update();
        }
        sales.audit("online_order_created",id,actor);
        return detail(id);
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    Page<Order> list(String status, int page, int size) {
        return sales.page(ORDERS+" WHERE status=coalesce(?,status)", Collections.singletonList(status),
                "created_at DESC,id",page,size,Order.class);
    }

    @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
    OrderDetail detail(String id) {
        Order order = db.sql("SELECT *"+ORDERS+" WHERE id=?").param(id).query(Order.class)
                .optional().orElseThrow(() -> missing("Online order not found."));
        return new OrderDetail(order, items(id));
    }

    @Transactional
    OrderDetail confirm(String id, ConfirmInput input, String actor) {
        State state = stateForUpdate(id);
        var payments = paymentList(input.payments());
        String hash = sales.hash(new ConfirmInput(input.date(),payments));
        if ("CONFIRMED".equals(state.status())) {
            if (!hash.equals(state.confirmationHash())) throw conflict("This order was confirmed with different checkout details.");
            return detail(id);
        }
        if (!"PENDING".equals(state.status())) throw conflict("Only pending orders can be confirmed.");
        var lines = items(id).stream().map(item -> new LineInput(item.productId(),item.quantity(),item.quoteRwf(),0L)).toList();
        var sale = sales.complete(new SaleInput("online:"+id,input.date(),"Online",state.customerId(),null,lines,payments),actor);
        db.sql("""
                UPDATE bizflow_foundation.online_orders SET status='CONFIRMED',sale_id=?,confirmation_hash=?,
                    updated_at=clock_timestamp() WHERE id=?
                """).params(sale.sale().id(),hash,id).update();
        sales.audit("online_order_confirmed",id,actor);
        return detail(id);
    }

    @Transactional
    OrderDetail cancel(String id, String actor) {
        if (!"PENDING".equals(stateForUpdate(id).status())) throw conflict("Only pending orders can be cancelled.");
        db.sql("UPDATE bizflow_foundation.online_orders SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=?")
                .param(id).update();
        sales.audit("online_order_cancelled",id,actor);
        return detail(id);
    }

    @Transactional
    OrderDetail fulfill(String id, String status, String actor) {
        if (!"CONFIRMED".equals(stateForUpdate(id).status())) throw conflict("Only confirmed orders can be fulfilled.");
        db.sql("UPDATE bizflow_foundation.online_orders SET fulfillment=?,updated_at=clock_timestamp() WHERE id=?")
                .params(status,id).update();
        sales.audit("online_order_fulfillment_changed",id,actor);
        return detail(id);
    }

    private State stateForUpdate(String id) {
        return db.sql("SELECT status,customer_id,confirmation_hash FROM bizflow_foundation.online_orders WHERE id=? FOR UPDATE")
                .param(id).query(State.class).optional().orElseThrow(() -> missing("Online order not found."));
    }

    private List<Item> items(String id) {
        return db.sql("SELECT * FROM bizflow_foundation.online_order_items WHERE order_id=? ORDER BY product_id")
                .param(id).query(Item.class).list();
    }
}
