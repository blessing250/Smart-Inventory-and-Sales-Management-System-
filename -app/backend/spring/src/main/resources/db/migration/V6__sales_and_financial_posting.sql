SET LOCAL search_path TO bizflow_foundation, pg_catalog;

ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_kind_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
    CHECK (kind IN ('OPENING','ADJUSTMENT','COUNT','DAMAGE_OUT','MISSING_OUT','REVERSAL','PURCHASE_RECEIPT','SALE','SALE_RETURN'));
ALTER TABLE inventory_movements ADD CHECK ((kind <> 'SALE' OR delta < 0) AND (kind <> 'SALE_RETURN' OR delta > 0));

CREATE TABLE customers (
    id text PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    phone text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE financial_accounts (
    id text PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    kind text NOT NULL CHECK (kind IN ('CASH','BANK','MOBILE_MONEY')),
    currency text NOT NULL DEFAULT 'RWF' CHECK (currency IN ('RWF','USD','CNY')),
    active boolean NOT NULL DEFAULT true,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX financial_accounts_name ON financial_accounts(lower(name));

CREATE TABLE financial_postings (
    id text PRIMARY KEY,
    reference text NOT NULL UNIQUE,
    kind text NOT NULL CHECK (kind IN ('OPENING','CUSTOMER_PAYMENT','CUSTOMER_REFUND','REVERSAL')),
    from_account text REFERENCES financial_accounts(id),
    to_account text REFERENCES financial_accounts(id),
    amount_rwf bigint NOT NULL CHECK (amount_rwf BETWEEN 1 AND 1000000000000),
    reverses_id text UNIQUE REFERENCES financial_postings(id),
    reason text NOT NULL DEFAULT '',
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((from_account IS NOT NULL OR to_account IS NOT NULL) AND
           (from_account IS NULL OR to_account IS NULL OR from_account <> to_account)),
    CHECK ((reverses_id IS NOT NULL) = (kind = 'REVERSAL')),
    CHECK (kind <> 'REVERSAL' OR length(btrim(reason)) BETWEEN 1 AND 1000),
    CHECK ((kind NOT IN ('OPENING','CUSTOMER_PAYMENT') OR (from_account IS NULL AND to_account IS NOT NULL))
           AND (kind <> 'CUSTOMER_REFUND' OR (from_account IS NOT NULL AND to_account IS NULL)))
);
CREATE INDEX financial_postings_from ON financial_postings(from_account);
CREATE INDEX financial_postings_to ON financial_postings(to_account);

CREATE VIEW financial_account_balances AS
SELECT a.*, COALESCE((SELECT sum(p.amount_rwf) FROM financial_postings p WHERE p.to_account=a.id),0)::bigint
             - COALESCE((SELECT sum(p.amount_rwf) FROM financial_postings p WHERE p.from_account=a.id),0)::bigint AS balance_rwf
FROM financial_accounts a;

CREATE TABLE retail_sales (
    id text PRIMARY KEY,
    reference text NOT NULL UNIQUE,
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    customer_id text REFERENCES customers(id),
    customer_name text,
    sale_date date NOT NULL,
    channel text NOT NULL CHECK (length(btrim(channel)) BETWEEN 1 AND 100),
    gross_rwf bigint NOT NULL CHECK (gross_rwf BETWEEN 0 AND 1000000000000),
    discount_rwf bigint NOT NULL CHECK (discount_rwf BETWEEN 0 AND gross_rwf),
    total_rwf bigint NOT NULL CHECK (total_rwf=gross_rwf-discount_rwf),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX sales_dates ON retail_sales(sale_date DESC,created_at DESC,id);
CREATE INDEX sales_customer ON retail_sales(customer_id,sale_date DESC);

CREATE TABLE sale_items (
    id text PRIMARY KEY,
    sale_id text NOT NULL REFERENCES retail_sales(id),
    product_id text NOT NULL REFERENCES catalog_products(id),
    product_name text NOT NULL,
    sku text NOT NULL,
    quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
    unit_price_rwf bigint NOT NULL CHECK (unit_price_rwf BETWEEN 0 AND 1000000000),
    unit_discount_rwf bigint NOT NULL CHECK (unit_discount_rwf BETWEEN 0 AND unit_price_rwf),
    revenue_rwf bigint NOT NULL CHECK (revenue_rwf=quantity*(unit_price_rwf-unit_discount_rwf)),
    cost_rwf bigint NOT NULL CHECK (cost_rwf>=0),
    movement_id uuid NOT NULL UNIQUE REFERENCES inventory_movements(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id,sale_id)
);
CREATE INDEX sale_items_sale ON sale_items(sale_id);

CREATE TABLE sale_payments (
    id text PRIMARY KEY,
    sale_id text NOT NULL REFERENCES retail_sales(id),
    reference text NOT NULL UNIQUE,
    method text NOT NULL CHECK (method IN ('CASH','BANK','MOBILE_MONEY')),
    posting_id text NOT NULL UNIQUE REFERENCES financial_postings(id)
);
CREATE INDEX sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE sale_returns (
    id text PRIMARY KEY,
    sale_id text NOT NULL REFERENCES retail_sales(id),
    item_id text NOT NULL,
    reference text NOT NULL UNIQUE,
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
    condition text NOT NULL CHECK (condition IN ('USABLE','DAMAGED')),
    revenue_credit_rwf bigint NOT NULL CHECK (revenue_credit_rwf>=0),
    restored_cost_rwf bigint NOT NULL CHECK (restored_cost_rwf>=0),
    refund_posting_id text UNIQUE REFERENCES financial_postings(id),
    movement_id uuid UNIQUE REFERENCES inventory_movements(id),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (item_id,sale_id) REFERENCES sale_items(id,sale_id),
    CHECK ((condition='USABLE') = (movement_id IS NOT NULL)),
    CHECK (condition='USABLE' OR restored_cost_rwf=0)
);
CREATE INDEX sale_returns_sale ON sale_returns(sale_id);
CREATE INDEX sale_returns_item ON sale_returns(item_id);

CREATE TABLE online_orders (
    id text PRIMARY KEY,
    reference text NOT NULL UNIQUE,
    customer_id text NOT NULL REFERENCES customers(id),
    customer_name text NOT NULL,
    contact text NOT NULL,
    source text NOT NULL,
    status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','CANCELLED')),
    fulfillment text NOT NULL DEFAULT 'PENDING' CHECK (fulfillment IN ('PENDING','READY','DELIVERED','COLLECTED')),
    sale_id text UNIQUE REFERENCES retail_sales(id),
    confirmation_hash text CHECK (confirmation_hash ~ '^[a-f0-9]{64}$'),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((status='CONFIRMED') = (sale_id IS NOT NULL)),
    CHECK ((status='CONFIRMED') = (confirmation_hash IS NOT NULL))
);

CREATE TABLE online_order_items (
    order_id text NOT NULL REFERENCES online_orders(id),
    product_id text NOT NULL REFERENCES catalog_products(id),
    product_name text NOT NULL,
    quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
    quote_rwf bigint NOT NULL CHECK (quote_rwf BETWEEN 0 AND 1000000000),
    PRIMARY KEY (order_id,product_id)
);

CREATE TABLE sales_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event text NOT NULL,
    entity_id text NOT NULL,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE VIEW sale_balances AS
SELECT calculated.*,
       total_rwf-credit_rwf-paid_rwf AS outstanding_rwf,
       total_rwf-credit_rwf-cost_rwf+restored_rwf AS gross_profit_rwf,
       CASE WHEN units=returned_units THEN 'RETURNED'
            WHEN total_rwf-credit_rwf=paid_rwf THEN 'PAID'
            WHEN paid_rwf=0 THEN 'UNPAID' ELSE 'PARTIAL' END AS status
FROM (
    SELECT s.*, i.units, i.cost_rwf, r.credit_rwf, r.restored_rwf, r.returned_units, r.refunded_rwf,
           p.received_rwf, p.reversed_rwf, p.received_rwf-p.reversed_rwf-r.refunded_rwf AS paid_rwf
    FROM retail_sales s
    CROSS JOIN LATERAL (
        SELECT coalesce(sum(quantity),0)::bigint AS units, coalesce(sum(cost_rwf),0)::bigint AS cost_rwf
        FROM sale_items WHERE sale_id=s.id
    ) i
    CROSS JOIN LATERAL (
        SELECT coalesce(sum(p.amount_rwf),0)::bigint AS received_rwf, coalesce(sum(rev.amount_rwf),0)::bigint AS reversed_rwf
        FROM sale_payments sp JOIN financial_postings p ON p.id=sp.posting_id
        LEFT JOIN financial_postings rev ON rev.reverses_id=p.id WHERE sp.sale_id=s.id
    ) p
    CROSS JOIN LATERAL (
        SELECT coalesce(sum(revenue_credit_rwf),0)::bigint AS credit_rwf, coalesce(sum(restored_cost_rwf),0)::bigint AS restored_rwf,
               coalesce(sum(quantity),0)::bigint AS returned_units, coalesce(sum(f.amount_rwf),0)::bigint AS refunded_rwf
        FROM sale_returns r LEFT JOIN financial_postings f ON f.id=r.refund_posting_id WHERE r.sale_id=s.id
    ) r
) calculated;
