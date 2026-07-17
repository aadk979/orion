-- ═══════════════════════════════════════════════════════════════════════════
-- 0001_system_admin.sql — System-admin control plane for Orion-Orchestrator
--
-- Ownership model:
--   * The ORCHESTRATOR is the single writer of every orch_* table.
--   * Orion-core workers may be granted SELECT only (see
--     sql/worker-grants.example.sql) — never INSERT/UPDATE/DELETE.
--   * orch_admin_audit is append-only for EVERYONE including the orchestrator:
--     a trigger rejects UPDATE and DELETE at the database level.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── System admins ────────────────────────────────────────────────────────────
-- role 'root': password + TOTP, full governance, bootstrapped from config on
--              first boot. Only root manages admins, policies, and groups.
-- role 'admin': passwordless — magic-link + mandatory TOTP. Governs the
--               cluster strictly within the PBAC policy attached to them.
-- status 'pending': created but MFA enrollment not completed — cannot act.
CREATE TABLE orch_system_admins (
    id                        TEXT PRIMARY KEY,
    email                     TEXT NOT NULL UNIQUE,
    display_name              TEXT,
    role                      TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('root', 'admin')),
    status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
    password_hash             TEXT,
    password_change_required  BOOLEAN NOT NULL DEFAULT FALSE,
    totp_secret               TEXT,
    totp_pending_secret       TEXT,
    totp_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
    created_by                TEXT,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at             TIMESTAMPTZ,
    -- Passwords exist for root only; everyone else is magic-link + TOTP.
    CONSTRAINT password_only_for_root CHECK (role = 'root' OR password_hash IS NULL)
);

-- ── PBAC policies ────────────────────────────────────────────────────────────
-- document is a versioned statement list:
--   { "version": 1, "statements": [
--       { "sid": "...", "effect": "allow"|"deny", "actions": ["cluster:read:*"], "resources": ["*"] } ] }
-- Evaluation: deny-overrides, default deny. managed = built-in, undeletable.
CREATE TABLE orch_admin_policies (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    document    JSONB NOT NULL,
    managed     BOOLEAN NOT NULL DEFAULT FALSE,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Policy groups ────────────────────────────────────────────────────────────
CREATE TABLE orch_admin_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orch_admin_group_members (
    group_id  TEXT NOT NULL REFERENCES orch_admin_groups (id) ON DELETE CASCADE,
    admin_id  TEXT NOT NULL REFERENCES orch_system_admins (id) ON DELETE CASCADE,
    added_by  TEXT,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, admin_id)
);

-- A policy attaches to an admin directly or to a group; an admin's effective
-- policy is the union of both (deny still overrides everywhere).
CREATE TABLE orch_admin_policy_attachments (
    policy_id       TEXT NOT NULL REFERENCES orch_admin_policies (id) ON DELETE CASCADE,
    principal_type  TEXT NOT NULL CHECK (principal_type IN ('admin', 'group')),
    principal_id    TEXT NOT NULL,
    attached_by     TEXT,
    attached_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (policy_id, principal_type, principal_id)
);

CREATE INDEX idx_policy_attachments_principal
    ON orch_admin_policy_attachments (principal_type, principal_id);

-- ── Magic-link tokens ────────────────────────────────────────────────────────
-- Single-use, short-lived, stored as SHA-256 of the raw token.
CREATE TABLE orch_admin_magic_links (
    id            TEXT PRIMARY KEY,
    admin_id      TEXT NOT NULL REFERENCES orch_system_admins (id) ON DELETE CASCADE,
    token_hash    TEXT NOT NULL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL,
    consumed_at   TIMESTAMPTZ,
    requested_ip  TEXT
);

CREATE INDEX idx_magic_links_admin ON orch_admin_magic_links (admin_id);

-- ── Sessions ─────────────────────────────────────────────────────────────────
-- Two-stage: magic link (or root password) yields a 'pending_totp' session
-- that can ONLY talk to the TOTP endpoints; a valid TOTP code upgrades it to
-- 'active'. Tokens stored as SHA-256 of the raw bearer value.
CREATE TABLE orch_admin_sessions (
    id          TEXT PRIMARY KEY,
    admin_id    TEXT NOT NULL REFERENCES orch_system_admins (id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    stage       TEXT NOT NULL DEFAULT 'pending_totp' CHECK (stage IN ('pending_totp', 'active')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    ip          TEXT,
    user_agent  TEXT
);

CREATE INDEX idx_sessions_admin ON orch_admin_sessions (admin_id);

-- ── Immutable orchestrator audit trail ───────────────────────────────────────
-- One row per admin-plane request (and per auth event). Hash-chained
-- (hash = sha256(row-content + prev_hash)) and append-only at the DB level.
CREATE TABLE orch_admin_audit (
    id           BIGSERIAL PRIMARY KEY,
    at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    admin_id     TEXT,
    admin_email  TEXT,
    ip           TEXT,
    method       TEXT,
    path         TEXT,
    action       TEXT NOT NULL,
    resource     TEXT,
    decision     TEXT NOT NULL CHECK (decision IN ('allow', 'deny', 'error')),
    status_code  INTEGER,
    details      JSONB NOT NULL DEFAULT '{}'::jsonb,
    prev_hash    TEXT,
    hash         TEXT NOT NULL
);

CREATE INDEX idx_orch_audit_at ON orch_admin_audit (at);
CREATE INDEX idx_orch_audit_admin ON orch_admin_audit (admin_id);

CREATE FUNCTION orch_admin_audit_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'orch_admin_audit is append-only: % rejected', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orch_admin_audit_immutable
    BEFORE UPDATE OR DELETE ON orch_admin_audit
    FOR EACH ROW EXECUTE FUNCTION orch_admin_audit_immutable();

-- ── Built-in default policy ──────────────────────────────────────────────────
-- Attached by root as the safe default for new admins: observe everything,
-- change nothing.
INSERT INTO orch_admin_policies (id, name, description, document, managed, created_by)
VALUES (
    'POL_DEFAULT_READ_ONLY',
    'default-read-only',
    'Built-in default: full read access to cluster observability and the audit trail; no mutating action.',
    '{"version": 1, "statements": [{"sid": "read-only", "effect": "allow", "actions": ["cluster:read:*", "audit:read"], "resources": ["*"]}]}'::jsonb,
    TRUE,
    'system'
);
