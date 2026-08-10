-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 — Key vault envelope encryption, and the Orion notifications plane
--
--   1. orion_encryption_keys — the data encryption key (DEK) ledger. Orion
--      generates a DEK, stores it WRAPPED by a key encryption key that lives in
--      a vault (AWS KMS, Cloud KMS, Azure Key Vault, Vault/OpenBao transit, …),
--      and seals field values with the DEK. Replaces the previous model where a
--      single symmetric key in orion.config.js was the whole story: that key
--      could not be revoked, rotated or audited, and in a cluster it had to be
--      copied onto every node.
--
--   2. orion_notifications / orion_notification_receipts — in-product delivery
--      of account-security facts (e.g. "your authenticator is unavailable",
--      "2FA was reset, re-enroll"). Email is the wrong instrument at fleet
--      scale and is unavailable during exactly the incidents that need
--      announcing. Receipts are materialized lazily, so a broadcast to a
--      million accounts is one INSERT.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Data encryption key ledger ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orion_encryption_keys (
    version       INTEGER PRIMARY KEY,
    -- The DEK, encrypted by the vault. Opaque: an AWS ciphertext blob, a
    -- `vault:v3:…` string, an Azure base64url value. Only the provider parses it.
    wrapped_key   TEXT        NOT NULL,
    -- Which provider produced it. A mismatch against the running config is
    -- reported precisely rather than as a generic decrypt failure, because the
    -- fix is entirely different.
    provider      TEXT        NOT NULL,
    key_ref       TEXT        NOT NULL,
    -- Provider-side key version, where the provider exposes one (Azure needs it
    -- to unwrap; KMS and transit carry it inside the blob).
    kek_version   TEXT,
    algorithm     TEXT        NOT NULL,
    -- 'active' (used for new writes) | 'retired' (kept so older envelopes stay
    -- readable — a rotation must never strand data).
    state         TEXT        NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at    TIMESTAMPTZ,
    rewrapped_at  TIMESTAMPTZ
);

-- Exactly one active DEK per database. This is what makes concurrent cluster
-- boots safe: the loser of the race sees the winner's row and adopts it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orion_encryption_keys_active
    ON orion_encryption_keys (state) WHERE state = 'active';

COMMENT ON TABLE orion_encryption_keys IS
    'Wrapped data encryption keys. Contains no usable key material on its own — every row is ciphertext under a vault-held KEK.';

-- ─── 2. Notifications ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orion_notifications (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Stable key for system announcements, so every node in a cluster raising
    -- the same condition collapses into ONE notification instead of one per node.
    notification_key TEXT,
    -- NULL = addressed to an audience rather than to one account.
    user_uid         TEXT REFERENCES users(uid) ON DELETE CASCADE,
    -- 'all' | 'totp-enrolled'. Evaluated when a receipt is materialized, so it
    -- reflects live state rather than a snapshot taken at announce time.
    audience         TEXT        NOT NULL DEFAULT 'all',
    -- 'info' | 'important' | 'urgent'
    severity         TEXT        NOT NULL DEFAULT 'info',
    title            TEXT        NOT NULL,
    body             TEXT        NOT NULL,
    action_label     TEXT,
    action_url       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orion_notifications_key
    ON orion_notifications (notification_key) WHERE notification_key IS NOT NULL AND user_uid IS NULL;

CREATE INDEX IF NOT EXISTS idx_orion_notifications_user ON orion_notifications (user_uid);
CREATE INDEX IF NOT EXISTS idx_orion_notifications_expires ON orion_notifications (expires_at);

CREATE TABLE IF NOT EXISTS orion_notification_receipts (
    notification_id BIGINT      NOT NULL REFERENCES orion_notifications(id) ON DELETE CASCADE,
    user_uid        TEXT        NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    -- 'pending' (never displayed) | 'shown' (displayed, unacknowledged)
    -- | 'viewed' (acknowledged — stops being offered)
    state           TEXT        NOT NULL DEFAULT 'pending',
    -- Server-side clock for the 24h re-prompt. Deliberately NOT client-reported:
    -- a browser must not be able to suppress a security notice by lying about
    -- the time or clearing its storage.
    shown_at        TIMESTAMPTZ,
    viewed_at       TIMESTAMPTZ,
    PRIMARY KEY (notification_id, user_uid)
);

CREATE INDEX IF NOT EXISTS idx_orion_notification_receipts_user
    ON orion_notification_receipts (user_uid, state);

COMMENT ON TABLE orion_notification_receipts IS
    'Per-user delivery state. Rows appear lazily on first check, so broadcasts cost one row in orion_notifications rather than one per account.';
