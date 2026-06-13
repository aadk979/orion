-- ============================================================================
-- Orion Alpine — Production PostgreSQL Schema
-- Fully normalized, no JSONB. All fields are proper columns.
-- ============================================================================

-- ─── Core User Table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    uid             TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,                          -- NULL if sign-up was via passkey/OAuth
    role            TEXT NOT NULL DEFAULT 'USER',
    disabled        BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- ─── OAuth / Auth Providers ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_providers (
    id              SERIAL PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    provider_name   TEXT NOT NULL,                 -- e.g. 'GOOGLE', 'GITHUB'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_uid, provider_name)
);

CREATE INDEX IF NOT EXISTS idx_user_providers_uid ON user_providers (user_uid);

-- ─── Security Flags (1:1 with users) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_security (
    user_uid        TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    two_fa_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    revocation_date TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2FA Methods ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_two_fa_methods (
    id              SERIAL PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    method          TEXT NOT NULL,                  -- e.g. 'TOTP', 'EMAIL', 'PASSKEY'
    UNIQUE (user_uid, method)
);

-- ─── Passkey (WebAuthn) Credentials ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_passkeys (
    credential_id   TEXT PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    public_key      BYTEA NOT NULL,
    counter         BIGINT NOT NULL DEFAULT 0,
    device_type     TEXT,
    backed_up       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_uid ON user_passkeys (user_uid);

-- ─── Passkey Transports ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_passkey_transports (
    id                      SERIAL PRIMARY KEY,
    passkey_credential_id   TEXT NOT NULL REFERENCES user_passkeys(credential_id) ON DELETE CASCADE,
    transport               TEXT NOT NULL
);

-- ─── TOTP Configuration (1:1 with users) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_totp (
    user_uid        TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    secret          TEXT,
    pending_secret  TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Lightweight Token References on User ───────────────────────────────────

CREATE TABLE IF NOT EXISTS user_active_token_refs (
    id              SERIAL PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    token_id        TEXT NOT NULL,
    expiry          BIGINT NOT NULL                 -- Unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_token_refs_uid ON user_active_token_refs (user_uid);

-- ─── Lightweight Device References on User ──────────────────────────────────

CREATE TABLE IF NOT EXISTS user_recognized_device_refs (
    id              SERIAL PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    device_id       TEXT NOT NULL,
    expiry          BIGINT NOT NULL                 -- Unix timestamp
);

CREATE INDEX IF NOT EXISTS idx_device_refs_uid ON user_recognized_device_refs (user_uid);

-- ─── Profile Fields (key-value) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profile_fields (
    id              SERIAL PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    field_key       TEXT NOT NULL,
    field_value     TEXT,
    UNIQUE (user_uid, field_key)
);

-- ─── Custom Data (key-value) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_custom_data (
    id              SERIAL PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    data_key        TEXT NOT NULL,
    data_value      TEXT,
    UNIQUE (user_uid, data_key)
);

-- ─── Tokens (access, refresh, resource) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS tokens (
    token_id            TEXT PRIMARY KEY,
    user_uid            TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    type                TEXT NOT NULL,              -- 'ACCESS_TOKEN', 'REFRESH_TOKEN', 'RESOURCE_TOKEN'
    expiry              BIGINT NOT NULL,            -- Unix timestamp
    user_agent          TEXT,
    link_code           TEXT,                       -- accessTokenLinkCode
    security_tier       INTEGER,
    ip_range            TEXT,
    hashed_fingerprint  TEXT,
    view_type           TEXT,                       -- For resource tokens
    max_retrievals      INTEGER,                    -- For resource tokens
    retrieval_count     INTEGER DEFAULT 0,          -- For resource tokens
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_uid ON tokens (user_uid);

-- ─── Recognized Devices ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recognized_devices (
    device_id           TEXT PRIMARY KEY,
    user_uid            TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    device_code_hash    TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    expiry              BIGINT NOT NULL,            -- Unix timestamp
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recognized_devices_uid ON recognized_devices (user_uid);

-- ─── Device Authorization Requests ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS device_authorization_requests (
    request_id          TEXT PRIMARY KEY,
    code_hash           TEXT NOT NULL,
    hashed_flow_secret  TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    email               TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── OAuth Pending Requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_requests (
    request_id          TEXT PRIMARY KEY,
    hashed_flow_secret  TEXT NOT NULL,
    hashed_challenge    TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    provider_name       TEXT NOT NULL,
    nonce               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Step-Up Auth Requests ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS step_up_auth_requests (
    request_id          TEXT PRIMARY KEY,
    code_hash           TEXT NOT NULL,
    hashed_flow_secret  TEXT NOT NULL,
    user_uid            TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2FA Removal Requests ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS two_fa_removal_requests (
    request_id          TEXT PRIMARY KEY,
    code_hash           TEXT NOT NULL,
    fingerprint_hash    TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    user_agent          TEXT NOT NULL,
    email               TEXT NOT NULL,
    user_uid            TEXT NOT NULL,
    method              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Password Reset Requests ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS password_reset_requests (
    request_id          TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    user_uid            TEXT NOT NULL,
    code_hash           TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    expiry              BIGINT NOT NULL,            -- Unix timestamp
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── No-Auth Token Transactions (Captcha) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS no_auth_token_transactions (
    transaction_id      TEXT PRIMARY KEY,
    ip_range            TEXT NOT NULL,
    fingerprint         TEXT NOT NULL,
    user_agent          TEXT NOT NULL,
    captcha_code        TEXT NOT NULL,
    captcha_version     TEXT NOT NULL,
    server_created_at   BIGINT NOT NULL,            -- Date.now() value
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Health Check ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _orion_health_check (
    id                  TEXT PRIMARY KEY,
    data                TEXT
);
