SET LOCAL search_path TO bizflow_foundation, pg_catalog;

CREATE TABLE procurement_receipt_corrections (
    receipt_id text PRIMARY KEY REFERENCES procurement_receipts(id),
    reference text NOT NULL UNIQUE,
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE procurement_receipt_correction_moves (
    receipt_id text NOT NULL REFERENCES procurement_receipt_corrections(receipt_id),
    line_id text NOT NULL,
    movement_id uuid NOT NULL UNIQUE REFERENCES inventory_movements(id),
    PRIMARY KEY(receipt_id,line_id),
    FOREIGN KEY(receipt_id,line_id) REFERENCES procurement_receipt_lines(receipt_id,line_id)
);

CREATE VIEW active_procurement_receipt_lines AS
SELECT l.* FROM procurement_receipt_lines l WHERE NOT EXISTS (
    SELECT 1 FROM procurement_receipt_corrections c WHERE c.receipt_id=l.receipt_id);

CREATE VIEW procurement_receipt_history AS
SELECT r.*, EXISTS(SELECT 1 FROM procurement_receipt_corrections c WHERE c.receipt_id=r.id) AS corrected
FROM procurement_receipts r;

CREATE OR REPLACE VIEW procurement_manifest_progress AS
SELECT m.*, COALESCE(SUM(r.usable),0)::bigint AS usable, COALESCE(SUM(r.damaged),0)::bigint AS damaged,
       COALESCE(SUM(r.missing),0)::bigint AS missing,
       (m.planned-COALESCE(SUM(r.usable+r.damaged+r.missing),0))::bigint AS outstanding
FROM procurement_manifest_lines m LEFT JOIN active_procurement_receipt_lines r USING (shipment_id,line_id)
GROUP BY m.shipment_id,m.line_id;

CREATE OR REPLACE VIEW procurement_line_progress AS
SELECT l.*,
       COALESCE((SELECT SUM(usable) FROM active_procurement_receipt_lines r WHERE r.line_id=l.id),0)::bigint AS usable,
       COALESCE((SELECT SUM(damaged) FROM active_procurement_receipt_lines r WHERE r.line_id=l.id),0)::bigint AS damaged,
       COALESCE((SELECT SUM(missing) FROM active_procurement_receipt_lines r WHERE r.line_id=l.id),0)::bigint AS missing,
       COALESCE((SELECT SUM(m.outstanding) FROM procurement_manifest_progress m
                 JOIN procurement_shipments s ON s.id=m.shipment_id
                 WHERE m.line_id=l.id AND s.status IN ('PLANNED','IN_TRANSIT')),0)::bigint AS reserved
FROM procurement_lines l;
