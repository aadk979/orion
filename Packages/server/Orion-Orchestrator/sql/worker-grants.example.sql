-- ═══════════════════════════════════════════════════════════════════════════
-- worker-grants.example.sql — database-level enforcement of the orch_* table
-- ownership model.
--
-- Two planes with deliberately different rules. Run this (adjusted to your role
-- names) against the shared database.
--
--   SYSTEM-ADMIN PLANE (orch_admin_*, orch_system_admins)
--     The orchestrator is the only writer. Workers may at most READ, and never
--     see credential material at all.
--
--   BATCH MAILING PLANE (orch_mailing_*)
--     Dual-write. The orchestrator plans, queues and dispatches; an assigned
--     node archives and deletes its own recipient rows as it sends them. The
--     alternative — every node reporting each individual send upstream — turns
--     a large blast into a sustained flood of control-plane traffic, so the
--     write is pushed down to where the work happens. Nodes get DML on exactly
--     two tables, and touch only rows leased to their own worker id.
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

-- Orchestrator: full DML on the mailing plane and notifications.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    orch_mailing_jobs,
    orch_mailing_recipients,
    orch_mailing_archive,
    orch_mailing_assignments,
    orch_notifications,
    orch_notification_reads
TO orion_orch;

-- Workers: READ ONLY on system-admin data. Secrets never belong on workers —
-- exclude the credential-bearing tables entirely.
GRANT SELECT ON
    orch_system_admins,
    orch_admin_policies,
    orch_admin_groups,
    orch_admin_group_members,
    orch_admin_policy_attachments
TO orion_worker;

-- ── Batch mailing: the one place workers write ──────────────────────────────
-- A node needs exactly three verbs to run a group:
--   SELECT on recipients        — read the group it was leased
--   UPDATE on recipients        — record a failed attempt before retrying
--   DELETE on recipients        — retire the row once the mail is terminal
--   INSERT on archive           — write the delivery record in the same txn
--
-- Notably NOT granted: UPDATE or DELETE on the archive (the delivery record is
-- write-once from a node's perspective), and any write at all on
-- orch_mailing_jobs / orch_mailing_assignments — a node reports its group
-- outcome over the cluster tunnel and never edits the control plane's own
-- bookkeeping.
-- (No sequence grant needed: orch_mailing_archive.id is GENERATED ALWAYS AS
-- IDENTITY, whose backing sequence is driven by the server, not by the caller.
-- orch_admin_audit above is BIGSERIAL, which is why that one does need it.)
GRANT SELECT, UPDATE, DELETE ON orch_mailing_recipients TO orion_worker;
GRANT SELECT, INSERT ON orch_mailing_archive TO orion_worker;

-- Read-only visibility so a node can confirm the job it was handed is still the
-- running one before it starts sending.
GRANT SELECT ON orch_mailing_jobs TO orion_worker;

-- Explicitly NOT granted to orion_worker:
--   orch_admin_magic_links, orch_admin_sessions  (credential material)
--   orch_admin_audit                             (orchestrator-plane trail)
--   orch_notifications, orch_notification_reads  (operator-facing control plane)
--   any write on orch_mailing_jobs / orch_mailing_assignments
-- and no write privilege of any kind on any orch_admin_* table.
