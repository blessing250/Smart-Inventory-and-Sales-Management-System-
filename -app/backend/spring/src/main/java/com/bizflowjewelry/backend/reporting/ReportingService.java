package com.bizflowjewelry.backend.reporting;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
class ReportingService {
    static final int EXPORT_LIMIT=10_000;
    private static final String TODAY="(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Kigali')::date";
    private static final String SALE_EVENTS="""
            SELECT s.sale_date AS day,i.id AS row_id,i.sku || ' - ' || i.product_name AS product,coalesce(i.category_snapshot,p.category) AS category,s.channel,
                   i.revenue_rwf AS revenue_rwf,i.cost_rwf AS cogs_rwf
            FROM bizflow_foundation.retail_sales s JOIN bizflow_foundation.sale_items i ON i.sale_id=s.id JOIN bizflow_foundation.catalog_products p ON p.id=i.product_id
            UNION ALL
            SELECT (r.recorded_at AT TIME ZONE 'Africa/Kigali')::date,r.id,i.sku || ' - ' || i.product_name,coalesce(i.category_snapshot,p.category),s.channel,
                   -r.revenue_credit_rwf,-r.restored_cost_rwf
            FROM bizflow_foundation.sale_returns r JOIN bizflow_foundation.retail_sales s ON s.id=r.sale_id JOIN bizflow_foundation.sale_items i ON i.id=r.item_id
            JOIN bizflow_foundation.catalog_products p ON p.id=i.product_id
            """;
    private final JdbcClient db;

    ReportingService(JdbcClient db) { this.db=db; }

