SET LOCAL search_path TO bizflow_foundation, pg_catalog;

ALTER TABLE financial_postings DROP CONSTRAINT financial_postings_kind_check;
ALTER TABLE financial_postings ADD CONSTRAINT financial_postings_kind_check
    CHECK (kind IN ('OPENING','CUSTOMER_PAYMENT','CUSTOMER_REFUND','REVERSAL','OPERATING_EXPENSE',
                    'SUPPLIER_PAYMENT','SHIPMENT_PAYMENT','TRANSFER','CLAIM_CASH'));
ALTER TABLE financial_postings ADD COLUMN business_date date;
ALTER TABLE financial_postings ADD COLUMN request_hash text CHECK (request_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE financial_postings ADD CHECK (
    (kind NOT IN ('OPERATING_EXPENSE','SUPPLIER_PAYMENT','SHIPMENT_PAYMENT') OR (from_account IS NOT NULL AND to_account IS NULL))
    AND (kind <> 'TRANSFER' OR (from_account IS NOT NULL AND to_account IS NOT NULL))
    AND (kind <> 'CLAIM_CASH' OR (from_account IS NULL AND to_account IS NOT NULL)));
CREATE INDEX financial_postings_dates ON financial_postings((coalesce(business_date,(recorded_at AT TIME ZONE 'Africa/Kigali')::date)),recorded_at DESC,id);

CREATE TABLE expense_categories (
    id text PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    active boolean NOT NULL DEFAULT true,
    actor_id text REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX expense_category_names ON expense_categories(lower(name));
INSERT INTO expense_categories(id,name) VALUES ('rent','Rent'),('electricity','Electricity'),('water','Water'),
    ('transport','Transport'),('packaging','Packaging'),('internet','Internet and Airtime'),('advertising','Advertising'),
    ('maintenance','Maintenance'),('office','Office Supplies'),('bank','Bank Charges'),('other','Other Operating Expenses');

CREATE TABLE operating_expenses (
    posting_id text PRIMARY KEY REFERENCES financial_postings(id),
    category_id text NOT NULL REFERENCES expense_categories(id),
    category_name text NOT NULL,
    description text NOT NULL,
    payee text NOT NULL,
    receipt_reference text NOT NULL,
    related_reference text NOT NULL
);
CREATE INDEX operating_expenses_category ON operating_expenses(category_id);
CREATE TABLE operating_expense_receipts (
    id text PRIMARY KEY,
    posting_id text NOT NULL REFERENCES operating_expenses(posting_id),
    filename text NOT NULL,
    media_type text NOT NULL CHECK (media_type IN ('application/pdf','image/png','image/jpeg','image/webp')),
    contents bytea NOT NULL CHECK (octet_length(contents) BETWEEN 1 AND 2097152),
    digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(posting_id,digest)
);

CREATE TABLE supplier_payment_allocations (
    posting_id text NOT NULL REFERENCES financial_postings(id),
    purchase_id text NOT NULL REFERENCES procurement_orders(id),
    cash_rwf bigint NOT NULL CHECK (cash_rwf > 0),
    released_rwf bigint NOT NULL CHECK (released_rwf > 0),
    payable_minor bigint NOT NULL CHECK (payable_minor > 0),
    PRIMARY KEY(posting_id,purchase_id)
);
CREATE INDEX supplier_allocations_purchase ON supplier_payment_allocations(purchase_id);
CREATE TABLE shipment_payment_allocations (
    posting_id text PRIMARY KEY REFERENCES financial_postings(id),
    shipment_id text NOT NULL,
    charge_kind text NOT NULL,
    FOREIGN KEY(shipment_id,charge_kind) REFERENCES procurement_charges(shipment_id,kind)
);
CREATE INDEX shipment_allocations_charge ON shipment_payment_allocations(shipment_id,charge_kind);

CREATE TABLE discrepancy_claims (
    id text PRIMARY KEY,
    receipt_id text NOT NULL,
    line_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('DAMAGE','SHORTAGE')),
    reference text NOT NULL UNIQUE,
    claimant text NOT NULL,
    notes text NOT NULL,
    claimed_rwf bigint NOT NULL CHECK (claimed_rwf > 0),
    accepted_rwf bigint CHECK (accepted_rwf BETWEEN 0 AND claimed_rwf),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    decided_by text REFERENCES owner_accounts(id),
    decided_at timestamptz,
    decision_notes text,
    CHECK ((accepted_rwf IS NULL) = (decided_by IS NULL) AND (accepted_rwf IS NULL) = (decided_at IS NULL)),
    FOREIGN KEY(receipt_id,line_id) REFERENCES procurement_receipt_lines(receipt_id,line_id),
    UNIQUE(receipt_id,line_id,kind)
);

CREATE TABLE discrepancy_resolutions (
    id text PRIMARY KEY,
    receipt_id text NOT NULL,
    line_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('DAMAGE','SHORTAGE')),
    action text NOT NULL CHECK (action IN ('CREDIT','CASH','LOSS')),
    reference text NOT NULL UNIQUE,
    claim_id text REFERENCES discrepancy_claims(id),
    posting_id text UNIQUE REFERENCES financial_postings(id),
    amount_rwf bigint NOT NULL CHECK (amount_rwf > 0),
    payable_minor bigint CHECK (payable_minor > 0),
    business_date date NOT NULL,
    notes text NOT NULL,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((action='CASH')=(posting_id IS NOT NULL) AND (action='CREDIT')=(payable_minor IS NOT NULL)),
    CHECK (action='LOSS' OR claim_id IS NOT NULL),
    FOREIGN KEY(receipt_id,line_id) REFERENCES procurement_receipt_lines(receipt_id,line_id)
);
CREATE INDEX discrepancy_resolutions_line ON discrepancy_resolutions(receipt_id,line_id,kind);
CREATE INDEX discrepancy_resolutions_purchase ON discrepancy_resolutions(line_id) WHERE action='CREDIT';
CREATE VIEW supplier_obligations AS
SELECT o.id AS purchase_id,o.supplier_id,o.currency,o.total_rwf,
       n.original_minor,paid.cash_rwf,paid.released_rwf,credits.credit_rwf,
       o.total_rwf-paid.released_rwf-credits.credit_rwf AS outstanding_rwf,
       n.original_minor-paid.paid_minor-credits.credit_minor AS outstanding_minor
