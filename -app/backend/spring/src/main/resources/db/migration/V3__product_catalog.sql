CREATE TABLE bizflow_foundation.catalog_families (
    id text PRIMARY KEY,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX catalog_families_name_unique ON bizflow_foundation.catalog_families (lower(name));

CREATE TABLE bizflow_foundation.catalog_products (
    id text PRIMARY KEY,
    sku text NOT NULL CHECK (length(btrim(sku)) BETWEEN 1 AND 100),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 100),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
    supplier_label text NOT NULL DEFAULT '' CHECK (length(supplier_label) <= 200),
    family_id text REFERENCES bizflow_foundation.catalog_families (id),
    variant_size text NOT NULL DEFAULT '' CHECK (length(variant_size) <= 100),
    variant_color text NOT NULL DEFAULT '' CHECK (length(variant_color) <= 100),
    variant_material text NOT NULL DEFAULT '' CHECK (length(variant_material) <= 100),
    variant_design text NOT NULL DEFAULT '' CHECK (length(variant_design) <= 100),
    selling_price bigint NOT NULL CHECK (selling_price BETWEEN 0 AND 1000000000),
    estimated_unit_cost bigint NOT NULL CHECK (estimated_unit_cost BETWEEN 0 AND 1000000000),
    reorder_threshold integer NOT NULL CHECK (reorder_threshold BETWEEN 0 AND 1000000),
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX catalog_products_sku_unique ON bizflow_foundation.catalog_products (lower(sku));
CREATE INDEX catalog_products_family ON bizflow_foundation.catalog_products (family_id);
CREATE INDEX catalog_products_category ON bizflow_foundation.catalog_products (lower(category));
CREATE INDEX catalog_products_active_name ON bizflow_foundation.catalog_products (lower(name), id) WHERE archived_at IS NULL;
CREATE INDEX catalog_products_created ON bizflow_foundation.catalog_products (created_at DESC, id);

CREATE TABLE bizflow_foundation.catalog_images (
    product_id text PRIMARY KEY REFERENCES bizflow_foundation.catalog_products (id),
    content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    contents bytea NOT NULL CHECK (octet_length(contents) BETWEEN 1 AND 2097152)
);

CREATE TABLE bizflow_foundation.catalog_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id text NOT NULL REFERENCES bizflow_foundation.owner_accounts (id),
    product_id text REFERENCES bizflow_foundation.catalog_products (id),
    family_id text REFERENCES bizflow_foundation.catalog_families (id),
    action text NOT NULL CHECK (action IN ('created', 'updated', 'archived', 'family_link_changed', 'image_saved')),
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((product_id IS NULL) <> (family_id IS NULL))
);
CREATE INDEX catalog_audit_product ON bizflow_foundation.catalog_audit (product_id);
CREATE INDEX catalog_audit_family ON bizflow_foundation.catalog_audit (family_id);
