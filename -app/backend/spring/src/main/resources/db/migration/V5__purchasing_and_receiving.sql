SET LOCAL search_path TO bizflow_foundation, pg_catalog;

CREATE TABLE procurement_contacts (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('SUPPLIER','AGENT')),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    phone text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '',
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX procurement_contact_search ON procurement_contacts(kind,lower(name),id);

CREATE TABLE procurement_orders (
    id text PRIMARY KEY,
    supplier_id text NOT NULL REFERENCES procurement_contacts(id),
    supplier_name text NOT NULL,
    reference text NOT NULL UNIQUE,
    invoice_reference text NOT NULL,
    purchase_date date NOT NULL,
    currency text NOT NULL CHECK (currency IN ('RWF','USD','CNY')),
    rate_micros bigint NOT NULL CHECK (rate_micros BETWEEN 1 AND 10000000000 AND (currency <> 'RWF' OR rate_micros=1000000)),
    total_rwf bigint NOT NULL CHECK (total_rwf BETWEEN 0 AND 1000000000000),
    cancelled boolean NOT NULL DEFAULT false,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX procurement_order_date ON procurement_orders(purchase_date DESC,id);
CREATE INDEX procurement_order_supplier ON procurement_orders(supplier_id);

CREATE TABLE procurement_lines (
    id text PRIMARY KEY,
    order_id text NOT NULL REFERENCES procurement_orders(id),
    product_id text NOT NULL REFERENCES catalog_products(id),
    ordered bigint NOT NULL CHECK (ordered BETWEEN 1 AND 1000000),
    unit_minor bigint NOT NULL CHECK (unit_minor BETWEEN 0 AND 1000000000),
    subtotal_rwf bigint NOT NULL CHECK (subtotal_rwf BETWEEN 0 AND 1000000000000)
);
CREATE INDEX procurement_line_order ON procurement_lines(order_id);
CREATE INDEX procurement_line_product ON procurement_lines(product_id);

CREATE TABLE procurement_shipments (
    id text PRIMARY KEY,
    tracking text NOT NULL UNIQUE,
    agent_id text NOT NULL REFERENCES procurement_contacts(id),
    agent_name text NOT NULL,
    planned_date date NOT NULL,
    arrival_date date,
    status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','IN_TRANSIT','RECEIVED','CANCELLED')),
    allocation text CHECK (allocation IN ('QUANTITY','VALUE')),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX procurement_shipment_date ON procurement_shipments(planned_date DESC,id);

CREATE TABLE procurement_manifest_lines (
    shipment_id text NOT NULL REFERENCES procurement_shipments(id),
    line_id text NOT NULL REFERENCES procurement_lines(id),
    planned bigint NOT NULL CHECK (planned BETWEEN 1 AND 1000000),
    PRIMARY KEY (shipment_id,line_id)
);
CREATE INDEX procurement_manifest_line ON procurement_manifest_lines(line_id);

CREATE TABLE procurement_charges (
    shipment_id text NOT NULL REFERENCES procurement_shipments(id),
    kind text NOT NULL CHECK (kind IN ('SHIPPING','CUSTOMS','CLEARING','OTHER')),
    amount_rwf bigint NOT NULL CHECK (amount_rwf BETWEEN 0 AND 1000000000),
    PRIMARY KEY (shipment_id,kind)
);

CREATE TABLE procurement_receipts (
    id text PRIMARY KEY,
    shipment_id text NOT NULL REFERENCES procurement_shipments(id),
    reference text NOT NULL UNIQUE,
    receipt_date date NOT NULL,
    request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id,shipment_id)
);
CREATE INDEX procurement_receipt_shipment ON procurement_receipts(shipment_id,receipt_date,id);

CREATE TABLE procurement_receipt_lines (
    receipt_id text NOT NULL,
    shipment_id text NOT NULL,
    line_id text NOT NULL,
    usable bigint NOT NULL CHECK (usable BETWEEN 0 AND 1000000),
    damaged bigint NOT NULL CHECK (damaged BETWEEN 0 AND 1000000),
    missing bigint NOT NULL CHECK (missing BETWEEN 0 AND 1000000),
    explanation text NOT NULL,
    usable_cost_rwf bigint NOT NULL CHECK (usable_cost_rwf >= 0),
    damage_cost_rwf bigint NOT NULL CHECK (damage_cost_rwf >= 0),
    allocated_rwf bigint NOT NULL CHECK (allocated_rwf >= 0),
    capitalized_rwf bigint NOT NULL CHECK (capitalized_rwf BETWEEN 0 AND allocated_rwf),
    movement_id uuid UNIQUE REFERENCES inventory_movements(id),
    PRIMARY KEY (receipt_id,line_id),
    FOREIGN KEY (receipt_id,shipment_id) REFERENCES procurement_receipts(id,shipment_id),
    FOREIGN KEY (shipment_id,line_id) REFERENCES procurement_manifest_lines(shipment_id,line_id),
    CHECK (usable+damaged+missing BETWEEN 1 AND 1000000),
    CHECK ((usable > 0) = (movement_id IS NOT NULL)),
    CHECK (damaged+missing=0 OR length(btrim(explanation))>0)
);
CREATE INDEX procurement_receipt_purchase_line ON procurement_receipt_lines(line_id);

CREATE TABLE procurement_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    event text NOT NULL,
    entity_id text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE VIEW procurement_manifest_progress AS
SELECT m.*, COALESCE(SUM(r.usable),0)::bigint AS usable, COALESCE(SUM(r.damaged),0)::bigint AS damaged,
       COALESCE(SUM(r.missing),0)::bigint AS missing,
       (m.planned-COALESCE(SUM(r.usable+r.damaged+r.missing),0))::bigint AS outstanding
FROM procurement_manifest_lines m LEFT JOIN procurement_receipt_lines r USING (shipment_id,line_id)
GROUP BY m.shipment_id,m.line_id;

CREATE VIEW procurement_line_progress AS
SELECT l.*,
       COALESCE((SELECT SUM(usable) FROM procurement_receipt_lines r WHERE r.line_id=l.id),0)::bigint AS usable,
       COALESCE((SELECT SUM(damaged) FROM procurement_receipt_lines r WHERE r.line_id=l.id),0)::bigint AS damaged,
       COALESCE((SELECT SUM(missing) FROM procurement_receipt_lines r WHERE r.line_id=l.id),0)::bigint AS missing,
       COALESCE((SELECT SUM(m.outstanding) FROM procurement_manifest_progress m
                 JOIN procurement_shipments s ON s.id=m.shipment_id
                 WHERE m.line_id=l.id AND s.status IN ('PLANNED','IN_TRANSIT')),0)::bigint AS reserved
FROM procurement_lines l;

-- The original constraint name is generated by PostgreSQL from the column check.
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_kind_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check
    CHECK (kind IN ('OPENING','ADJUSTMENT','COUNT','DAMAGE_OUT','MISSING_OUT','REVERSAL','PURCHASE_RECEIPT'));
ALTER TABLE inventory_movements ADD CHECK (kind <> 'PURCHASE_RECEIPT' OR delta>0);
