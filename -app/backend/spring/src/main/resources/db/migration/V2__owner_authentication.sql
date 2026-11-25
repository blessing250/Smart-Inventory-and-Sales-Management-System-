CREATE TABLE bizflow_foundation.owner_accounts (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    id text UNIQUE NOT NULL,
    email text NOT NULL CHECK (email = lower(btrim(email))),
    display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
    password_hash text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    recovery_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    password_changed_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX owner_accounts_email ON bizflow_foundation.owner_accounts (email);

CREATE TABLE bizflow_foundation.owner_sessions (
    id uuid PRIMARY KEY,
    owner_id text NOT NULL REFERENCES bizflow_foundation.owner_accounts (id),
    issued_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL CHECK (expires_at > issued_at),
    revoked_at timestamptz
);
CREATE INDEX owner_sessions_owner ON bizflow_foundation.owner_sessions (owner_id) WHERE revoked_at IS NULL;

CREATE TABLE bizflow_foundation.owner_password_resets (
    owner_id text PRIMARY KEY REFERENCES bizflow_foundation.owner_accounts (id),
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    requested_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at timestamptz NOT NULL CHECK (expires_at > requested_at),
    consumed_at timestamptz
);

CREATE TABLE bizflow_foundation.security_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id text REFERENCES bizflow_foundation.owner_accounts (id),
    event text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
