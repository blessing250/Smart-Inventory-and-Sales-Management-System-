package com.bizflowjewelry.backend.procurement;

import com.bizflowjewelry.backend.inventory.InventoryLedger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;
import static com.bizflowjewelry.backend.procurement.ProcurementController.*;
import static com.bizflowjewelry.backend.procurement.ReceivingCost.*;

@Service
class ProcurementService {
    private static final long MAX_ORDER = 1_000_000_000_000L;
    private final JdbcClient db;
    private final InventoryLedger inventory;
    private final ObjectMapper json;

    ProcurementService(JdbcClient db, InventoryLedger inventory, ObjectMapper json) {
        this.db = db;
        this.inventory = inventory;
        this.json = json;
    }

    record Contact(String id, String kind, String name, String phone, String email, String location,
                   String actorId, OffsetDateTime createdAt) {}
    record Order(String id, String supplierId, String supplierName, String reference, String invoiceReference,
                 LocalDate purchaseDate, String currency, long rateMicros, long totalRwf, boolean cancelled,
                 String status, String actorId, OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
    record OrderLine(String id, String orderId, String productId, String currency, long ordered, long unitMinor,
                     long subtotalRwf, long usable, long damaged, long missing, long reserved, long outstanding, String status) {}
    record OrderView(Order order, List<OrderLine> lines) {}
    record Shipment(String id, String tracking, String agentId, String agentName, LocalDate plannedDate, LocalDate arrivalDate,
                    String status, String allocation, String actorId, OffsetDateTime createdAt, OffsetDateTime updatedAt) {}
    record Plan(String shipmentId, String lineId, long planned, long usable, long damaged, long missing, long outstanding) {}
    record Charge(String kind, long amountRwf) {}
    record ShipmentView(Shipment shipment, List<Plan> lines, List<Charge> charges) {}
    record Receipt(String id, String shipmentId, String reference, LocalDate receiptDate, String actorId, OffsetDateTime recordedAt,boolean corrected) {}
    record ReceiptLine(String receiptId, String shipmentId, String lineId, long usable, long damaged, long missing,
                       String explanation, long usableCostRwf, long damageCostRwf, long allocatedRwf, long capitalizedRwf, UUID movementId) {}
    record ReceiptView(Receipt receipt, List<ReceiptLine> lines) {}
    record Correction(String receiptId,String reference,String reason,String actorId,OffsetDateTime recordedAt) {}
    record Reconciliation(long chargeRwf, long allocatedRwf, long capitalizedChargeRwf, long unallocatedChargeRwf,
                          long heldChargeRwf, long usableSupplierRwf, long damagedSupplierRwf, long landedRwf,
                          long ledgerRwf, long usable, long damaged, long missing, long outstanding, long brokenLinks,
                          boolean matches) {}
    record ReceivingTotals(long allocated, long capitalized, long supplier, long damage, long ledger, long usable,
                           long damaged, long missing, long brokenLinks) {}
    record Page<T>(List<T> items, int page, int size, long total) {}
    private record Prior(String id, String shipmentId, String requestHash) {}
    private record ReceiptRequest(LocalDate date, List<ReceiptItem> lines) {}

    private static final String ORDER_FIELDS = """
            o.*, CASE WHEN cancelled THEN 'CANCELLED'
              WHEN NOT EXISTS (SELECT 1 FROM bizflow_foundation.procurement_line_progress l WHERE l.order_id=o.id AND l.usable+l.damaged<l.ordered) THEN 'RECEIVED'
              WHEN EXISTS (SELECT 1 FROM bizflow_foundation.procurement_line_progress l WHERE l.order_id=o.id AND l.usable+l.damaged>0) THEN 'PARTIAL'
              ELSE 'OPEN' END AS status
            """;

    @Transactional
    Contact createContact(ContactInput input, String actor) {
        String id = id();
        db.sql("""
                INSERT INTO bizflow_foundation.procurement_contacts (id,kind,name,phone,email,location,actor_id)
                VALUES (?,?,?,?,?,?,?)
                """).params(id,input.kind(),input.name().strip(),clean(input.phone()),clean(input.email()),clean(input.location()),actor).update();
        audit(actor,"contact_created",id);
        return contact(id,input.kind());
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Page<Contact> contacts(String kind, String q, int page, int size) {
        return new Query(" FROM bizflow_foundation.procurement_contacts WHERE true")
                .equal("kind",kind).search("name",q).page("*","lower(name),id",page,size,Contact.class);
    }

    @Transactional
    OrderView createOrder(PurchaseInput input, String actor) {
        lockFlow();
        if ("RWF".equals(input.currency()) && input.rateMicros()!=1_000_000) throw bad("RWF requires the standard exchange rate.");
        Contact supplier = contact(input.supplierId(),"SUPPLIER");
        var items = input.lines();
        for (String product : items.stream().map(PurchaseItem::productId).distinct().sorted().toList()) {
            if (db.sql("SELECT id FROM bizflow_foundation.catalog_products WHERE id=? AND archived_at IS NULL FOR UPDATE")
                    .param(product).query(String.class).optional().isEmpty()) throw bad("Order contains an unavailable product.");
        }
        List<Long> costs = new ArrayList<>();
        long total=0;
        for (var item : items) {
            long amount;
            try { amount=convert(item.quantity(),item.unitMinor(),input.currency(),input.rateMicros()); }
            catch (ArithmeticException error) { throw bad("Purchase total exceeds the supported range."); }
            if (amount>MAX_ORDER-total) throw bad("Purchase total exceeds the supported range.");
            total+=amount;
            costs.add(amount);
        }
        String id = id();
        db.sql("""
                INSERT INTO bizflow_foundation.procurement_orders
                    (id,supplier_id,supplier_name,reference,invoice_reference,purchase_date,currency,rate_micros,total_rwf,actor_id)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """).params(id,supplier.id(),supplier.name(),input.reference().strip(),clean(input.invoiceReference()),
                input.date(),input.currency(),input.rateMicros(),total,actor).update();
        for (int i=0;i<items.size();i++) {
            var item = items.get(i);
            db.sql("INSERT INTO bizflow_foundation.procurement_lines VALUES (?,?,?,?,?,?)")
                    .params(id(),id,item.productId(),item.quantity(),item.unitMinor(),costs.get(i)).update();
        }
        audit(actor,"purchase_created",id);
        return orderView(id);
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    Page<Order> orders(String status,String supplier,String q,int page,int size) {
        return new Query(" FROM (SELECT "+ORDER_FIELDS+" FROM bizflow_foundation.procurement_orders o) orders WHERE true")
                .equal("status",status).equal("supplier_id",supplier).search("reference || ' ' || invoice_reference || ' ' || supplier_name",q)
                .page("*","purchase_date DESC,id",page,size,Order.class);
    }

    @Transactional(readOnly = true,isolation = Isolation.REPEATABLE_READ)
    OrderView orderView(String id) {
        Order order = order(id);
        var lines = db.sql("""
                SELECT l.id,l.order_id,l.product_id,o.currency,l.ordered,l.unit_minor,l.subtotal_rwf,l.usable,l.damaged,l.missing,l.reserved,
                       l.ordered-l.usable-l.damaged AS outstanding,
                       CASE WHEN o.cancelled THEN 'CANCELLED' WHEN l.usable+l.damaged=l.ordered THEN 'RECEIVED'
                         WHEN l.usable+l.damaged>0 THEN 'PARTIAL' ELSE 'OPEN' END AS status
                FROM bizflow_foundation.procurement_line_progress l JOIN bizflow_foundation.procurement_orders o ON o.id=l.order_id
                WHERE l.order_id=? ORDER BY l.id
                """).param(id).query(OrderLine.class).list();
        return new OrderView(order,lines);
    }

    @Transactional
    OrderView cancelOrder(String id,String actor) {
        lockFlow();
        var order=orderView(id);
        if (order.order().cancelled()) return order;
        if (db.sql("SELECT released_rwf>0 FROM bizflow_foundation.supplier_obligations WHERE purchase_id=?")
                .param(id).query(Boolean.class).single()) throw conflict("Reverse supplier payments before cancelling the purchase.");
        if (order.lines().stream().anyMatch(l->l.usable()+l.damaged()+l.missing()+l.reserved()>0)) {
            throw conflict("Release manifest reservations first. Orders with receipt history need a coordinated correction.");
        }
        db.sql("UPDATE bizflow_foundation.procurement_orders SET cancelled=true, updated_at=clock_timestamp() WHERE id=?").param(id).update();
        audit(actor,"purchase_cancelled",id);
        return orderView(id);
    }

    @Transactional
    ShipmentView createShipment(ShipmentInput input,String actor) {
        lockFlow();
        Contact agent=contact(input.agentId(),"AGENT");
        if (input.arrivalDate()!=null && input.arrivalDate().isBefore(input.plannedDate())) throw bad("Arrival date precedes planning.");
        String id=id();
        db.sql("""
                INSERT INTO bizflow_foundation.procurement_shipments
                    (id,tracking,agent_id,agent_name,planned_date,arrival_date,actor_id) VALUES (?,?,?,?,?,?,?)
                """).params(id,input.tracking().strip(),agent.id(),agent.name(),input.plannedDate(),input.arrivalDate(),actor).update();
        reserve(id,input.lines());
        audit(actor,"shipment_planned",id);
        return shipmentView(id);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Page<Shipment> shipments(String status,String q,int page,int size) {
        return new Query(" FROM bizflow_foundation.procurement_shipments WHERE true")
                .equal("status",status).search("tracking || ' ' || agent_name",q)
                .page("*","planned_date DESC,id",page,size,Shipment.class);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    ShipmentView shipmentView(String id) {
        var shipment=shipment(id);
        var lines=db.sql("SELECT * FROM bizflow_foundation.procurement_manifest_progress WHERE shipment_id=? ORDER BY line_id")
                .param(id).query(Plan.class).list();
        var charges=db.sql("SELECT kind,amount_rwf FROM bizflow_foundation.procurement_charges WHERE shipment_id=? ORDER BY kind")
                .param(id).query(Charge.class).list();
        return new ShipmentView(shipment,lines,charges);
    }

    @Transactional
    ShipmentView amend(String id,List<PlanItem> lines,String actor) {
        lockFlow();
        requirePreReceipt(id);
        db.sql("DELETE FROM bizflow_foundation.procurement_manifest_lines WHERE shipment_id=?").param(id).update();
        reserve(id,lines);
        touch(id);
        audit(actor,"shipment_amended",id);
        return shipmentView(id);
    }

    @Transactional
    ShipmentView charges(String id,ChargesInput input,String actor) {
        lockFlow();
        requireActive(shipment(id));
        if (db.sql("SELECT EXISTS(SELECT 1 FROM bizflow_foundation.active_procurement_receipt_lines WHERE shipment_id=?)")
                .param(id).query(Boolean.class).single()) throw conflict("Active receipts have locked the charges.");
        if (db.sql("SELECT EXISTS(SELECT 1 FROM bizflow_foundation.shipment_payment_allocations WHERE shipment_id=?)")
                .param(id).query(Boolean.class).single()) throw conflict("Charges with historical payments require a coordinated correction.");
        db.sql("UPDATE bizflow_foundation.procurement_shipments SET allocation=?,updated_at=clock_timestamp() WHERE id=?")
                .params(input.allocation(),id).update();
        db.sql("DELETE FROM bizflow_foundation.procurement_charges WHERE shipment_id=?").param(id).update();
        for (var charge : Map.of("SHIPPING",input.shipping(),"CUSTOMS",input.customs(),"CLEARING",input.clearing(),"OTHER",input.other()).entrySet()) {
            db.sql("INSERT INTO bizflow_foundation.procurement_charges VALUES (?,?,?)").params(id,charge.getKey(),charge.getValue()).update();
        }
        audit(actor,"shipment_charges_recorded",id);
        return shipmentView(id);
    }

    @Transactional
    ShipmentView cancelShipment(String id,String actor) {
        lockFlow();
        var shipment=shipment(id);
        if ("CANCELLED".equals(shipment.status())) return shipmentView(id);
        if ("RECEIVED".equals(shipment.status())) throw conflict("A received shipment needs a coordinated correction.");
        setStatus(id,"CANCELLED");
        audit(actor,"shipment_cancelled",id);
        return shipmentView(id);
    }

    @Transactional
    ReceiptView receive(String id,ReceiptInput input,String actor) {
        lockFlow();
        var lines = input.lines().stream().sorted(Comparator.comparing(ReceiptItem::lineId))
                .map(i->new ReceiptItem(i.lineId(),i.usable(),i.damaged(),i.missing(),clean(i.explanation()))).toList();
        unique(lines.stream().map(ReceiptItem::lineId).toList());
        String reference=input.reference().strip();
        String hash=hash(new ReceiptRequest(input.date(),lines));
        var prior=db.sql("SELECT id,shipment_id,request_hash FROM bizflow_foundation.procurement_receipts WHERE reference=?")
                .param(reference).query(Prior.class).optional();
        if (prior.isPresent()) {
            var existing=prior.get();
            if (!id.equals(existing.shipmentId()) || !hash.equals(existing.requestHash())) throw conflict("Receipt reference belongs to a different request.");
            return receiptView(id,existing.id());
        }
        var view=shipmentView(id);
        requireActive(view.shipment());
        if (input.date().isBefore(view.shipment().plannedDate())) throw bad("Receipt date precedes shipment planning.");
        String method=view.shipment().allocation();
        if (method==null) throw conflict("Record shipment charges and allocation before receiving.");
        long total=view.charges().stream().mapToLong(Charge::amountRwf).sum();
        var weights=new ArrayList<Long>();
        var planById=new LinkedHashMap<String,Plan>();
        var purchaseLines=new HashMap<String,OrderLine>();
        for (Plan plan : view.lines()) {
            OrderLine line=line(plan.lineId());
            purchaseLines.put(line.id(),line);
            planById.put(line.id(),plan);
            weights.add(method.equals("QUANTITY") ? plan.planned() : share(line.subtotalRwf(),plan.planned(),line.ordered()));
        }
        inventory.lockProducts(lines.stream().filter(received -> received.usable()>0)
                .map(received -> purchaseLines.get(received.lineId()))
                .filter(Objects::nonNull).map(OrderLine::productId).toList());
        if (weights.stream().noneMatch(w->w>0)) {
            if (total>0) throw bad("Use quantity allocation when planned supplier costs are zero.");
            weights=new ArrayList<>(view.lines().stream().map(Plan::planned).toList());
        }
        List<Long> budgets=allocate(total,weights);
        var budgetById=new HashMap<String,Long>();
        for(int i=0;i<view.lines().size();i++) budgetById.put(view.lines().get(i).lineId(),budgets.get(i));
        String receipt=id();
        db.sql("""
                INSERT INTO bizflow_foundation.procurement_receipts (id,shipment_id,reference,receipt_date,request_hash,actor_id)
                VALUES (?,?,?,?,?,?)
                """).params(receipt,id,reference,input.date(),hash,actor).update();
        for(var received:lines) {
            var plan=planById.get(received.lineId());
            long resolved=received.usable()+received.damaged()+received.missing();
            if (resolved==0 || (received.damaged()+received.missing()>0 && received.explanation().isEmpty())) throw bad("Enter quantities and explain damage or confirmed shortage.");
            if (plan==null || resolved>plan.outstanding()) throw conflict("Receipt exceeds the outstanding manifest quantity.");
            var line=purchaseLines.get(received.lineId());
            if (received.usable()+received.damaged()+line.reserved()-plan.outstanding()>line.outstanding()) throw conflict("Receipt exceeds available purchase quantity.");
            long previous=line.usable()+line.damaged();
            long usable=portion(line.subtotalRwf(),previous,received.usable(),line.ordered());
            long damage=portion(line.subtotalRwf(),previous+received.usable(),received.damaged(),line.ordered());
            long processed=plan.planned()-plan.outstanding();
            long budget=budgetById.get(line.id());
            long allocated=portion(budget,processed,resolved,plan.planned());
            long capitalized=portion(budget,processed,received.usable(),plan.planned());
            UUID movement=received.usable()==0 ? null : inventory.receivePurchase(line.productId(),received.usable(),
                    usable+capitalized,receipt+":"+line.id(),view.shipment().tracking(),actor);
            db.sql("INSERT INTO bizflow_foundation.procurement_receipt_lines VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
                    .params(receipt,id,line.id(),received.usable(),received.damaged(),received.missing(),received.explanation(),
                            usable,damage,allocated,capitalized,movement).update();
            db.sql("UPDATE bizflow_foundation.procurement_orders SET updated_at=clock_timestamp() WHERE id=?").param(line.orderId()).update();
        }
        boolean outstanding=shipmentView(id).lines().stream().anyMatch(p->p.outstanding()>0);
        setStatus(id,outstanding?"IN_TRANSIT":"RECEIVED");
        audit(actor,"shipment_receipt_recorded",receipt);
        return receiptView(id,receipt);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Page<Receipt> receipts(String id,int page,int size) {
        shipment(id);
        return new Query(" FROM bizflow_foundation.procurement_receipt_history WHERE true").equal("shipment_id",id)
                .page("*","receipt_date DESC,recorded_at DESC,id",page,size,Receipt.class);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    ReceiptView receiptView(String shipment,String receipt) {
        var result=db.sql("SELECT * FROM bizflow_foundation.procurement_receipt_history WHERE shipment_id=? AND id=?")
                .params(shipment,receipt).query(Receipt.class).optional().orElseThrow(()->missing("Receipt not found."));
        var lines=db.sql("SELECT * FROM bizflow_foundation.procurement_receipt_lines WHERE receipt_id=? ORDER BY line_id")
                .param(receipt).query(ReceiptLine.class).list();
        return new ReceiptView(result,lines);
    }

    @Transactional
    Correction correct(String shipment,String receipt,CorrectionInput input,String actor) {
        lockFlow();
        var original=receiptView(shipment,receipt);
        String reference=input.reference().strip();
        String reason=input.reason().strip();
        var previous=db.sql("SELECT * FROM bizflow_foundation.procurement_receipt_corrections WHERE receipt_id=? OR reference=?")
                .params(receipt,reference).query(Correction.class).list();
        if(!previous.isEmpty()) {
            var existing=previous.getFirst();
            if(previous.size()==1 && existing.receiptId().equals(receipt) && existing.reference().equals(reference) && existing.reason().equals(reason)) return existing;
            throw conflict("The receipt or reference already has a different correction.");
        }
        if ("CANCELLED".equals(shipment(shipment).status())) throw conflict("Reconcile the cancelled shipment before making a correction.");
        boolean blocked=db.sql("""
                SELECT EXISTS(SELECT 1 FROM bizflow_foundation.active_procurement_receipt_lines l
                  JOIN bizflow_foundation.procurement_receipts r ON r.id=l.receipt_id
                  WHERE (r.recorded_at,r.id)>(?,?) AND (r.shipment_id=? OR l.line_id IN
                    (SELECT line_id FROM bizflow_foundation.procurement_receipt_lines WHERE receipt_id=?)))
                  OR EXISTS(SELECT 1 FROM bizflow_foundation.discrepancy_claims WHERE receipt_id=?)
                  OR EXISTS(SELECT 1 FROM bizflow_foundation.discrepancy_resolutions WHERE receipt_id=?)
                  OR EXISTS(SELECT 1 FROM bizflow_foundation.shipment_payment_allocations WHERE shipment_id=?)
                  OR EXISTS(SELECT 1 FROM bizflow_foundation.supplier_payment_allocations a
                    JOIN bizflow_foundation.procurement_lines l ON l.order_id=a.purchase_id
                    JOIN bizflow_foundation.procurement_receipt_lines r ON r.line_id=l.id WHERE r.receipt_id=?)
                """).params(original.receipt().recordedAt(),receipt,shipment,receipt,receipt,receipt,shipment,receipt)
                .query(Boolean.class).single();
        if(blocked) throw conflict("Later receipts, claims or settlements depend on this event. Reconcile those records before correcting it.");
        var products=new HashSet<String>();
        for(var row:original.lines()) {
            var orderLine=line(row.lineId());
            if(row.movementId()!=null && !products.add(orderLine.productId())) {
                throw conflict("This receipt posted more than one movement for a SKU and requires a coordinated stock review.");
            }
            if(row.missing()>0 && row.missing()>orderLine.outstanding()-orderLine.reserved()) {
                throw conflict("Replacement quantities are already reserved. Release the conflicting manifest before correcting.");
            }
        }
        inventory.lockProducts(products);
        db.sql("INSERT INTO bizflow_foundation.procurement_receipt_corrections(receipt_id,reference,reason,actor_id) VALUES (?,?,?,?)")
                .params(receipt,reference,reason,actor).update();
        for(var row:original.lines()) if(row.movementId()!=null) {
            UUID moved=inventory.correctPurchaseReceipt(row.movementId(),reason,actor);
            db.sql("INSERT INTO bizflow_foundation.procurement_receipt_correction_moves VALUES (?,?,?)")
                    .params(receipt,row.lineId(),moved).update();
        }
        setStatus(shipment,shipmentView(shipment).lines().stream().anyMatch(p->p.usable()+p.damaged()+p.missing()>0)?"IN_TRANSIT":"PLANNED");
        audit(actor,"shipment_receipt_corrected",receipt);
        return db.sql("SELECT * FROM bizflow_foundation.procurement_receipt_corrections WHERE receipt_id=?")
                .param(receipt).query(Correction.class).single();
    }

    @Transactional(readOnly=true)
    Correction correction(String shipment,String receipt) {
        return db.sql("""
                SELECT c.* FROM bizflow_foundation.procurement_receipt_corrections c
                JOIN bizflow_foundation.procurement_receipts r ON r.id=c.receipt_id WHERE r.shipment_id=? AND r.id=?
                """).params(shipment,receipt).query(Correction.class).optional()
                .orElseThrow(()->missing("Receipt correction not found."));
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Reconciliation reconciliation(String id) {
        var view=shipmentView(id);
        long total=view.charges().stream().mapToLong(Charge::amountRwf).sum();
        var sums=db.sql("""
                SELECT coalesce(sum(r.allocated_rwf),0) AS allocated, coalesce(sum(r.capitalized_rwf),0) AS capitalized,
                    coalesce(sum(r.usable_cost_rwf),0) AS supplier, coalesce(sum(r.damage_cost_rwf),0) AS damage,
                    coalesce(sum(m.value_delta_rwf),0) AS ledger, coalesce(sum(r.usable),0) AS usable,
                    coalesce(sum(r.damaged),0) AS damaged, coalesce(sum(r.missing),0) AS missing,
                    count(*) FILTER (WHERE r.usable>0 AND (m.id IS NULL OR m.kind<>'PURCHASE_RECEIPT'
                        OR m.product_id<>l.product_id OR m.delta<>r.usable OR m.value_delta_rwf<>r.usable_cost_rwf+r.capitalized_rwf)) AS broken_links
                FROM bizflow_foundation.active_procurement_receipt_lines r JOIN bizflow_foundation.procurement_lines l ON l.id=r.line_id
                LEFT JOIN bizflow_foundation.inventory_movements m ON m.id=r.movement_id WHERE r.shipment_id=?
                """).param(id).query(ReceivingTotals.class).single();
        long remaining=view.lines().stream().mapToLong(Plan::outstanding).sum();
        boolean matches=sums.brokenLinks()==0 && sums.ledger()==sums.supplier()+sums.capitalized() && sums.allocated()<=total
                && (!"RECEIVED".equals(view.shipment().status()) || remaining==0 && total==sums.allocated());
        return new Reconciliation(total,sums.allocated(),sums.capitalized(),total-sums.allocated(),sums.allocated()-sums.capitalized(),
                sums.supplier(),sums.damage(),sums.supplier()+sums.capitalized(),sums.ledger(),sums.usable(),sums.damaged(),sums.missing(),
                remaining,sums.brokenLinks(),matches);
    }

    private void reserve(String id,List<PlanItem> items) {
        unique(items.stream().map(PlanItem::lineId).toList());
        for (var item : items) {
            var line=line(item.lineId());
            if ("CANCELLED".equals(line.status()) || item.quantity()>line.outstanding()-line.reserved()) {
                throw conflict("Manifest exceeds unreserved eligible purchase quantity.");
            }
            db.sql("INSERT INTO bizflow_foundation.procurement_manifest_lines VALUES (?,?,?)").params(id,item.lineId(),item.quantity()).update();
        }
    }

    private void requirePreReceipt(String id) {
        requireActive(shipment(id));
        if (db.sql("SELECT EXISTS(SELECT 1 FROM bizflow_foundation.procurement_receipts WHERE shipment_id=?)")
                .param(id).query(Boolean.class).single()) throw conflict("The first receipt locked the manifest and charges.");
    }

    private static void requireActive(Shipment shipment) {
        if (!List.of("PLANNED","IN_TRANSIT").contains(shipment.status())) throw conflict("Shipment is closed.");
    }

    private OrderLine line(String id) {
        return db.sql("""
                SELECT l.id,l.order_id,l.product_id,o.currency,l.ordered,l.unit_minor,l.subtotal_rwf,l.usable,l.damaged,l.missing,l.reserved,
                       l.ordered-l.usable-l.damaged AS outstanding, CASE WHEN o.cancelled THEN 'CANCELLED' ELSE 'OPEN' END AS status
                FROM bizflow_foundation.procurement_line_progress l JOIN bizflow_foundation.procurement_orders o ON o.id=l.order_id
                WHERE l.id=?
                """).param(id).query(OrderLine.class).optional().orElseThrow(()->missing("Purchase line not found."));
    }

    private Order order(String id) {
        return db.sql("SELECT "+ORDER_FIELDS+" FROM bizflow_foundation.procurement_orders o WHERE id=?")
                .param(id).query(Order.class).optional().orElseThrow(()->missing("Purchase not found."));
    }

    private Shipment shipment(String id) {
        return db.sql("SELECT * FROM bizflow_foundation.procurement_shipments WHERE id=?")
                .param(id).query(Shipment.class).optional().orElseThrow(()->missing("Shipment not found."));
    }

    private Contact contact(String id,String kind) {
        return db.sql("SELECT * FROM bizflow_foundation.procurement_contacts WHERE id=? AND kind=?")
                .params(id,kind).query(Contact.class).optional().orElseThrow(()->bad("Select a valid supplier or shipping agent."));
    }

    private void lockFlow() {
        // Reservation and cumulative-cost decisions share one transaction-scoped lock.
        db.sql("SELECT pg_advisory_xact_lock(12790421,5)").query((row,n)->1).single();
    }

    private void touch(String id) {
        db.sql("UPDATE bizflow_foundation.procurement_shipments SET updated_at=clock_timestamp() WHERE id=?").param(id).update();
    }

    private void setStatus(String id,String status) {
        db.sql("UPDATE bizflow_foundation.procurement_shipments SET status=?,updated_at=clock_timestamp() WHERE id=?").params(status,id).update();
    }

    private void audit(String actor,String event,String id) {
        db.sql("INSERT INTO bizflow_foundation.procurement_audit (actor_id,event,entity_id) VALUES (?,?,?)").params(actor,event,id).update();
    }

    private String hash(ReceiptRequest request) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(json.writeValueAsString(request).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException("SHA-256 unavailable.",error); }
    }

    private static void unique(List<String> ids) {
        if(new HashSet<>(ids).size()!=ids.size()) throw bad("Each purchase line may appear only once.");
    }

    private final class Query {
        private String from;
        private final List<Object> params=new ArrayList<>();
        private Query(String from) { this.from=from; }
        private Query equal(String field,String value) { if(value!=null){from+=" AND "+field+"=?";params.add(value);} return this; }
        private Query search(String field,String query) {
            if(query!=null && !query.isBlank()){from+=" AND strpos(lower("+field+"), lower(?))>0";params.add(query.strip());}
            return this;
        }
        private <T> Page<T> page(String fields,String order,int page,int size,Class<T> type) {
            long total=db.sql("SELECT count(*)"+from).params(params).query(Long.class).single();
            params.add(size);
            params.add((long)page*size);
            return new Page<>(db.sql("SELECT "+fields+from+" ORDER BY "+order+" LIMIT ? OFFSET ?").params(params).query(type).list(),page,size,total);
        }
    }

    private static String id() { return UUID.randomUUID().toString(); }
    private static String clean(String value) { return value==null?"":value.strip(); }
    private static ResponseStatusException missing(String message) { return new ResponseStatusException(HttpStatus.NOT_FOUND,message); }
    private static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
    private static ResponseStatusException conflict(String message) { return new ResponseStatusException(HttpStatus.CONFLICT,message); }
}
