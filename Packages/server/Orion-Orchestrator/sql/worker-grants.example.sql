-- ═══════════════════════════════════════════════════════════════════════════
-- worker-grants.example.sql — database-level enforcement of the system-admin
-- ownership model.
--
-- The ORCHESTRATOR connects with a read-write role and is the only writer of
-- the orch_* tables. Orion-core WORKERS connect with their own role and may
-- at most READ system-admin data — no INSERT/UPDATE/DELETE, ever. Run this
-- (adjusted to your role names) against the shared database.
-- ═══════════════════════════════════════════════════════════════════════════

-- Roles (adjust names/passwords to your deployment)
-- CREATE ROLE orion_orch  LOGIN PASSWORD '...';
-- CREATE ROLE orion_worker LOGIN PASSWORD '...';

-- Orchestrator: full DML on the admin plane (DDL runs via its migrations)
GRANT SELECT, INSERT, UPDATE, DELETE ON
    orch_system_admins,
    orch_admin_policies,
    orch_admin_groups,
    orch_admin_group_members,
    orch_admin_policy_attachments,
    orch_admin_magic_links,
    orch_admin_sessions
TO orion_orch;

-- The audit table is INSERT/SELECT only even for the orchestrator — the
-- append-only trigger blocks UPDATE/DELETE anyway; the grant removes the
-- temptation entirely.
GRANT SELECT, INSERT ON orch_admin_audit TO orion_orch;
GRANT USAGE ON SEQUENCE orch_admin_audit_id_seq TO orion_orch;

-- Workers: READ ONLY on system-admin data. Secrets never belong on workers —
-- exclude the credential-bearing tables entirely.
GRANT SELECT ON
    orch_system_admins,
    orch_admin_policies,
    orch_admin_groups,
    orch_admin_group_members,
    orch_admin_policy_attachments
TO orion_worker;

-- Explicitly NOT granted to orion_worker:
--   orch_admin_magic_links, orch_admin_sessions  (credential material)
--   orch_admin_audit                             (orchestrator-plane trail)
-- and no write privilege of any kind on any orch_* table.
