-- ============================================================================
-- Orion Alpine — Migration 0001: baseline schema (3NF)
--
-- Conventions:
--   * All timestamps are TIMESTAMPTZ. Models convert to/from unix seconds at
--     the query boundary (floor(EXTRACT(EPOCH ...))::FLOAT8 / to_timestamp()).
--   * Surrogate keys are BIGINT GENERATED ALWAYS AS IDENTITY (never SERIAL).
--   * Every ON DELETE CASCADE FK column is indexed.
--   * Short-lived rows carry an expiry/expires_at column swept by the
--     DatabaseJanitor system; per-flow validity windows remain app-enforced,
--     so GC TTL defaults here are deliberately generous.
--   * This file must stay safe to run against a pre-migration-era database:
--     every statement is IF NOT EXISTS / OR REPLACE. Statements that only
--     apply to legacy shapes live in 0002_legacy_upgrade.sql.
-- ============================================================================

-- ─── updated_at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION orion_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Core User Table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    uid             TEXT PRIMARY KEY,
    email           TEXT NOT NULL
                    CONSTRAINT users_email_length_check CHECK (char_length(email) <= 320),
    password_hash   TEXT,                          -- NULL if sign-up was via passkey/OAuth
    role            TEXT NOT NULL DEFAULT 'USER',  -- free text: custom roles configurable
    disabled        BOOLEAN NOT NULL DEFAULT FALSE,
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness on email lives in 0002 (users_email_lower_key)
-- so legacy databases converge through the same statement.

DROP TRIGGER IF EXISTS trg_users_touch_updated ON users;
CREATE TRIGGER trg_users_touch_updated
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION orion_touch_updated_at();

-- ─── OAuth / Auth Providers ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_providers (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    provider_name   TEXT NOT NULL,                 -- e.g. 'GOOGLE', 'GITHUB'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_uid, provider_name)               -- composite index also serves uid lookups
);

