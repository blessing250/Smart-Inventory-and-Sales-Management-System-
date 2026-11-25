SET LOCAL search_path TO bizflow_foundation, pg_catalog;

CREATE TABLE catalog_imports (
    reference text PRIMARY KEY,
    request_hash text NOT NULL,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    result jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE business_profile (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    name text NOT NULL,
    address text NOT NULL DEFAULT '',
    phone text NOT NULL DEFAULT '',
    receipt_footer text NOT NULL DEFAULT '',
    updated_by text REFERENCES owner_accounts(id),
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO business_profile(name) VALUES ('BizFlow Jewelry');
CREATE TABLE business_profile_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    previous jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE legacy_audit_events (
    source_id text PRIMARY KEY,
    actor_id text NOT NULL REFERENCES owner_accounts(id),
    action text NOT NULL,
    entity_id text NOT NULL,
    recorded_at timestamptz NOT NULL
);
