CREATE TABLE bizflow_foundation.inventory_balances (
    product_id text PRIMARY KEY REFERENCES bizflow_foundation.catalog_products (id),
    quantity bigint NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 1000000000),
    value_rwf bigint NOT NULL DEFAULT 0 CHECK (value_rwf BETWEEN 0 AND 9007199254740991),
    version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (quantity > 0 OR value_rwf = 0)
);

CREATE TABLE bizflow_foundation.inventory_movements (
    id uuid PRIMARY KEY,
    product_id text NOT NULL REFERENCES bizflow_foundation.inventory_balances (product_id),
    kind text NOT NULL CHECK (kind IN ('OPENING','ADJUSTMENT','COUNT','DAMAGE_OUT','MISSING_OUT','REVERSAL')),
    reference text NOT NULL UNIQUE CHECK (length(btrim(reference)) BETWEEN 1 AND 150),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    actor_id text NOT NULL REFERENCES bizflow_foundation.owner_accounts (id),
    delta bigint NOT NULL CHECK (delta <> 0 AND delta BETWEEN -1000000000 AND 1000000000),
    before_quantity bigint NOT NULL CHECK (before_quantity BETWEEN 0 AND 1000000000),
    after_quantity bigint NOT NULL CHECK (after_quantity BETWEEN 0 AND 1000000000),
    value_delta_rwf bigint NOT NULL CHECK (value_delta_rwf BETWEEN -9007199254740991 AND 9007199254740991),
    before_value_rwf bigint NOT NULL CHECK (before_value_rwf BETWEEN 0 AND 9007199254740991),
    after_value_rwf bigint NOT NULL CHECK (after_value_rwf BETWEEN 0 AND 9007199254740991),
    balance_version bigint NOT NULL CHECK (balance_version > 0),
    reverses_id uuid UNIQUE,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (id, product_id),
    UNIQUE (product_id, balance_version),
    FOREIGN KEY (reverses_id, product_id) REFERENCES bizflow_foundation.inventory_movements (id, product_id),
    CHECK (after_quantity = before_quantity + delta),
    CHECK (after_value_rwf = before_value_rwf + value_delta_rwf),
    CHECK (before_quantity > 0 OR before_value_rwf = 0),
    CHECK (after_quantity > 0 OR after_value_rwf = 0),
    CHECK ((kind = 'REVERSAL') = (reverses_id IS NOT NULL)),
    CHECK (id IS DISTINCT FROM reverses_id),
    CHECK (kind NOT IN ('DAMAGE_OUT','MISSING_OUT') OR delta < 0),
    CHECK (kind <> 'OPENING' OR (delta > 0 AND before_quantity = 0 AND balance_version = 1)),
    CHECK ((delta > 0 AND value_delta_rwf >= 0) OR (delta < 0 AND value_delta_rwf <= 0))
);
CREATE UNIQUE INDEX inventory_opening_per_product ON bizflow_foundation.inventory_movements (product_id) WHERE kind = 'OPENING';
CREATE INDEX inventory_movements_date ON bizflow_foundation.inventory_movements (recorded_at DESC, id);
CREATE INDEX inventory_movements_product_date ON bizflow_foundation.inventory_movements (product_id, recorded_at DESC, id);

CREATE TABLE bizflow_foundation.inventory_counts (
    id uuid PRIMARY KEY,
    product_id text NOT NULL REFERENCES bizflow_foundation.inventory_balances (product_id),
    reference text NOT NULL UNIQUE CHECK (length(btrim(reference)) BETWEEN 1 AND 150),
    expected_quantity bigint NOT NULL CHECK (expected_quantity BETWEEN 0 AND 1000000000),
    observed_quantity bigint NOT NULL CHECK (observed_quantity BETWEEN 0 AND 1000000000),
    difference bigint GENERATED ALWAYS AS (observed_quantity - expected_quantity) STORED,
    expected_version bigint NOT NULL CHECK (expected_version >= 0),
    reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
    counted_by text NOT NULL REFERENCES bizflow_foundation.owner_accounts (id),
    counted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    confirmed_by text REFERENCES bizflow_foundation.owner_accounts (id),
    confirmed_at timestamptz,
    movement_id uuid UNIQUE,
    FOREIGN KEY (movement_id, product_id) REFERENCES bizflow_foundation.inventory_movements (id, product_id),
    CHECK ((confirmed_at IS NULL) = (confirmed_by IS NULL)),
    CHECK ((movement_id IS NOT NULL) = (confirmed_at IS NOT NULL AND expected_quantity <> observed_quantity))
);
CREATE INDEX inventory_counts_date ON bizflow_foundation.inventory_counts (counted_at DESC, id);
CREATE INDEX inventory_counts_product_date ON bizflow_foundation.inventory_counts (product_id, counted_at DESC, id);

CREATE FUNCTION bizflow_foundation.prevent_inventory_movement_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Inventory movements are append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER inventory_movements_append_only
BEFORE UPDATE OR DELETE ON bizflow_foundation.inventory_movements
FOR EACH ROW EXECUTE FUNCTION bizflow_foundation.prevent_inventory_movement_mutation();
