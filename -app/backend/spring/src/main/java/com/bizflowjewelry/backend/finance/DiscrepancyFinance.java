package com.bizflowjewelry.backend.finance;

import java.time.OffsetDateTime;
import java.time.LocalDate;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import static com.bizflowjewelry.backend.finance.FinanceController.*;
import static com.bizflowjewelry.backend.finance.FinanceRules.*;

@Service
class DiscrepancyFinance {
    private final JdbcClient db;
    private final FinanceOperations operations;
    private final FinancialPostingService finance;

    DiscrepancyFinance(JdbcClient db,FinanceOperations operations,FinancialPostingService finance) {
        this.db=db;
        this.operations=operations;
        this.finance=finance;
    }

    record Claim(String id,String receiptId,String lineId,String kind,String reference,String claimant,String notes,long claimedRwf,
                 Long acceptedRwf,long compensatedRwf,String status,String actorId,OffsetDateTime recordedAt,
                 String decidedBy,OffsetDateTime decidedAt,String decisionNotes) {}
    record Resolution(String id,String receiptId,String lineId,String kind,String action,String reference,String claimId,
                      String postingId,long amountRwf,Long payableMinor,LocalDate businessDate,String notes,String actorId,OffsetDateTime recordedAt) {}
    record Discrepancy(String receiptId,String lineId,String purchaseId,String kind,long damagedHeld,long missing,
                       long exposureRwf,long remainingRwf,String status,Claim claim,List<Resolution> resolutions) {}
    private record ReceiptLine(String receiptId,String lineId,String purchaseId,String supplierId,long damaged,long missing,
                               long damageCostRwf,long allocatedRwf,long capitalizedRwf) {}

    private static final String LINES="""
            SELECT r.receipt_id,r.line_id,l.order_id AS purchase_id,o.supplier_id,r.damaged,r.missing,
                   r.damage_cost_rwf,r.allocated_rwf,r.capitalized_rwf
            FROM bizflow_foundation.active_procurement_receipt_lines r JOIN bizflow_foundation.procurement_lines l ON l.id=r.line_id
            JOIN bizflow_foundation.procurement_orders o ON o.id=l.order_id WHERE r.shipment_id=?
            """;
    private static final String CLAIMS="""
            SELECT c.*,v.paid AS compensated_rwf,
                   CASE WHEN c.accepted_rwf IS NULL THEN 'SUBMITTED'
                        WHEN c.accepted_rwf=0 THEN 'REJECTED'
                        WHEN v.paid=c.accepted_rwf THEN 'FULLY_COMPENSATED'
                        WHEN v.paid>0 THEN 'PARTIALLY_COMPENSATED' ELSE 'ACCEPTED' END AS status
            FROM bizflow_foundation.discrepancy_claims c CROSS JOIN LATERAL
                (SELECT coalesce(sum(amount_rwf),0)::bigint AS paid FROM bizflow_foundation.discrepancy_resolutions
                 WHERE claim_id=c.id AND action IN ('CASH','CREDIT')) v
            """;

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    List<Discrepancy> list(String shipment) {
        operations.exists("procurement_shipments","id=?",shipment,"Shipment not found.");
        var values=new java.util.ArrayList<Discrepancy>();
        for(var line:db.sql(LINES+" AND (r.damaged>0 OR r.missing>0) ORDER BY r.receipt_id,r.line_id")
                .param(shipment).query(ReceiptLine.class).list()) {
            if(line.damaged()>0) values.add(describe(line,"DAMAGE"));
            if(line.missing()>0) values.add(describe(line,"SHORTAGE"));
        }
        return values;
    }

    @Transactional
    Claim submit(String shipment,ClaimInput input,String actor) {
        operations.lock();
        var line=line(shipment,input.receiptId(),input.lineId(),input.kind());
        var view=describe(line,input.kind());
        if(view.claim()!=null || input.amountRwf()>view.remainingRwf()) throw conflict("Choose an unclaimed discrepancy and an amount within remaining exposure.");
        String id=id();
        db.sql("""
                INSERT INTO bizflow_foundation.discrepancy_claims(id,receipt_id,line_id,kind,reference,claimant,notes,claimed_rwf,actor_id)
                VALUES (?,?,?,?,?,?,?,?,?)
                """).params(id,line.receiptId(),line.lineId(),input.kind(),input.reference().strip(),input.claimant().strip(),
                clean(input.notes()),input.amountRwf(),actor).update();
        finance.audit("shipment_claim_submitted",id,actor);
        return claim(shipment,id);
    }

    @Transactional
    Claim decide(String shipment,String id,DecisionInput input,String actor) {
        operations.lock();
        Claim claim=claim(shipment,id);
        if(claim.acceptedRwf()!=null || input.acceptedRwf()>claim.claimedRwf()) throw conflict("Choose an undecided claim and an amount within the requested value.");
        db.sql("""
                UPDATE bizflow_foundation.discrepancy_claims SET accepted_rwf=?,decided_by=?,decided_at=clock_timestamp(),decision_notes=?
                WHERE id=?
                """).params(input.acceptedRwf(),actor,input.notes().strip(),id).update();
        finance.audit("shipment_claim_decided",id,actor);
        return claim(shipment,id);
    }

