SET LOCAL search_path TO bizflow_foundation, pg_catalog;
ALTER TABLE sale_items ADD COLUMN category_snapshot text;
ALTER TABLE owner_sessions ADD COLUMN refresh_hash text UNIQUE CHECK (refresh_hash ~ '^[a-f0-9]{64}$');