    record Column(String key,String label,boolean numeric,String unit) {}
    record Report(String title,LocalDate from,LocalDate to,String search,int page,int size,long total,
                  List<Column> columns,List<Map<String,Object>> rows,Map<String,BigDecimal> totals,Brand brand) {}
    record Brand(String name,String address,String phone,String receiptFooter) {}
    private record Definition(String title,String query,List<String> numeric,boolean snapshot) {}
    private record SaleReceipt(String reference,String customerName,LocalDate saleDate,long totalRwf,
                               long creditRwf,long refundedRwf,long paidRwf,long outstandingRwf) {}
    private static final Map<String,Definition> REPORTS=Map.ofEntries(
        Map.entry("receivables",new Definition("Customer receivables","""
            SELECT sale_date AS day,id AS row_id,coalesce(customer_name,'Walk-in') || ' / ' || reference AS label,
                   total_rwf-credit_rwf AS revenue_rwf,received_rwf-reversed_rwf AS received_rwf,refunded_rwf,outstanding_rwf
            FROM bizflow_foundation.sale_balances WHERE outstanding_rwf>0
            """,List.of("revenue_rwf","received_rwf","refunded_rwf","outstanding_rwf"),false)),
        Map.entry("payables",new Definition("Supplier payables","""
            SELECT o.purchase_date AS day,o.id AS row_id,o.supplier_name || ' / ' || o.reference AS label,
                   b.total_rwf,b.cash_rwf,b.released_rwf,b.credit_rwf,b.outstanding_rwf,(b.cash_rwf-b.released_rwf) AS fx_loss_rwf
            FROM bizflow_foundation.supplier_obligations b JOIN bizflow_foundation.procurement_orders o ON o.id=b.purchase_id
            """,List.of("total_rwf","cash_rwf","released_rwf","credit_rwf","outstanding_rwf","fx_loss_rwf"),false)),
        Map.entry("expenses",new Definition("Operating expenses by category","""
            SELECT coalesce(p.business_date,(p.recorded_at AT TIME ZONE 'Africa/Kigali')::date) AS day,p.id AS row_id,
                   e.category_name || ' / ' || e.description AS label,e.category_name,p.amount_rwf
            FROM bizflow_foundation.operating_expenses e JOIN bizflow_foundation.financial_postings p ON p.id=e.posting_id
            WHERE NOT EXISTS(SELECT 1 FROM bizflow_foundation.financial_postings r WHERE r.reverses_id=p.id)
            """,List.of("amount_rwf"),false)),
        Map.entry("settlements",new Definition("Settlements and realized exchange differences","""
            SELECT coalesce(p.business_date,(p.recorded_at AT TIME ZONE 'Africa/Kigali')::date) AS day,
                   p.id AS row_id,p.kind || ' / ' || p.reference AS label,
                   CASE WHEN p.kind='CUSTOMER_PAYMENT' THEN p.amount_rwf ELSE 0 END AS collected_rwf,
                   CASE WHEN p.kind='CUSTOMER_REFUND' THEN p.amount_rwf ELSE 0 END AS refunded_rwf,
                   CASE WHEN p.kind='SUPPLIER_PAYMENT' THEN p.amount_rwf ELSE 0 END AS supplier_rwf,
                   CASE WHEN p.kind='SHIPMENT_PAYMENT' THEN p.amount_rwf ELSE 0 END AS shipment_rwf,
                   coalesce(a.fx_loss_rwf,0) AS fx_loss_rwf,p.fee_rwf
            FROM bizflow_foundation.financial_postings p
            LEFT JOIN LATERAL (SELECT sum(cash_rwf-released_rwf)::bigint AS fx_loss_rwf
                  FROM bizflow_foundation.supplier_payment_allocations WHERE posting_id=p.id) a ON true
            WHERE p.kind IN ('CUSTOMER_PAYMENT','CUSTOMER_REFUND','SUPPLIER_PAYMENT','SHIPMENT_PAYMENT','EXCHANGE')
              AND NOT EXISTS(SELECT 1 FROM bizflow_foundation.financial_postings r WHERE r.reverses_id=p.id)
            """,List.of("collected_rwf","refunded_rwf","supplier_rwf","shipment_rwf","fx_loss_rwf","fee_rwf"),false)),
        Map.entry("accounts",new Definition("Current financial balances","""
            SELECT """+TODAY+"""
                AS day,id AS row_id,name AS label,currency,balance_minor AS native_amount,balance_rwf
            FROM bizflow_foundation.financial_account_balances
            """,List.of("balance_rwf"),true)),
        Map.entry("transactions",new Definition("Account transaction history","""
            SELECT coalesce(p.business_date,(p.recorded_at AT TIME ZONE 'Africa/Kigali')::date) AS day,p.id AS row_id,
                   p.kind || ' / ' || p.reference AS label,p.source_currency,p.destination_currency,
                   p.source_minor,p.destination_minor,p.amount_rwf,p.fee_rwf
            FROM bizflow_foundation.financial_postings p
            """,List.of(),false)),
        Map.entry("inventory",new Definition("Current inventory valuation","""
            SELECT """+TODAY+"""
                AS day,p.id AS row_id,p.sku || ' - ' || p.name AS label,coalesce(b.quantity,0) AS quantity,coalesce(b.value_rwf,0) AS value_rwf
            FROM bizflow_foundation.catalog_products p LEFT JOIN bizflow_foundation.inventory_balances b ON b.product_id=p.id
            """,List.of("quantity","value_rwf"),true)),
        Map.entry("movements",new Definition("Stock movement history","""
            SELECT (m.recorded_at AT TIME ZONE 'Africa/Kigali')::date AS day,m.id::text AS row_id,
                   p.sku || ' / ' || m.kind || ' / ' || m.reference AS label,m.delta AS quantity,m.value_delta_rwf
            FROM bizflow_foundation.inventory_movements m JOIN bizflow_foundation.catalog_products p ON p.id=m.product_id
            """,List.of("quantity","value_delta_rwf"),false)),
        Map.entry("purchases",new Definition("Purchases","""
            SELECT purchase_date AS day,id AS row_id,reference || ' / ' || supplier_name AS label,currency,rate_micros,total_rwf
            FROM bizflow_foundation.procurement_orders WHERE NOT cancelled
            """,List.of("total_rwf"),false)),
        Map.entry("receipts",new Definition("Shipment receiving and landed cost","""
            SELECT p.receipt_date AS day,p.id || ':' || r.line_id AS row_id,s.tracking || ' / ' || p.reference AS label,
                   r.usable,r.damaged,r.missing,r.allocated_rwf,r.capitalized_rwf,r.usable_cost_rwf+r.capitalized_rwf AS landed_rwf
            FROM bizflow_foundation.active_procurement_receipt_lines r JOIN bizflow_foundation.procurement_receipts p ON p.id=r.receipt_id
            JOIN bizflow_foundation.procurement_shipments s ON s.id=p.shipment_id
            """,List.of("usable","damaged","missing","allocated_rwf","capitalized_rwf","landed_rwf"),false)),
        Map.entry("discrepancies",new Definition("Shipment discrepancies","""
            SELECT p.receipt_date AS day,p.id || ':' || r.line_id AS row_id,s.tracking || ' / ' || r.explanation AS label,
                   r.damaged,r.missing,r.damage_cost_rwf,r.allocated_rwf-r.capitalized_rwf AS held_rwf,
                   coalesce(sum(d.amount_rwf) FILTER(WHERE d.action='LOSS'),0)::bigint AS loss_rwf
            FROM bizflow_foundation.active_procurement_receipt_lines r JOIN bizflow_foundation.procurement_receipts p ON p.id=r.receipt_id
            JOIN bizflow_foundation.procurement_shipments s ON s.id=p.shipment_id
            LEFT JOIN bizflow_foundation.discrepancy_resolutions d ON d.receipt_id=r.receipt_id AND d.line_id=r.line_id
            WHERE r.damaged+r.missing>0
            GROUP BY p.receipt_date,p.id,r.line_id,s.tracking,r.explanation,r.damaged,r.missing,r.damage_cost_rwf,r.allocated_rwf,r.capitalized_rwf
            """,List.of("damaged","missing","damage_cost_rwf","held_rwf","loss_rwf"),false))
    );

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Report report(String kind,String group,LocalDate from,LocalDate to,String q,int page,int size,boolean export) {
        Definition definition="sales".equals(kind)?sales(group):REPORTS.get(kind);
        if(definition==null) throw bad("Choose a supported report.");
        if(from!=null && to!=null && from.isAfter(to)) throw bad("The report date range is reversed.");
        if(definition.snapshot() && (from!=null || to!=null)) throw bad("Current balances do not support historical date filters.");
        var params=new ArrayList<Object>();
        var filtered=new StringBuilder(" FROM ("+definition.query()+") report WHERE true");
        if(from!=null) { filtered.append(" AND day>=?"); params.add(from); }
        if(to!=null) { filtered.append(" AND day<=?"); params.add(to); }
        if(q!=null && !q.isBlank()) { filtered.append(" AND strpos(lower(label),lower(?))>0"); params.add(q.strip()); }
        String scope=filtered.toString();
        if("sales".equals(kind)) {
            boolean period=Set.of("day","week","month").contains(group);
            scope=" FROM (SELECT "+(period?"label::date":"max(day)")+" AS day,label AS row_id,label,"
                    +"sum(revenue_rwf) AS revenue_rwf,sum(cogs_rwf) AS cogs_rwf,sum(gross_profit_rwf) AS gross_profit_rwf"
                    +scope+" GROUP BY label) grouped";
        }
        long count=db.sql("SELECT count(*)"+scope).params(params).query(Long.class).single();
        if(export && count>EXPORT_LIMIT) throw bad("Narrow the filters to export at most 10,000 rows.");
        Map<String,BigDecimal> totals=new LinkedHashMap<>();
        if(!definition.numeric().isEmpty()) {
            String expressions=String.join(",",definition.numeric().stream().map(k->"coalesce(sum("+k+"),0) AS "+k).toList());
            db.sql("SELECT "+expressions+scope).params(params).query((rs,index)->{
                for(String column:definition.numeric()) totals.put(column,rs.getBigDecimal(column));
                return true;
            }).single();
        }
        var columns=new ArrayList<Column>();
        params.add(export?EXPORT_LIMIT:size);
        params.add(export?0L:(long)page*size);
        var rows=db.sql("SELECT *"+scope+" ORDER BY day DESC,label,row_id LIMIT ? OFFSET ?").params(params)
                .query(rs->{
                    var meta=rs.getMetaData();
                    for(int i=1;i<=meta.getColumnCount();i++) {
                        String key=meta.getColumnLabel(i);
                        if(key.equals("row_id")) continue;
                        boolean numeric=switch(meta.getColumnType(i)) {
                            case java.sql.Types.BIGINT,java.sql.Types.INTEGER,java.sql.Types.NUMERIC -> true;
                            default -> false;
                        };
                        columns.add(new Column(key,key.replace('_',' '),numeric,key.endsWith("_rwf")?"RWF":key.endsWith("_minor")||key.equals("native_amount")?"native minor units":""));
                    }
                    var data=new ArrayList<Map<String,Object>>();
                    while(rs.next()) {
                        Map<String,Object> row=new LinkedHashMap<>();
                        for(var col:columns) {
                            Object value=rs.getObject(col.key());
                            row.put(col.key(),value instanceof java.sql.Date date?date.toLocalDate():value);
                        }
                        data.add(row);
                    }
                    return data;
                });
        return new Report(definition.title(),from,to,q,page,export?EXPORT_LIMIT:size,count,columns,rows,totals,brand());
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    List<Map<String,Object>> salesTrend(LocalDate from,LocalDate to) {
        if(from.isAfter(to) || from.plusYears(2).isBefore(to)) throw bad("Choose a dashboard date range of at most two years.");
        return db.sql("SELECT day,sum(revenue_rwf)::bigint AS revenue_rwf,sum(revenue_rwf-cogs_rwf)::bigint AS gross_profit_rwf FROM ("
                +SALE_EVENTS+") events WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day")
                .params(from,to).query().listOfRows();
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    Report saleReceipt(String id) {
        SaleReceipt receipt=db.sql("""
                SELECT reference,customer_name,sale_date,total_rwf,credit_rwf,refunded_rwf,paid_rwf,outstanding_rwf
                FROM bizflow_foundation.sale_balances WHERE id=?
                """).param(id).query(SaleReceipt.class).optional()
                .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Sale receipt not found."));
        var items=db.sql("""
                SELECT product_name || ' / ' || sku AS label, quantity,unit_price_rwf-unit_discount_rwf AS unit_rwf,
                       revenue_rwf AS amount_rwf
                FROM bizflow_foundation.sale_items WHERE sale_id=? ORDER BY created_at,id
                """).param(id).query().listOfRows();
        List<Map<String,Object>> rows=new ArrayList<>(items);
        rows.add(Map.of("label","Original sale total","amount_rwf",receipt.totalRwf()));
        rows.add(Map.of("label","Returns credited","amount_rwf",receipt.creditRwf()));
        rows.add(Map.of("label","Refunded","amount_rwf",receipt.refundedRwf()));
        rows.add(Map.of("label","Net paid","amount_rwf",receipt.paidRwf()));
        rows.add(Map.of("label","Balance due","amount_rwf",receipt.outstandingRwf()));
        return new Report("Sales receipt — "+receipt.reference(),receipt.saleDate(),receipt.saleDate(),
                receipt.customerName()==null||receipt.customerName().isBlank()?"Walk-in customer":receipt.customerName(),
                0,rows.size(),rows.size(),
                List.of(new Column("label","Description",false,""),new Column("quantity","Quantity",true,""),
                    new Column("unit_rwf","Unit price",true,"RWF"),new Column("amount_rwf","Amount",true,"RWF")),rows,Map.of(),brand());
    }

    private Brand brand() {
        return db.sql("SELECT name,address,phone,receipt_footer FROM bizflow_foundation.business_profile WHERE singleton")
                .query(Brand.class).single();
    }

    private static Definition sales(String group) {
        String label=switch(group) {
            case "day","week","month" -> "date_trunc('"+group+"',day::timestamp)::date::text";
            case "product","category","channel" -> group;
            default -> throw bad("Group sales by day, week, month, product, category or channel.");
        };
        String sql="SELECT day,row_id,"+label+" AS label,revenue_rwf,cogs_rwf,revenue_rwf-cogs_rwf AS gross_profit_rwf FROM ("
                +SALE_EVENTS+") events";
        return new Definition("Sales and gross profit",sql,List.of("revenue_rwf","cogs_rwf","gross_profit_rwf"),false);
    }

    static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
}
