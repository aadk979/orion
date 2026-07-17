-- ============================================================================
-- Orion Alpine — Migration 0002: converge pre-migration-era databases
--
-- Databases bootstrapped by the old schema.sql replay (before the versioned
-- migration runner existed) have tables 0001 could not reshape, because 0001
-- only runs CREATE TABLE IF NOT EXISTS. This migration brings that legacy
-- shape up to the 0001 contract. On a fresh database every statement here is
-- a no-op. Everything is guarded/idempotent.
--
-- Legacy deltas handled:
--   1. user_active_token_refs / user_recognized_device_refs mirrors dropped —
--      tokens / recognized_devices are the single source of truth now.
--   2. expiry columns: BIGINT unix seconds → TIMESTAMPTZ.
--   3. Request tables gain GC expires_at columns.
--   4. Missing FKs (request tables → users) added, orphans purged first.
--   5. Email uniqueness becomes case-insensitive.
--   6. int4 SERIAL surrogate keys widened to BIGINT.
--   7. tokens gains its CHECK constraints.
-- ============================================================================

-- ─── 1. Drop redundant mirror tables ─────────────────────────────────────────

DROP TABLE IF EXISTS user_active_token_refs;
DROP TABLE IF EXISTS user_recognized_device_refs;

-- ─── 2. expiry BIGINT → TIMESTAMPTZ ──────────────────────────────────────────

DO $$
BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'tokens' AND column_name = 'expiry') = 'bigint' THEN
        ALTER TABLE tokens ALTER COLUMN expiry TYPE TIMESTAMPTZ USING to_timestamp(expiry);
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'recognized_devices' AND column_name = 'expiry') = 'bigint' THEN
        ALTER TABLE recognized_devices ALTER COLUMN expiry TYPE TIMESTAMPTZ USING to_timestamp(expiry);
    END IF;

    IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'password_reset_requests' AND column_name = 'expiry') = 'bigint' THEN
        ALTER TABLE password_reset_requests ALTER COLUMN expiry TYPE TIMESTAMPTZ USING to_timestamp(expiry);
    END IF;
END $$;

-- ─── 3. GC expires_at columns on request tables ──────────────────────────────

ALTER TABLE device_authorization_requests
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour');
ALTER TABLE oauth_requests
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour');
ALTER TABLE step_up_auth_requests
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour');
ALTER TABLE two_fa_removal_requests
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours');
ALTER TABLE no_auth_token_transactions
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour');

-- Janitor sweep indexes (created here because the columns may not exist
-- until this migration runs on legacy databases).
CREATE INDEX IF NOT EXISTS idx_device_auth_requests_expires ON device_authorization_requests (expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_requests_expires ON oauth_requests (expires_at);
CREATE INDEX IF NOT EXISTS idx_step_up_requests_expires ON step_up_auth_requests (expires_at);
CREATE INDEX IF NOT EXISTS idx_two_fa_removal_requests_expires ON two_fa_removal_requests (expires_at);
CREATE INDEX IF NOT EXISTS idx_no_auth_transactions_expires ON no_auth_token_transactions (expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_expiry ON password_reset_requests (expiry);

-- ─── 4. Referential integrity for request tables ─────────────────────────────
-- Purge orphans first so the FK add cannot fail.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'step_up_auth_requests_user_uid_fkey') THEN
        DELETE FROM step_up_auth_requests WHERE user_uid NOT IN (SELECT uid FROM users);
        ALTER TABLE step_up_auth_requests
            ADD CONSTRAINT step_up_auth_requests_user_uid_fkey
            FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'two_fa_removal_requests_user_uid_fkey') THEN
        DELETE FROM two_fa_removal_requests WHERE user_uid NOT IN (SELECT uid FROM users);
        ALTER TABLE two_fa_removal_requests
            ADD CONSTRAINT two_fa_removal_requests_user_uid_fkey
            FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'password_reset_requests_user_uid_fkey') THEN
        DELETE FROM password_reset_requests WHERE user_uid NOT IN (SELECT uid FROM users);
        ALTER TABLE password_reset_requests
            ADD CONSTRAINT password_reset_requests_user_uid_fkey
            FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_step_up_requests_uid ON step_up_auth_requests (user_uid);
CREATE INDEX IF NOT EXISTS idx_two_fa_removal_requests_uid ON two_fa_removal_requests (user_uid);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_uid ON password_reset_requests (user_uid);

-- ─── 5. Case-insensitive email uniqueness ────────────────────────────────────
-- Fails loudly if a legacy database already holds case-duplicate emails —
-- that is a data-integrity error that must be resolved by hand, not hidden.

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
DROP INDEX IF EXISTS idx_users_email;

-- ─── 6. Widen legacy int4 SERIAL keys to BIGINT ──────────────────────────────

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['user_providers', 'user_two_fa_methods', 'user_passkey_transports',
                             'user_profile_fields', 'user_custom_data'] LOOP
        IF (SELECT data_type FROM information_schema.columns
            WHERE table_name = t AND column_name = 'id') = 'integer' THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN id TYPE BIGINT', t);
        END IF;
    END LOOP;
END $$;

-- ─── 7. tokens CHECK constraints on legacy tables ────────────────────────────
-- Safe: only ACCESS_TOKEN / REFRESH_TOKEN / RESOURCE_TOKEN have ever been
-- written (TokenManagement/*.js are the sole writers).

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tokens_type_check') THEN
        ALTER TABLE tokens ADD CONSTRAINT tokens_type_check
            CHECK (type IN ('ACCESS_TOKEN', 'REFRESH_TOKEN', 'RESOURCE_TOKEN'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tokens_max_retrievals_check') THEN
        ALTER TABLE tokens ADD CONSTRAINT tokens_max_retrievals_check
            CHECK (max_retrievals IS NULL OR max_retrievals > 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tokens_retrieval_count_check') THEN
        UPDATE tokens SET retrieval_count = 0 WHERE retrieval_count IS NULL;
        ALTER TABLE tokens ALTER COLUMN retrieval_count SET DEFAULT 0;
        ALTER TABLE tokens ALTER COLUMN retrieval_count SET NOT NULL;
        ALTER TABLE tokens ADD CONSTRAINT tokens_retrieval_count_check
            CHECK (retrieval_count >= 0);
    END IF;
END $$;