    @Transactional
    Resolution resolve(String shipment,ResolutionInput input,String actor) {
        operations.lock();
        var line=line(shipment,input.receiptId(),input.lineId(),input.kind());
        var view=describe(line,input.kind());
        var claim=view.claim();
        long amount=input.amountRwf();
        LocalDate date=businessDate(input.date());
        if(amount>view.remainingRwf()) throw conflict("Resolution exceeds the remaining discrepancy exposure.");
        String posting=null;
        Long minor=null;
        if("LOSS".equals(input.action())) {
            if(claim!=null && (claim.acceptedRwf()==null || claim.acceptedRwf()>claim.compensatedRwf())) {
                throw conflict("Decide and settle the claim before approving a loss.");
            }
            if(input.payableMinor()!=null || input.accountId()!=null) throw invalid("A loss does not settle an account or payable.");
        } else {
            if(claim==null || claim.acceptedRwf()==null || amount>claim.acceptedRwf()-claim.compensatedRwf()) {
                throw conflict("Compensation exceeds the accepted unpaid claim amount.");
            }
            if("CREDIT".equals(input.action())) {
                if(input.accountId()!=null) throw invalid("A supplier credit does not move cash.");
                var due=operations.obligation(line.purchaseId(),line.supplierId());
                minor="RWF".equals(due.currency())?Long.valueOf(amount):input.payableMinor();
                if(minor==null || (input.payableMinor()!=null && !minor.equals(input.payableMinor()))
                        || release(due.outstandingRwf(),due.outstandingMinor(),minor)!=amount) {
                    throw conflict("Credit must match the historical value of the payable discharged.");
                }
            } else {
                if(input.accountId()==null || input.accountId().isBlank() || input.payableMinor()!=null) throw invalid("Choose a compensation account.");
                posting=finance.post("CLAIM_CASH","claim:"+input.reference().strip(),null,input.accountId(),amount,actor,date,null);
            }
        }
        String id=id();
        db.sql("""
                INSERT INTO bizflow_foundation.discrepancy_resolutions(id,receipt_id,line_id,kind,action,reference,claim_id,posting_id,
                    amount_rwf,payable_minor,business_date,notes,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                """).params(id,line.receiptId(),line.lineId(),input.kind(),input.action(),input.reference().strip(),claim==null?null:claim.id(),
                posting,amount,minor,date,input.notes().strip(),actor).update();
        finance.audit("shipment_resolution_"+input.action().toLowerCase(java.util.Locale.ROOT),id,actor);
        return db.sql("SELECT * FROM bizflow_foundation.discrepancy_resolutions WHERE id=?").param(id).query(Resolution.class).single();
    }

    private Claim claim(String shipment,String id) {
        return db.sql(CLAIMS+" JOIN bizflow_foundation.procurement_receipts r ON r.id=c.receipt_id WHERE c.id=? AND r.shipment_id=?")
                .params(id,shipment).query(Claim.class).optional().orElseThrow(()->missing("Shipment claim not found."));
    }

    private ReceiptLine line(String shipment,String receipt,String item,String kind) {
        var line=db.sql(LINES+" AND r.receipt_id=? AND r.line_id=?").params(shipment,receipt,item).query(ReceiptLine.class)
                .optional().orElseThrow(()->missing("Shipment receipt line not found."));
        if(("DAMAGE".equals(kind)?line.damaged():line.missing())==0) throw invalid("The line has no discrepancy of this kind.");
        return line;
    }

    private Discrepancy describe(ReceiptLine line,String kind) {
        var claim=db.sql(CLAIMS+" WHERE c.receipt_id=? AND c.line_id=? AND c.kind=?")
                .params(line.receiptId(),line.lineId(),kind).query(Claim.class).optional().orElse(null);
        var events=db.sql("""
                SELECT * FROM bizflow_foundation.discrepancy_resolutions WHERE receipt_id=? AND line_id=? AND kind=? ORDER BY recorded_at,id
                """).params(line.receiptId(),line.lineId(),kind).query(Resolution.class).list();
        long freight=line.allocatedRwf()-line.capitalizedRwf();
        long damagedFreight=share(freight,line.damaged(),line.damaged()+line.missing());
        boolean damaged="DAMAGE".equals(kind);
        long exposure=damaged?line.damageCostRwf()+damagedFreight:freight-damagedFreight;
        long remaining=exposure-events.stream().mapToLong(Resolution::amountRwf).sum();
        String status=remaining==0 && !events.isEmpty()?"RESOLVED":"PENDING";
        return new Discrepancy(line.receiptId(),line.lineId(),line.purchaseId(),kind,damaged?line.damaged():0,
                damaged?0:line.missing(),exposure,remaining,status,claim,events);
    }
}
