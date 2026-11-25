package com.bizflowjewelry.backend.finance;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;
import static com.bizflowjewelry.backend.finance.FinanceRules.*;
import static com.bizflowjewelry.backend.finance.FinanceController.*;

@Service
class FinanceOperations {
    private final JdbcClient db;
    private final FinancialPostingService finance;
    private final ObjectMapper json;

    FinanceOperations(JdbcClient db,FinancialPostingService finance,ObjectMapper json) {
        this.db=db;
        this.finance=finance;
        this.json=json;
    }

    record Category(String id,String name,boolean active) {}
    record Page<T>(List<T> items,int page,int size,long total) {}
    record Transaction(String id,String reference,String kind,String fromAccount,String toAccount,long amountRwf,String reversesId,
                       boolean reversed,String reason,String actorId,LocalDate date,OffsetDateTime recordedAt,
                       Long sourceMinor,Long destinationMinor,String sourceCurrency,String destinationCurrency,
                       Long rwfRateMicros,Long exchangeRateMicros,long feeMinor,long feeRwf) {}
    record Expense(String id,String reference,String accountId,long amountRwf,LocalDate date,String actorId,boolean reversed,
                   String categoryId,String categoryName,String description,String payee,String receiptReference,String relatedReference,int receiptCount) {}
    record Attachment(String id,String filename,String mediaType,int size,OffsetDateTime recordedAt) {}
    record ReceiptFile(String filename,String mediaType,byte[] contents) {}
    record CategoryTotal(String categoryId,String categoryName,long amountRwf) {}
    record Obligation(String purchaseId,String supplierId,String currency,long totalRwf,long originalMinor,long cashRwf,
                      long releasedRwf,long creditRwf,long outstandingRwf,long outstandingMinor) {}
    record Allocation(String purchaseId,long cashRwf,long releasedRwf,long payableMinor,Long sourceMinor,long fxLossRwf) {}
    record SupplierPayment(Transaction posting,List<Allocation> allocations) {}
    record Charge(String shipmentId,String kind,long amountRwf,long paidRwf,long outstandingRwf) {}
    record ShipmentSummary(long recordedRwf,long capitalizedRwf,long heldRwf,long paidRwf,long outstandingRwf,
                           long supplierCreditsRwf,long compensationRwf,long lossesRwf,boolean matches) {}
    record Reconciliation(long revenueRwf,long paymentsRwf,long refundedRwf,long receivableRwf,long cogsRwf,
                          long grossProfitRwf,long operatingExpensesRwf,long supplierOutstandingRwf,long shipmentOutstandingRwf,
                          long compensationRwf,long supplierCreditsRwf,long lossesRwf,long brokenLinks,boolean matches) {}

    private static final String DATE = "coalesce(p.business_date,(p.recorded_at AT TIME ZONE 'Africa/Kigali')::date)";
    private static final String REVERSED = "EXISTS(SELECT 1 FROM bizflow_foundation.financial_postings r WHERE r.reverses_id=p.id)";
    private static final String TRANSACTIONS=" FROM bizflow_foundation.financial_postings p";
    private static final String EXPENSES=TRANSACTIONS+" JOIN bizflow_foundation.operating_expenses e ON e.posting_id=p.id";
    private static final String EXPENSE_FIELDS="p.id,p.reference,p.from_account AS account_id,p.amount_rwf,"+DATE+" AS date,p.actor_id,"
            +REVERSED+" AS reversed,e.*, (SELECT count(*) FROM bizflow_foundation.operating_expense_receipts rr WHERE rr.posting_id=p.id) AS receipt_count";

    List<Category> categories() {
        return db.sql("SELECT id,name,active FROM bizflow_foundation.expense_categories ORDER BY lower(name),id").query(Category.class).list();
    }

    @Transactional
    Category category(String id,CategoryInput input,String actor) {
        String category=id==null?id():id;
        if(id==null) {
            db.sql("INSERT INTO bizflow_foundation.expense_categories(id,name,active,actor_id) VALUES (?,?,?,?)")
                .params(category,input.name().strip(),input.active()==null||input.active(),actor).update();
        } else if(db.sql("UPDATE bizflow_foundation.expense_categories SET name=?,active=coalesce(?,active) WHERE id=?")
                .params(input.name().strip(),input.active(),category).update()==0) throw missing("Expense category not found.");
        finance.audit("expense_category_saved",category,actor);
        return db.sql("SELECT id,name,active FROM bizflow_foundation.expense_categories WHERE id=?").param(category).query(Category.class).single();
    }

