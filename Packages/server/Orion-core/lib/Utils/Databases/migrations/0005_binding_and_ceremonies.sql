-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 — Ceremony state, login throttling, and proof-of-possession binding
--
--   1. webauthn_ceremonies — server-side WebAuthn challenge state. The
--      challenge previously round-tripped through a client-held cookie and was
--      read back as the expected value, so it was never single-use and the uid
--      it named was caller-supplied. (PASSKEY-001)
--
--   2. Login throttling columns — per-account exponential backoff. Deliberately
--      NOT a lockout: locking on failures alone lets anyone who knows an email
--      deny service to its owner. (SIGNIN-001)
--
--   3. dpop_jkt on tokens — the confirmation thumbprint a token is bound to,
--      so a stolen token is unusable without the private key that never leaves
--      the browser. (TIER-001)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. WebAuthn ceremony state ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webauthn_ceremonies (
    ceremony_id   TEXT PRIMARY KEY,
    -- Which user this ceremony was issued FOR. Authoritative: it is what the
    -- credential lookup keys on, replacing a uid the caller used to supply.
    user_uid      TEXT,
    -- Sign-up ceremonies precede the account, so they carry an email instead.
    email         TEXT,
    -- 'registration' | 'authentication' | 'sign-up' | 'step-up'.
    -- Prevents a ceremony issued for one purpose being completed as another.
    type          TEXT NOT NULL,
    challenge     TEXT NOT NULL,
    -- Opaque per-type scratch state (e.g. the pending credential id).
    metadata      JSONB,
    consumed_at   TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webauthn_ceremonies_expires ON webauthn_ceremonies (expires_at);

COMMENT ON TABLE webauthn_ceremonies IS
    'Single-use WebAuthn challenge state. Consumed atomically on verification; the cookie carries only an opaque ceremony_id.';

-- ─── 2. Per-account login throttling ─────────────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS failed_login_count        INTEGER     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failed_login_window_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS login_throttled_until     TIMESTAMPTZ;

COMMENT ON COLUMN users.login_throttled_until IS
    'Backoff deadline after repeated failures. A CORRECT credential is still accepted while throttled — it is escalated to step-up instead, so this can never be used to lock an owner out of their own account.';

-- ─── 3. Proof-of-possession binding ──────────────────────────────────────────
-- JWK SHA-256 thumbprint (RFC 7638) of the key a token is bound to. NULL means
-- an unbound token, which stays valid so binding can be rolled out without
-- invalidating every live session.
ALTER TABLE tokens
    ADD COLUMN IF NOT EXISTS dpop_jkt TEXT;

COMMENT ON COLUMN tokens.dpop_jkt IS
    'RFC 7638 thumbprint of the DPoP key this token is bound to. NULL = unbound (pre-rollout token).';