FROM procurement_orders o
CROSS JOIN LATERAL (SELECT coalesce(sum(unit_minor*ordered),0)::bigint AS original_minor FROM procurement_lines WHERE order_id=o.id) n
CROSS JOIN LATERAL (
    SELECT coalesce(sum(a.cash_rwf),0)::bigint AS cash_rwf,coalesce(sum(a.released_rwf),0)::bigint AS released_rwf,
           coalesce(sum(a.payable_minor),0)::bigint AS paid_minor
    FROM supplier_payment_allocations a WHERE a.purchase_id=o.id AND NOT EXISTS
        (SELECT 1 FROM financial_postings r WHERE r.reverses_id=a.posting_id)
) paid
CROSS JOIN LATERAL (
    SELECT coalesce(sum(d.amount_rwf),0)::bigint AS credit_rwf,coalesce(sum(d.payable_minor),0)::bigint AS credit_minor
    FROM discrepancy_resolutions d JOIN procurement_lines l ON l.id=d.line_id WHERE l.order_id=o.id AND d.action='CREDIT'
) credits WHERE NOT o.cancelled;

CREATE VIEW shipment_charge_finance AS
SELECT c.shipment_id,c.kind,c.amount_rwf,paid.paid_rwf,c.amount_rwf-paid.paid_rwf AS outstanding_rwf
FROM procurement_charges c
CROSS JOIN LATERAL (
    SELECT coalesce(sum(p.amount_rwf),0)::bigint AS paid_rwf
    FROM shipment_payment_allocations a JOIN financial_postings p ON p.id=a.posting_id
    WHERE a.shipment_id=c.shipment_id AND a.charge_kind=c.kind
      AND NOT EXISTS (SELECT 1 FROM financial_postings r WHERE r.reverses_id=p.id)
) paid;

CREATE TABLE finance_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event text NOT NULL,
    entity_id text NOT NULL,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE sale_returns DROP CONSTRAINT sale_returns_condition_check;
ALTER TABLE sale_returns ADD CHECK (condition IN ('USABLE','DAMAGED','ARCHIVED_HELD'));

CREATE FUNCTION reject_financial_posting_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Financial postings are append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER financial_postings_append_only BEFORE UPDATE OR DELETE ON financial_postings
FOR EACH ROW EXECUTE FUNCTION reject_financial_posting_mutation();