    @Transactional
    Expense expense(ExpenseInput input,String key,ReceiptFile file,String actor) {
        lock();
        String reference="expense:"+operationKey(input.reference(),key);
        String hash=hash(input);
        String prior=prior(reference,hash);
        if(prior!=null) {
            if(file!=null) attach(prior,file,actor);
            return expense(prior);
        }
        String category=db.sql("SELECT name FROM bizflow_foundation.expense_categories WHERE id=? AND active FOR SHARE")
                .param(input.categoryId()).query(String.class).optional().orElseThrow(()->invalid("Choose an active expense category."));
        String id=debit("OPERATING_EXPENSE",reference,input.accountId(),input.amountRwf(),input.sourceMinor(),input.rwfRateMicros(),
                actor,businessDate(input.date()),hash);
        db.sql("INSERT INTO bizflow_foundation.operating_expenses VALUES (?,?,?,?,?,?,?)")
                .params(id,input.categoryId(),category,clean(input.description()),clean(input.payee()),clean(input.receiptReference()),clean(input.relatedReference())).update();
        if(file!=null) attach(id,file,actor);
        finance.audit("expense_recorded",id,actor);
        return expense(id);
    }

    Expense expense(String id) {
        return db.sql("SELECT "+EXPENSE_FIELDS+EXPENSES+" WHERE p.id=?").param(id).query(Expense.class).optional()
                .orElseThrow(()->missing("Expense not found."));
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Page<Expense> expenses(String q,String category,String account,LocalDate from,LocalDate to,Boolean reversed,int page,int size) {
        var filter=expenseFilter(q,category,account,from,to,reversed);
        return page(EXPENSE_FIELDS,EXPENSES+filter.where(),filter.params(),page,size,Expense.class);
    }

    List<CategoryTotal> expenseTotals(String category,String account,LocalDate from,LocalDate to) {
        var filter=expenseFilter(null,category,account,from,to,false);
        return db.sql("SELECT e.category_id,c.name AS category_name,sum(p.amount_rwf)::bigint AS amount_rwf"+EXPENSES
                +" JOIN bizflow_foundation.expense_categories c ON c.id=e.category_id"+filter.where()
                +" GROUP BY e.category_id,c.name ORDER BY c.name,e.category_id").params(filter.params()).query(CategoryTotal.class).list();
    }

    @Transactional
    Attachment attach(String expense,ReceiptFile file,String actor) {
        expense(expense);
        String id=id();
        String digest=digest(file.contents());
        int inserted=db.sql("""
                INSERT INTO bizflow_foundation.operating_expense_receipts(id,posting_id,filename,media_type,contents,digest,actor_id)
                VALUES (?,?,?,?,?,?,?) ON CONFLICT(posting_id,digest) DO NOTHING
                """).params(id,expense,file.filename(),file.mediaType(),file.contents(),digest,actor).update();
        if(inserted>0) finance.audit("expense_receipt_attached",id,actor);
        return db.sql("""
                SELECT id,filename,media_type,octet_length(contents) AS size,recorded_at
                FROM bizflow_foundation.operating_expense_receipts WHERE posting_id=? AND digest=?
                """).params(expense,digest).query(Attachment.class).single();
    }

    List<Attachment> attachments(String id) {
        expense(id);
        return db.sql("""
                SELECT id,filename,media_type,octet_length(contents) AS size,recorded_at
                FROM bizflow_foundation.operating_expense_receipts WHERE posting_id=? ORDER BY recorded_at,id
                """).param(id).query(Attachment.class).list();
    }

    ReceiptFile attachment(String expense,String id) {
        return db.sql("SELECT filename,media_type,contents FROM bizflow_foundation.operating_expense_receipts WHERE posting_id=? AND id=?")
                .params(expense,id).query(ReceiptFile.class).optional().orElseThrow(()->missing("Receipt not found."));
    }

    @Transactional
    Transaction transfer(TransferInput input,String actor) {
        lock();
        String reference="transfer:"+input.reference().strip();
        String hash=hash(input);
        String prior=prior(reference,hash);
        if(prior!=null) return transaction(prior);
        String id=finance.post("TRANSFER",reference,input.fromAccount(),input.toAccount(),input.amountRwf(),actor,businessDate(input.date()),hash);
        finance.audit("transfer_recorded",id,actor);
        return transaction(id);
    }

    @Transactional
    Transaction exchange(ExchangeInput input,String actor) {
        lock();
        String reference="native-transfer:"+input.reference().strip();
        String hash=hash(input);
        String prior=prior(reference,hash);
        if(prior!=null) return transaction(prior);
        String from=finance.account(input.fromAccount()).currency();
        String to=finance.account(input.toAccount()).currency();
        long fee=input.feeMinor()==null?0:input.feeMinor();
        long rwf=reporting(input.sourceMinor(),from,input.rwfRateMicros());
        boolean same=from.equals(to);
        if(same) {
            if(!input.sourceMinor().equals(input.destinationMinor()) || fee!=0 || input.exchangeRateMicros()!=null) {
                throw invalid("Same-currency transfers require equal amounts and no exchange terms.");
            }
        } else {
            if(input.exchangeRateMicros()==null) throw invalid("Enter the agreed exchange rate.");
            long sourceScale="RWF".equals(from)?1:100;
            long destinationScale="RWF".equals(to)?1:100;
            long expected=share(input.sourceMinor(),input.exchangeRateMicros()*destinationScale,sourceScale*1_000_000L);
            if(expected!=input.destinationMinor()) throw invalid("The received amount must match the agreed exchange rate.");
            if("RWF".equals(to) && rwf!=input.destinationMinor()) throw invalid("The reporting equivalent must match the RWF received.");
        }
        long feeRwf=fee==0?0:share(fee,input.rwfRateMicros(),"RWF".equals(from)?1_000_000:100_000_000);
        String id=finance.postNative(same?"TRANSFER":"EXCHANGE",reference,input.fromAccount(),input.toAccount(),rwf,null,"",actor,
                businessDate(input.date()),hash,new FinancialPostingService.NativeLegs(input.sourceMinor(),input.destinationMinor(),
                        from,to,input.rwfRateMicros(),input.exchangeRateMicros(),fee,feeRwf));
        finance.audit(same?"transfer_recorded":"exchange_recorded",id,actor);
        return transaction(id);
    }

    @Transactional
    Transaction reverse(String id,ReverseInput input,String actor) {
        lock();
        String reference="finance-reversal:"+input.reference().strip();
        String hash=hash(List.of(id,input));
        String prior=prior(reference,hash);
        if(prior!=null) return transaction(prior);
        var original=finance.posting(id);
        if(!List.of("OPERATING_EXPENSE","SUPPLIER_PAYMENT","SHIPMENT_PAYMENT","TRANSFER","EXCHANGE").contains(original.kind())) {
            throw conflict("This posting requires its own coordinated correction.");
        }
        if(transaction(id).reversed()) throw conflict("This posting has already been reversed.");
        String reversal=finance.compensate(original,reference,input.reason().strip(),actor,businessDate(input.date()),hash);
        finance.audit("posting_reversed",reversal,actor);
        return transaction(reversal);
    }

    @Transactional
    SupplierPayment supplierPay(String supplier,SupplierPaymentInput input,String actor) {
        lock();
        String reference="supplier:"+input.reference().strip();
        String hash=hash(List.of(supplier,input));
        String prior=prior(reference,hash);
        if(prior!=null) return supplierPayment(prior);
        requireSupplier(supplier);
        var allocations=new ArrayList<Allocation>();
        var seen=new HashSet<String>();
        long total=0;
        long nativeTotal=0;
        String currency=finance.account(input.accountId()).currency();
        boolean foreign=!"RWF".equals(currency);
        for(var item:input.allocations()) {
            if(!seen.add(item.purchaseId())) throw invalid("Allocate to each purchase once.");
            Obligation due=obligation(item.purchaseId(),supplier);
            if(foreign) {
                if(input.rwfRateMicros()==null || item.sourceMinor()==null ||
                        reporting(item.sourceMinor(),currency,input.rwfRateMicros())!=item.amountRwf()) throw invalid("Provide each native allocation and its actual RWF rate.");
                if(currency.equals(due.currency()) && !item.sourceMinor().equals(item.payableMinor())) throw invalid("Native payment and discharge must match.");
                nativeTotal+=item.sourceMinor();
            } else if(item.sourceMinor()!=null || input.rwfRateMicros()!=null) {
                throw invalid("RWF payments do not require native source amounts or a rate.");
            }
            long minor="RWF".equals(due.currency())?item.amountRwf():(item.payableMinor()==null?0:item.payableMinor());
            if("RWF".equals(due.currency()) && item.payableMinor()!=null && item.payableMinor()!=minor) {
                throw invalid("RWF discharge must match the cash amount.");
            }
            long released=release(due.outstandingRwf(),due.outstandingMinor(),minor);
            allocations.add(new Allocation(item.purchaseId(),item.amountRwf(),released,minor,item.sourceMinor(),item.amountRwf()-released));
            total+=item.amountRwf();
        }
        if(total>MAX || nativeTotal>MAX) throw invalid("Payment exceeds the supported range.");
        String id=foreign?finance.postNative("SUPPLIER_PAYMENT",reference,input.accountId(),null,total,null,"",actor,
                businessDate(input.date()),hash,new FinancialPostingService.NativeLegs(nativeTotal,null,currency,null,input.rwfRateMicros(),null,0,0)):
                finance.post("SUPPLIER_PAYMENT",reference,input.accountId(),null,total,actor,businessDate(input.date()),hash);
        for(var allocation:allocations) {
            db.sql("INSERT INTO bizflow_foundation.supplier_payment_allocations(posting_id,purchase_id,cash_rwf,released_rwf,payable_minor,source_minor) VALUES (?,?,?,?,?,?)")
                .params(id,allocation.purchaseId(),allocation.cashRwf(),allocation.releasedRwf(),allocation.payableMinor(),allocation.sourceMinor()).update();
        }
        finance.audit("supplier_payment_recorded",id,actor);
        return supplierPayment(id);
    }

    @Transactional
    Transaction shipmentPay(String shipment,ShipmentPaymentInput input,String actor) {
        lock();
        String reference="shipment:"+input.reference().strip();
        String hash=hash(List.of(shipment,input));
        String prior=prior(reference,hash);
        if(prior!=null) return transaction(prior);
        var charge=db.sql("SELECT * FROM bizflow_foundation.shipment_charge_finance WHERE shipment_id=? AND kind=?")
                .params(shipment,input.chargeKind()).query(Charge.class).optional().orElseThrow(()->missing("Shipment charge not found."));
        if(input.amountRwf()>charge.outstandingRwf()) throw conflict("Payment exceeds the outstanding shipment charge.");
        String id=debit("SHIPMENT_PAYMENT",reference,input.accountId(),input.amountRwf(),input.sourceMinor(),input.rwfRateMicros(),
                actor,businessDate(input.date()),hash);
        db.sql("INSERT INTO bizflow_foundation.shipment_payment_allocations VALUES (?,?,?)")
                .params(id,shipment,input.chargeKind()).update();
        finance.audit("shipment_payment_recorded",id,actor);
        return transaction(id);
    }

    List<Obligation> obligations(String supplier) {
        requireSupplier(supplier);
        return db.sql("SELECT * FROM bizflow_foundation.supplier_obligations WHERE supplier_id=? ORDER BY purchase_id")
                .param(supplier).query(Obligation.class).list();
    }

    private String debit(String kind,String reference,String account,long rwf,Long minor,Long rate,String actor,LocalDate date,String hash) {
        String currency=finance.account(account).currency();
        if("RWF".equals(currency) && minor==null && rate==null) return finance.post(kind,reference,account,null,rwf,actor,date,hash);
        if(minor==null || rate==null || reporting(minor,currency,rate)!=rwf) throw invalid("The actual rate and native amount must match reporting value.");
        return finance.postNative(kind,reference,account,null,rwf,null,"",actor,date,hash,
                new FinancialPostingService.NativeLegs(minor,null,currency,null,rate,null,0,0));
    }

    Obligation obligation(String id,String supplier) {
        return db.sql("SELECT * FROM bizflow_foundation.supplier_obligations WHERE purchase_id=? AND supplier_id=?")
                .params(id,supplier).query(Obligation.class).optional().orElseThrow(()->missing("An eligible supplier purchase was not found."));
    }

    private void requireSupplier(String id) {
        exists("procurement_contacts","id=? AND kind='SUPPLIER'",id,"Supplier not found.");
    }

    SupplierPayment supplierPayment(String id) {
        return new SupplierPayment(transaction(id),db.sql("""
                SELECT purchase_id,cash_rwf,released_rwf,payable_minor,source_minor,cash_rwf-released_rwf AS fx_loss_rwf
                      FROM bizflow_foundation.supplier_payment_allocations
                WHERE posting_id=? ORDER BY purchase_id
                """).param(id).query(Allocation.class).list());
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Page<Transaction> supplierPayments(String id,int page,int size) {
        requireSupplier(id);
        return page(transactionFields(),TRANSACTIONS+"""
                 WHERE EXISTS(SELECT 1 FROM bizflow_foundation.supplier_payment_allocations a
                     JOIN bizflow_foundation.procurement_orders o ON o.id=a.purchase_id
                     WHERE a.posting_id=p.id AND o.supplier_id=?)
                """,List.of(id),page,size,Transaction.class);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    SupplierPayment supplierPayment(String supplier,String id) {
        if (!db.sql("""
                SELECT EXISTS(SELECT 1 FROM bizflow_foundation.supplier_payment_allocations a
                  JOIN bizflow_foundation.procurement_orders o ON o.id=a.purchase_id WHERE a.posting_id=? AND o.supplier_id=?)
                """).params(id,supplier).query(Boolean.class).single()) throw missing("Supplier payment not found.");
        return supplierPayment(id);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Page<Transaction> shipmentPayments(String id,int page,int size) {
        exists("procurement_shipments","id=?",id,"Shipment not found.");
        return page(transactionFields(),TRANSACTIONS+"""
                 JOIN bizflow_foundation.shipment_payment_allocations a ON a.posting_id=p.id WHERE a.shipment_id=?
                """,List.of(id),page,size,Transaction.class);
    }

    List<Charge> shipmentCharges(String id) {
        exists("procurement_shipments","id=?",id,"Shipment not found.");
        return db.sql("SELECT * FROM bizflow_foundation.shipment_charge_finance WHERE shipment_id=? ORDER BY kind").param(id).query(Charge.class).list();
    }

    ShipmentSummary shipmentSummary(String id) {
        exists("procurement_shipments","id=?",id,"Shipment not found.");
        return db.sql("""
                SELECT c.*,r.*,d.*,paid_rwf<=recorded_rwf AND capitalized_rwf+held_rwf<=recorded_rwf AS matches
                FROM (SELECT coalesce(sum(amount_rwf),0)::bigint AS recorded_rwf,coalesce(sum(paid_rwf),0)::bigint AS paid_rwf,
                    coalesce(sum(outstanding_rwf),0)::bigint AS outstanding_rwf
                    FROM bizflow_foundation.shipment_charge_finance WHERE shipment_id=?) c
                CROSS JOIN (SELECT coalesce(sum(capitalized_rwf),0)::bigint AS capitalized_rwf,
                    coalesce(sum(allocated_rwf-capitalized_rwf),0)::bigint AS held_rwf
                    FROM bizflow_foundation.active_procurement_receipt_lines WHERE shipment_id=?) r
                CROSS JOIN (SELECT coalesce(sum(amount_rwf) FILTER (WHERE action='CREDIT'),0)::bigint AS supplier_credits_rwf,
                    coalesce(sum(amount_rwf) FILTER (WHERE action='CASH'),0)::bigint AS compensation_rwf,
                    coalesce(sum(amount_rwf) FILTER (WHERE action='LOSS'),0)::bigint AS losses_rwf
                    FROM bizflow_foundation.discrepancy_resolutions d JOIN bizflow_foundation.procurement_receipts p ON p.id=d.receipt_id
                    WHERE p.shipment_id=?) d
                """).params(id,id,id).query(ShipmentSummary.class).single();
    }

    Transaction transaction(String id) {
        return db.sql("SELECT "+transactionFields()+TRANSACTIONS+" WHERE p.id=?").param(id).query(Transaction.class)
                .optional().orElseThrow(()->missing("Financial posting not found."));
    }

    Reconciliation reconcile() {
        return db.sql("""
                SELECT sales.*,expenses.*,suppliers.*,shipments.*,claims.*,checks.*,
                       sales_balanced AND supplier_balanced AND shipment_balanced AND broken_links=0 AS matches
                FROM (SELECT coalesce(sum(total_rwf-credit_rwf),0)::bigint AS revenue_rwf,
                         coalesce(sum(received_rwf-reversed_rwf),0)::bigint AS payments_rwf,
                         coalesce(sum(refunded_rwf),0)::bigint AS refunded_rwf,
                         coalesce(sum(outstanding_rwf),0)::bigint AS receivable_rwf,
                         coalesce(sum(cost_rwf-restored_rwf),0)::bigint AS cogs_rwf,
                         coalesce(sum(gross_profit_rwf),0)::bigint AS gross_profit_rwf,
                         coalesce(bool_and(outstanding_rwf>=0 AND paid_rwf>=0),true) AS sales_balanced
                      FROM bizflow_foundation.sale_balances) sales
                CROSS JOIN (SELECT coalesce(sum(amount_rwf),0)::bigint AS operating_expenses_rwf
                     FROM bizflow_foundation.financial_postings p WHERE p.kind='OPERATING_EXPENSE'
                     AND NOT EXISTS(SELECT 1 FROM bizflow_foundation.financial_postings r WHERE r.reverses_id=p.id)) expenses
                CROSS JOIN (SELECT coalesce(sum(outstanding_rwf),0)::bigint AS supplier_outstanding_rwf,
                     coalesce(bool_and(outstanding_rwf>=0 AND outstanding_minor>=0),true) AS supplier_balanced
                     FROM bizflow_foundation.supplier_obligations) suppliers
                CROSS JOIN (SELECT coalesce(sum(outstanding_rwf),0)::bigint AS shipment_outstanding_rwf,
                     coalesce(bool_and(outstanding_rwf>=0),true) AS shipment_balanced
                     FROM bizflow_foundation.shipment_charge_finance) shipments
                CROSS JOIN (SELECT coalesce(sum(amount_rwf) FILTER(WHERE action='CASH'),0)::bigint AS compensation_rwf,
                     coalesce(sum(amount_rwf) FILTER(WHERE action='CREDIT'),0)::bigint AS supplier_credits_rwf,
                     coalesce(sum(amount_rwf) FILTER(WHERE action='LOSS'),0)::bigint AS losses_rwf
                     FROM bizflow_foundation.discrepancy_resolutions) claims
                CROSS JOIN (SELECT count(*) AS broken_links FROM bizflow_foundation.financial_postings p WHERE
                    (p.kind='OPERATING_EXPENSE' AND NOT EXISTS(SELECT 1 FROM bizflow_foundation.operating_expenses e WHERE e.posting_id=p.id))
                    OR (p.kind='SUPPLIER_PAYMENT' AND p.amount_rwf<>(SELECT coalesce(sum(a.cash_rwf),0)
                        FROM bizflow_foundation.supplier_payment_allocations a WHERE a.posting_id=p.id))
                    OR (p.kind='SHIPMENT_PAYMENT' AND NOT EXISTS(SELECT 1 FROM bizflow_foundation.shipment_payment_allocations a WHERE a.posting_id=p.id))
                    OR (p.kind='CLAIM_CASH' AND NOT EXISTS(SELECT 1 FROM bizflow_foundation.discrepancy_resolutions d
                        WHERE d.posting_id=p.id AND p.amount_rwf=d.amount_rwf))
                    OR (p.kind='REVERSAL' AND NOT EXISTS(SELECT 1 FROM bizflow_foundation.financial_postings r
                         WHERE r.id=p.reverses_id AND r.from_account IS NOT DISTINCT FROM p.to_account
                           AND r.to_account IS NOT DISTINCT FROM p.from_account AND r.amount_rwf=p.amount_rwf
                           AND r.destination_currency IS NOT DISTINCT FROM p.source_currency
                           AND r.source_currency IS NOT DISTINCT FROM p.destination_currency
                           AND r.destination_minor IS NOT DISTINCT FROM p.source_minor
                           AND (CASE WHEN r.source_minor IS NULL THEN NULL ELSE r.source_minor+r.fee_minor END) IS NOT DISTINCT FROM p.destination_minor))) checks
                """).query(Reconciliation.class).single();
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Page<Transaction> transactions(String kind,String account,LocalDate from,LocalDate to,Boolean reversed,int page,int size) {
        var f=new Filter().dates(from,to).reversed(reversed).where("p.kind=?",kind)
                .where("(p.from_account=? OR p.to_account=?)",account,account);
        return page(transactionFields(),TRANSACTIONS+f.where(),f.params(),page,size,Transaction.class);
    }

    private static String transactionFields() { return "p.*,"+DATE+" AS date,"+REVERSED+" AS reversed"; }

    private Filter expenseFilter(String q,String category,String account,LocalDate from,LocalDate to,Boolean reversed) {
        return new Filter().dates(from,to).reversed(reversed).where("e.category_id=?",category).where("p.from_account=?",account)
            .where("strpos(lower(concat_ws(' ',p.reference,e.description,e.payee,e.receipt_reference,e.category_name)),lower(?))>0",q);
    }

    private <T> Page<T> page(String fields,String from,List<Object> params,int page,int size,Class<T> type) {
        long total=db.sql("SELECT count(*)"+from).params(params).query(Long.class).single();
        var args=new ArrayList<>(params);
        args.add(size);
        args.add((long)page*size);
        return new Page<>(db.sql("SELECT "+fields+from+" ORDER BY "+DATE+" DESC,p.recorded_at DESC,p.id LIMIT ? OFFSET ?")
                .params(args).query(type).list(),page,size,total);
    }

    private static class Filter {
        final StringBuilder clauses=new StringBuilder(" WHERE true");
        final List<Object> values=new ArrayList<>();
        Filter where(String sql,Object... args) {
            if(args[0]!=null) { clauses.append(" AND ").append(sql); Collections.addAll(values,args); }
            return this;
        }
        Filter dates(LocalDate from,LocalDate to) {
            if(from!=null && to!=null && from.isAfter(to)) throw invalid("The date range is reversed.");
            return where(DATE+">=?",from).where(DATE+"<=?",to);
        }
        Filter reversed(Boolean reversed) { return where(REVERSED+"=?",reversed); }
        String where() { return clauses.toString(); }
        List<Object> params() { return values; }
    }

    void lock() {
        db.sql("SELECT pg_advisory_xact_lock(12790421,5)").query((row,n)->1).single();
    }

    void exists(String table,String condition,String id,String error) {
        if(!db.sql("SELECT EXISTS(SELECT 1 FROM bizflow_foundation."+table+" WHERE "+condition+")")
                .param(id).query(Boolean.class).single()) throw missing(error);
    }

    String prior(String reference,String hash) {
        var found=db.sql("SELECT * FROM bizflow_foundation.financial_postings WHERE reference=?")
                .param(reference).query(FinancialPostingService.Posting.class).optional();
        if(found.isEmpty()) return null;
        if(!hash.equals(found.get().requestHash())) throw conflict("The reference belongs to a different request.");
        return found.get().id();
    }

    private static String operationKey(String reference,String header) {
        if(!clean(reference).isEmpty() && !clean(header).isEmpty() && !reference.strip().equals(header.strip())) {
            throw invalid("The expense reference and retry key disagree.");
        }
        String selected=clean(reference).isEmpty()?clean(header):reference.strip();
        if(selected.length()>150) throw invalid("The expense reference is too long.");
        return selected.isEmpty()?id():selected;
    }

    String hash(Object request) { return digest(json.writeValueAsBytes(request)); }
    private static String digest(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch(NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required.",e);
        }
    }
}