-- ─── Security Flags (1:1 with users) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_security (
    user_uid        TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    two_fa_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    revocation_date TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_user_security_touch_updated ON user_security;
CREATE TRIGGER trg_user_security_touch_updated
    BEFORE UPDATE ON user_security
    FOR EACH ROW EXECUTE FUNCTION orion_touch_updated_at();

-- ─── 2FA Methods ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_two_fa_methods (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_uid ON user_passkeys (user_uid);

-- ─── Passkey Transports ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_passkey_transports (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    passkey_credential_id   TEXT NOT NULL REFERENCES user_passkeys(credential_id) ON DELETE CASCADE,
    transport               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_passkey_transports_cred
    ON user_passkey_transports (passkey_credential_id);

-- ─── TOTP Configuration (1:1 with users) ────────────────────────────────────
-- secret / pending_secret are sealed (AES-256-GCM, 'enc.v1.' prefix) by
-- TOTPModel when utilities.dataEncryption.key is configured.

CREATE TABLE IF NOT EXISTS user_totp (
    user_uid        TEXT PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    secret          TEXT,
    pending_secret  TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_user_totp_touch_updated ON user_totp;
CREATE TRIGGER trg_user_totp_touch_updated
    BEFORE UPDATE ON user_totp
    FOR EACH ROW EXECUTE FUNCTION orion_touch_updated_at();

-- ─── Profile Fields (key-value) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_profile_fields (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    field_key       TEXT NOT NULL,
    field_value     TEXT,
    UNIQUE (user_uid, field_key)
);

-- ─── Custom Data (key-value) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_custom_data (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_uid        TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    data_key        TEXT NOT NULL,
    data_value      TEXT,
    UNIQUE (user_uid, data_key)
);

-- ─── Tokens (access, refresh, resource) ─────────────────────────────────────
-- Single source of truth for issued tokens; the legacy user_active_token_refs
-- mirror was folded into this table (see 0002).

CREATE TABLE IF NOT EXISTS tokens (
    token_id            TEXT PRIMARY KEY,
    user_uid            TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    type                TEXT NOT NULL
                        CONSTRAINT tokens_type_check
                        CHECK (type IN ('ACCESS_TOKEN', 'REFRESH_TOKEN', 'RESOURCE_TOKEN')),
    expiry              TIMESTAMPTZ NOT NULL,
    user_agent          TEXT,
    link_code           TEXT,                       -- accessTokenLinkCode
    security_tier       INTEGER,
    ip_range            TEXT,
    hashed_fingerprint  TEXT,
    view_type           TEXT,                       -- For resource tokens
    max_retrievals      INTEGER
                        CONSTRAINT tokens_max_retrievals_check
                        CHECK (max_retrievals IS NULL OR max_retrievals > 0),
    retrieval_count     INTEGER NOT NULL DEFAULT 0
                        CONSTRAINT tokens_retrieval_count_check
                        CHECK (retrieval_count >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tokens_user_expiry ON tokens (user_uid, expiry);
CREATE INDEX IF NOT EXISTS idx_tokens_expiry ON tokens (expiry);   -- janitor sweep

-- ─── Recognized Devices ─────────────────────────────────────────────────────
-- Single source of truth for trusted devices; the legacy
-- user_recognized_device_refs mirror was folded into this table (see 0002).

CREATE TABLE IF NOT EXISTS recognized_devices (
    device_id           TEXT PRIMARY KEY,
    user_uid            TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    device_code_hash    TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    expiry              TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recognized_devices_user_expiry ON recognized_devices (user_uid, expiry);
CREATE INDEX IF NOT EXISTS idx_recognized_devices_expiry ON recognized_devices (expiry);

-- ─── Device Authorization Requests ──────────────────────────────────────────
-- Pre-auth flow: identified by email, no user FK. expires_at is GC-only —
-- the flow's real validity window is enforced in app code.

CREATE TABLE IF NOT EXISTS device_authorization_requests (
    request_id          TEXT PRIMARY KEY,
    code_hash           TEXT NOT NULL,
    hashed_flow_secret  TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    email               TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

-- ─── OAuth Pending Requests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS oauth_requests (
    request_id          TEXT PRIMARY KEY,
    hashed_flow_secret  TEXT NOT NULL,
    hashed_challenge    TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    provider_name       TEXT NOT NULL,
    nonce               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

-- ─── Step-Up Auth Requests ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS step_up_auth_requests (
    request_id          TEXT PRIMARY KEY,
    code_hash           TEXT NOT NULL,
    hashed_flow_secret  TEXT NOT NULL,
    user_uid            TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    ip_range            TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

CREATE INDEX IF NOT EXISTS idx_step_up_requests_uid ON step_up_auth_requests (user_uid);

-- ─── 2FA Removal Requests ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS two_fa_removal_requests (
    request_id          TEXT PRIMARY KEY,
    code_hash           TEXT NOT NULL,
    fingerprint_hash    TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    user_agent          TEXT NOT NULL,
    email               TEXT NOT NULL,
    user_uid            TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    method              TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_two_fa_removal_requests_uid ON two_fa_removal_requests (user_uid);

-- ─── Password Reset Requests ────────────────────────────────────────────────
-- expiry here is the real, app-supplied validity deadline (not just GC).

CREATE TABLE IF NOT EXISTS password_reset_requests (
    request_id          TEXT PRIMARY KEY,
    email               TEXT NOT NULL,
    user_uid            TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    code_hash           TEXT NOT NULL,
    ip_range            TEXT NOT NULL,
    user_agent_hash     TEXT NOT NULL,
    expiry              TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_uid ON password_reset_requests (user_uid);

-- ─── No-Auth Token Transactions (Captcha) ───────────────────────────────────
-- server_created_at stays a Date.now() millisecond value: NoAuthToken.js
-- compares it arithmetically against CAPTCHA_MAX_AGE_MS.

CREATE TABLE IF NOT EXISTS no_auth_token_transactions (
    transaction_id      TEXT PRIMARY KEY,
    ip_range            TEXT NOT NULL,
    fingerprint         TEXT NOT NULL,
    user_agent          TEXT NOT NULL,
    captcha_code        TEXT NOT NULL,
    captcha_version     TEXT NOT NULL,
    server_created_at   BIGINT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

-- ─── Health Check ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS _orion_health_check (
    id                  TEXT PRIMARY KEY,
    data                TEXT
);
