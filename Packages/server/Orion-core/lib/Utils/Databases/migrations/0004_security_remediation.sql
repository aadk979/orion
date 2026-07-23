-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 — Security remediation
--
-- Adds the persistent state three classes of fix need:
--
--   1. sessions_valid_from  — a single "everything issued before this instant is
--      dead" watermark per user. Lets password change, role change, disable and
--      delete invalidate live sessions in one comparison, and — unlike deleting
--      token rows — it also covers stateless tier-1 tokens, which have no rows
--      to delete. (SESS-001, AUTHZ-001, TOKEN-003)
--
--   2. provider_subject     — the OAuth provider's stable subject id. Identity
--      must be keyed on (provider, subject), never on the email string the
--      provider asserted. (OAUTH-001)
--
--   3. attempts / max_attempts on every challenge record — password reset,
--      step-up, device authorization and 2FA removal all shipped a 6-digit code
--      with no attempt ceiling and no consumption on failure.
--      (RESET-001, STEPUP-001, DEVAUTH-001, TWOFA-001)
--
--   4. consumed_token_ids   — refresh-token reuse detection. A rotated refresh
--      token is now deleted; presenting it again is a compromise signal, and
--      that can only be distinguished from "never existed" if we remember it.
--      (TOKEN-001)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Session invalidation watermark ───────────────────────────────────────
-- Defaults to epoch so every pre-existing session stays valid across the
-- upgrade; only an explicit security event moves it forward.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS sessions_valid_from TIMESTAMPTZ NOT NULL DEFAULT to_timestamp(0);

COMMENT ON COLUMN users.sessions_valid_from IS
    'Tokens issued (iat) before this instant are rejected. Bumped on password change, role change, disable, and 2FA removal.';

-- ─── 2. OAuth provider subject binding ───────────────────────────────────────
-- Nullable: rows created before this migration have no recorded subject. The
-- application treats NULL as "unbound" and adopts the subject on the next
-- successful sign-in by that provider, rather than guessing retroactively.
ALTER TABLE user_providers
    ADD COLUMN IF NOT EXISTS provider_subject TEXT;

COMMENT ON COLUMN user_providers.provider_subject IS
    'Stable provider-side subject id (OIDC sub / provider user id). Identity is keyed on (provider_name, provider_subject), never on email.';

-- One provider account maps to at most one local account. Partial index so the
-- pre-migration NULL rows do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS user_providers_subject_key
    ON user_providers (provider_name, provider_subject)
    WHERE provider_subject IS NOT NULL;

-- ─── 3. Challenge attempt ceilings ───────────────────────────────────────────
ALTER TABLE password_reset_requests
    ADD COLUMN IF NOT EXISTS attempts     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

ALTER TABLE step_up_auth_requests
    ADD COLUMN IF NOT EXISTS attempts     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

ALTER TABLE device_authorization_requests
    ADD COLUMN IF NOT EXISTS attempts     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

ALTER TABLE two_fa_removal_requests
    ADD COLUMN IF NOT EXISTS attempts     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

-- ─── 4. Refresh-token reuse detection ────────────────────────────────────────
-- A rotated refresh token's id is remembered until slightly past its natural
-- expiry. Presenting a remembered id means the token was captured and replayed
-- after the legitimate holder rotated it — the whole session family is revoked.
CREATE TABLE IF NOT EXISTS consumed_refresh_tokens (
    token_id    TEXT PRIMARY KEY,
    user_uid    TEXT NOT NULL,
    link_code   TEXT,
    consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Sweep index for the DatabaseJanitor.
CREATE INDEX IF NOT EXISTS idx_consumed_refresh_expires
    ON consumed_refresh_tokens (expires_at);
