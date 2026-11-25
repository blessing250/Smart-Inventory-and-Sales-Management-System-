package com.bizflowjewelry.backend.finance;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class FinancialPostingService {
    private static final long MAX_POSTING = 1_000_000_000_000L;
    private final JdbcClient db;

    FinancialPostingService(JdbcClient db) {
        this.db = db;
    }

    public record Account(String id, String name, String kind, String currency, boolean active, Long balanceRwf,
                          String actorId, OffsetDateTime createdAt,long balanceMinor) {}
    public record Posting(String id, String reference, String kind, String fromAccount, String toAccount, long amountRwf,
                          String reversesId, String reason, String actorId, OffsetDateTime recordedAt, LocalDate businessDate,
                          String requestHash,Long sourceMinor,Long destinationMinor,String sourceCurrency,String destinationCurrency,
                          Long rwfRateMicros,Long exchangeRateMicros,long feeMinor,long feeRwf) {}
    record NativeLegs(Long sourceMinor,Long destinationMinor,String sourceCurrency,String destinationCurrency,
                      Long rwfRateMicros,Long exchangeRateMicros,long feeMinor,long feeRwf) {}
    public record Reconciliation(long openingRwf, long receivedRwf, long refundRwf, long reversalRwf,
                                 long expenseRwf, long supplierRwf, long shipmentRwf, long transferInRwf,
                                 long transferOutRwf, long compensationRwf, long reversalInRwf,
                                 long balanceRwf, boolean matches) {}

    @Transactional
    public Account create(String name, String kind, long opening, String actor) {
        String id = UUID.randomUUID().toString();
        db.sql("INSERT INTO bizflow_foundation.financial_accounts(id,name,kind,actor_id) VALUES (?,?,?,?)")
                .params(id, name.strip(), kind, actor).update();
        if (opening > 0) insert("OPENING", "opening:" + id, null, id, opening, null, "", actor);
        audit("account_created",id,actor);
        return account(id);
    }

    @Transactional
    Account update(String id, String name, boolean archive, String actor) {
        lockAccount(id);
        Account current=account(id);
        if (archive && current.balanceMinor()!=0) throw conflict("Transfer the remaining balance before archiving.");
        if (archive) {
            if (!current.active()) return current;
            db.sql("UPDATE bizflow_foundation.financial_accounts SET active=false WHERE id=?").param(id).update();
        } else {
            db.sql("UPDATE bizflow_foundation.financial_accounts SET name=? WHERE id=?").params(name.strip(),id).update();
        }
        audit(archive?"account_archived":"account_renamed",id,actor);
        return account(id);
    }

    public List<Account> accounts() {
        return db.sql("SELECT * FROM bizflow_foundation.financial_account_balances ORDER BY lower(name),id").query(Account.class).list();
    }

    public Account account(String id) {
        return db.sql("SELECT * FROM bizflow_foundation.financial_account_balances WHERE id=?")
                .param(id).query(Account.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Financial account not found."));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void lockAccounts(java.util.Collection<String> ids) {
        ids.stream().distinct().sorted().forEach(this::lockAccount);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public String receive(String accountId, String method, long amount, String reference, String actor) {
        lockAccount(accountId);
        Account account = eligible(accountId);
        if (!account.kind().equals(method)) throw invalid("The receiving account must match the payment method.");
        return insert("CUSTOMER_PAYMENT", "payment:" + reference, null, accountId, amount, null, "", actor);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public String refund(String accountId, long amount, String reference, String actor) {
        lockAccount(accountId);
        requireFunds(accountId, amount);
        return insert("CUSTOMER_REFUND", "refund:" + reference, accountId, null, amount, null, "", actor);
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public String reverseCustomerPayment(String postingId, String reference, String reason, String actor) {
        Posting original = posting(postingId);
        if (!original.kind().equals("CUSTOMER_PAYMENT")) throw invalid("Choose a customer payment.");
        return compensate(original,"payment-reversal:"+reference,reason,actor,null,null);
    }

    Posting posting(String id) {
        return db.sql("SELECT * FROM bizflow_foundation.financial_postings WHERE id=?").param(id).query(Posting.class)
                .optional().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND,"Financial posting not found."));
    }

    @Transactional(propagation=Propagation.MANDATORY)
    String post(String kind, String reference, String from, String to, long amount, String actor, LocalDate date, String hash) {
        if (from!=null && from.equals(to)) throw invalid("Choose two different accounts.");
        lockEndpoints(from,to,amount);
        return insert(kind,reference,from,to,amount,null,"",actor,date,hash);
    }

    @Transactional(propagation=Propagation.MANDATORY)
    String compensate(Posting original, String reference, String reason, String actor, LocalDate date, String hash) {
        String from=original.toAccount();
        String to=original.fromAccount();
        if(original.sourceMinor()!=null || original.destinationMinor()!=null) {
            Long credit=original.sourceMinor()==null?null:Long.valueOf(original.sourceMinor()+original.feeMinor());
            return postNative("REVERSAL",reference,from,to,original.amountRwf(),original.id(),reason,actor,date,hash,
                    new NativeLegs(original.destinationMinor(),credit,original.destinationCurrency(),original.sourceCurrency(),
                            original.rwfRateMicros(),original.exchangeRateMicros(),0,0));
        }
        lockEndpoints(from,to,original.amountRwf());
        return insert("REVERSAL",reference,from,to,original.amountRwf(),original.id(),reason,actor,date,hash);
    }

    private void lockEndpoints(String from,String to,long amount) {
        java.util.stream.Stream.of(from,to).filter(java.util.Objects::nonNull).distinct().sorted().forEach(this::lockAccount);
        if (from!=null) requireFunds(from,amount);
        if (to!=null) eligible(to);
    }

    public Reconciliation reconciliation(String id) {
        if(!"RWF".equals(account(id).currency())) throw invalid("Use native reconciliation for a foreign account.");
        return db.sql("""
                SELECT *,
                       balance_rwf>=0 AND balance_rwf=opening_rwf+received_rwf-refund_rwf-reversal_rwf-expense_rwf
                        -supplier_rwf-shipment_rwf+transfer_in_rwf-transfer_out_rwf+compensation_rwf+reversal_in_rwf AS matches
                FROM (
                    SELECT a.balance_rwf,
                        coalesce(sum(p.amount_rwf) FILTER (WHERE p.kind='OPENING'),0)::bigint AS opening_rwf,
                        coalesce(sum(p.amount_rwf) FILTER (WHERE p.kind='CUSTOMER_PAYMENT'),0)::bigint AS received_rwf,
                        coalesce(sum(p.amount_rwf) FILTER (WHERE p.kind='CUSTOMER_REFUND'),0)::bigint AS refund_rwf,
                        coalesce(sum(coalesce(p.source_minor,p.amount_rwf)) FILTER (WHERE p.kind='REVERSAL' AND p.from_account=a.id),0)::bigint AS reversal_rwf,
                        coalesce(sum(coalesce(p.destination_minor,p.amount_rwf)) FILTER (WHERE p.kind='REVERSAL' AND p.to_account=a.id),0)::bigint AS reversal_in_rwf,
                        coalesce(sum(p.amount_rwf) FILTER (WHERE p.kind='OPERATING_EXPENSE'),0)::bigint AS expense_rwf,
                        coalesce(sum(p.amount_rwf) FILTER (WHERE p.kind='SUPPLIER_PAYMENT'),0)::bigint AS supplier_rwf,
                        coalesce(sum(p.amount_rwf) FILTER (WHERE p.kind='SHIPMENT_PAYMENT'),0)::bigint AS shipment_rwf,
                        coalesce(sum(coalesce(p.destination_minor,p.amount_rwf)) FILTER (WHERE p.kind IN ('TRANSFER','EXCHANGE') AND p.to_account=a.id),0)::bigint AS transfer_in_rwf,
                        coalesce(sum(coalesce(p.source_minor,p.amount_rwf)+p.fee_minor) FILTER (WHERE p.kind IN ('TRANSFER','EXCHANGE') AND p.from_account=a.id),0)::bigint AS transfer_out_rwf,
                        coalesce(sum(p.amount_rwf) FILTER (WHERE p.kind='CLAIM_CASH'),0)::bigint AS compensation_rwf
                    FROM bizflow_foundation.financial_account_balances a
                    LEFT JOIN bizflow_foundation.financial_postings p ON p.from_account=a.id OR p.to_account=a.id
                    WHERE a.id=? GROUP BY a.id,a.balance_rwf
                ) totals
                """).param(id).query(Reconciliation.class).optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Financial account not found."));
    }

    private void lockAccount(String id) {
        if (db.sql("SELECT id FROM bizflow_foundation.financial_accounts WHERE id=? FOR UPDATE")
                .param(id).query(String.class).optional().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Financial account not found.");
        }
    }

    @Transactional
    Account createNative(String name,String kind,String currency,long opening,Long rate,String actor) {
        String id=UUID.randomUUID().toString();
        db.sql("INSERT INTO bizflow_foundation.financial_accounts(id,name,kind,currency,actor_id) VALUES (?,?,?,?,?)")
                .params(id,name.strip(),kind,currency,actor).update();
        if(opening>0) {
            if(rate==null) throw invalid("An opening balance requires an RWF reporting rate.");
            postNative("OPENING","opening:"+id,null,id,FinanceRules.reporting(opening,currency,rate),null,"",actor,
                    FinanceRules.businessDate(null),null,new NativeLegs(null,opening,null,currency,rate,null,0,0));
        }
        audit("account_created",id,actor);
        return account(id);
    }

    @Transactional(propagation=Propagation.MANDATORY)
    String postNative(String kind,String reference,String from,String to,long reporting,String original,String reason,String actor,
                      LocalDate date,String hash,NativeLegs legs) {
        if(from!=null && from.equals(to)) throw invalid("Choose two different accounts.");
        java.util.stream.Stream.of(from,to).filter(java.util.Objects::nonNull).sorted().forEach(this::lockAccount);
        if(from!=null) {
            Account source=account(from);
            if(!source.active() || !source.currency().equals(legs.sourceCurrency())) throw invalid("The source account is inactive or its currency differs.");
            if(source.balanceMinor()<legs.sourceMinor()+legs.feeMinor()) throw conflict("The selected account has insufficient native funds.");
        }
        if(to!=null) {
            Account target=account(to);
            if(!target.active() || !target.currency().equals(legs.destinationCurrency())) throw invalid("The destination account is inactive or its currency differs.");
        }
        return insert(kind,reference,from,to,reporting,original,reason,actor,date,hash,legs);
    }

    record NativeReconciliation(String currency,long debitMinor,long creditMinor,long balanceMinor,boolean matches) {}

    NativeReconciliation nativeReconciliation(String id) {
        return db.sql("""
                SELECT *,balance_minor=credit_minor-debit_minor AND balance_minor>=0 AS matches FROM (
                  SELECT a.currency,a.balance_minor,
                  coalesce(sum(coalesce(p.source_minor,p.amount_rwf)+p.fee_minor) FILTER(WHERE p.from_account=a.id),0)::bigint AS debit_minor,
                  coalesce(sum(coalesce(p.destination_minor,p.amount_rwf)) FILTER(WHERE p.to_account=a.id),0)::bigint AS credit_minor
                  FROM bizflow_foundation.financial_account_balances a LEFT JOIN bizflow_foundation.financial_postings p
                    ON p.from_account=a.id OR p.to_account=a.id WHERE a.id=? GROUP BY a.id,a.currency,a.balance_minor
                ) totals
                """).param(id).query(NativeReconciliation.class).optional().orElseThrow(()->FinanceRules.missing("Financial account not found."));
    }

    private Account eligible(String id) {
        Account account = account(id);
        if (!account.active() || !"RWF".equals(account.currency())) throw invalid("Choose an active RWF account.");
        return account;
    }

    private void requireFunds(String id, long amount) {
        if (eligible(id).balanceRwf() < amount) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The selected account has insufficient funds.");
        }
    }

    private String insert(String kind, String reference, String from, String to, long amount, String reversal, String reason, String actor) {
        return insert(kind,reference,from,to,amount,reversal,reason,actor,null,null);
    }

    private String insert(String kind, String reference, String from, String to, long amount, String reversal, String reason, String actor,
                          LocalDate date,String hash) {
        return insert(kind,reference,from,to,amount,reversal,reason,actor,date,hash,new NativeLegs(null,null,null,null,null,null,0,0));
    }

    private String insert(String kind,String reference,String from,String to,long amount,String reversal,String reason,String actor,
                          LocalDate date,String hash,NativeLegs legs) {
        if (amount < 1 || amount > MAX_POSTING) throw invalid("Financial posting amount is outside the supported range.");
        String id = UUID.randomUUID().toString();
        db.sql("""
                INSERT INTO bizflow_foundation.financial_postings(id,reference,kind,from_account,to_account,amount_rwf,reverses_id,reason,
                    actor_id,business_date,request_hash,source_minor,destination_minor,source_currency,destination_currency,rwf_rate_micros,
                    exchange_rate_micros,fee_minor,fee_rwf) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """).params(id,reference,kind,from,to,amount,reversal,reason,actor,date,hash,legs.sourceMinor(),legs.destinationMinor(),
                legs.sourceCurrency(),legs.destinationCurrency(),legs.rwfRateMicros(),legs.exchangeRateMicros(),legs.feeMinor(),legs.feeRwf()).update();
        return id;
    }

    void audit(String event,String id,String actor) {
        db.sql("INSERT INTO bizflow_foundation.finance_audit(event,entity_id,actor_id) VALUES (?,?,?)").params(event,id,actor).update();
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT,message);
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
