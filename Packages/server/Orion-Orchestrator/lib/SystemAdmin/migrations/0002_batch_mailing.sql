-- ═══════════════════════════════════════════════════════════════════════════
-- 0002_batch_mailing.sql — Batch mailing plane + orchestrator notifications
--
-- Ownership model (DIFFERENT from 0001, deliberately):
--   * The ORCHESTRATOR owns the DDL and is the only writer of orch_mailing_jobs
--     and orch_mailing_assignments — planning, queueing and dispatch are control
--     plane decisions.
--   * orch_mailing_recipients and orch_mailing_archive are DUAL-WRITE. A node
--     that has been assigned a group reads its own rows, and on each successful
--     send archives + deletes that row itself, in one local transaction. This is
--     the whole point of the design: a 200k-recipient blast would otherwise
--     become 200k completion messages across the R_Sync tunnel. Nodes report
--     once per GROUP, not once per mail.
--   * Workers therefore need DML on exactly those two tables and nothing else —
--     see sql/worker-grants.example.sql.
--
-- The invariant that makes dual-write safe: a recipient row is owned by exactly
-- one node at a time. Group assignment is the lease, `locked_by` records it, and
-- a node only ever touches rows carrying its own worker id.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Mailing jobs ─────────────────────────────────────────────────────────────
-- One row per submitted sheet. Exactly one job is `running` cluster-wide at any
-- moment; everything else waits in `queued`, ordered by priority then arrival.
--
-- status
--   queued     — accepted and planned, waiting for its turn
--   running    — groups are assigned to nodes right now
--   completed  — every recipient reached a terminal state (sent or dead-lettered)
--   cancelled  — an admin stopped it; unsent recipients archived as 'cancelled'
--   failed     — planning or dispatch failed irrecoverably
CREATE TABLE orch_mailing_jobs (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'running', 'completed', 'cancelled', 'failed')),
    -- Lower number = more urgent, so ORDER BY priority ASC, created_at ASC is
    -- "most urgent first, oldest first within a tier" in one clause.
    priority            INTEGER NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 9),
    total_recipients    INTEGER NOT NULL DEFAULT 0,
    sent_count          INTEGER NOT NULL DEFAULT 0,
    failed_count        INTEGER NOT NULL DEFAULT 0,
    cancelled_count     INTEGER NOT NULL DEFAULT 0,
    -- Planning snapshot: how the sheet was chunked and against how many nodes.
    group_size          INTEGER NOT NULL DEFAULT 0,
    group_count         INTEGER NOT NULL DEFAULT 0,
    planned_node_count  INTEGER NOT NULL DEFAULT 0,
    source_filename     TEXT,
    submitted_by        TEXT,
    submitted_by_email  TEXT,
    -- Set when the job finishes; the next job may not start until it passes.
    cooldown_until      TIMESTAMPTZ,
    last_error          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ
);

-- The dispatch scan: "the next job to run" and "is anything running".
CREATE INDEX idx_mailing_jobs_queue ON orch_mailing_jobs (status, priority, created_at);

-- At most ONE running job cluster-wide. Enforced in the database rather than in
-- the service, because two orchestrator processes racing (or one restarting
-- mid-dispatch) is exactly when the application-level guard is not holding.
CREATE UNIQUE INDEX idx_mailing_jobs_single_running
    ON orch_mailing_jobs ((status)) WHERE status = 'running';

-- ── Recipients — the live queue (DUAL-WRITE: nodes delete from here) ─────────
-- A row exists here iff the mail has not yet reached a terminal state. "Done"
-- is represented by absence, so "how much of this job is left" is a COUNT and
-- never a scan over completed work.
--
-- `fields` carries every column of the sheet that is not one of the known ones,
-- which is what makes future columns free: they arrive as JSONB and are offered
-- to the node as <TOKEN> substitutions without a migration.
CREATE TABLE orch_mailing_recipients (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id        TEXT NOT NULL REFERENCES orch_mailing_jobs (id) ON DELETE CASCADE,
    group_number  INTEGER NOT NULL,
    row_number    INTEGER NOT NULL,
    recipient     TEXT NOT NULL,
    subject       TEXT NOT NULL,
    content       TEXT NOT NULL,
    content_type  TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN ('text', 'html')),
    priority      INTEGER,
    fields        JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Retry bookkeeping. A row that exhausts the node's attempt ceiling is
    -- archived as 'failed' rather than left here, so the watchdog can never
    -- reassign a poison address forever.
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    -- The lease. Set by the orchestrator when the group is dispatched; a node
    -- only ever reads and deletes rows stamped with its own worker id.
    locked_by     TEXT,
    locked_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The node's working query: my group, in send order.
CREATE INDEX idx_mailing_recipients_group ON orch_mailing_recipients (job_id, group_number, priority, row_number);
-- The orchestrator's planning query: which groups still have work.
CREATE INDEX idx_mailing_recipients_job ON orch_mailing_recipients (job_id);
-- Release-on-node-loss: find everything leased to a node that just went away.
CREATE INDEX idx_mailing_recipients_locked ON orch_mailing_recipients (locked_by) WHERE locked_by IS NOT NULL;

-- ── Archive — terminal history (DUAL-WRITE: nodes insert here) ───────────────
-- Written in the same transaction as the delete above, so a recipient is never
-- in both tables and never in neither. This is the delivery record: who was
-- mailed, by which node, when, and why a failure failed.
--
-- expires_at exists so the DatabaseJanitor can age the archive out on a TTL
-- without special-casing it.
CREATE TABLE orch_mailing_archive (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id        TEXT NOT NULL,
    group_number  INTEGER NOT NULL,
    recipient     TEXT NOT NULL,
    subject       TEXT,
    outcome       TEXT NOT NULL CHECK (outcome IN ('sent', 'failed', 'cancelled')),
    attempts      INTEGER NOT NULL DEFAULT 0,
    error         TEXT,
    worker_id     TEXT,
    finished_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ
);

CREATE INDEX idx_mailing_archive_job ON orch_mailing_archive (job_id, outcome);
CREATE INDEX idx_mailing_archive_expiry ON orch_mailing_archive (expires_at) WHERE expires_at IS NOT NULL;

-- No FK to orch_mailing_jobs on purpose: the archive is the surviving record of
-- what was sent and must outlive a deleted job row rather than cascade with it.

-- ── Assignments — the group → node dispatch ledger ───────────────────────────
-- Orchestrator-owned. This is what the 24h watchdog reads, what reassignment
-- rewrites, and what answers "which node has group 4 right now".
--
-- status
--   assigned   — dispatched, node has acknowledged
--   running    — node has reported progress at least once
--   completed  — node reported the group finished
--   failed     — node reported it gave up (transport down, repeated failures)
--   released   — reclaimed by the orchestrator (node lost, stalled, or timed out)
--   cancelled  — job was cancelled while this group was in flight
CREATE TABLE orch_mailing_assignments (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id            TEXT NOT NULL REFERENCES orch_mailing_jobs (id) ON DELETE CASCADE,
    group_number      INTEGER NOT NULL,
    worker_id         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'assigned'
                      CHECK (status IN ('assigned', 'running', 'completed', 'failed', 'released', 'cancelled')),
    sent_count        INTEGER NOT NULL DEFAULT 0,
    failed_count      INTEGER NOT NULL DEFAULT 0,
    remaining_count   INTEGER,
    last_error        TEXT,
    assigned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Bumped by every progress report. The stall detector reads this; the 24h
    -- watchdog reads it too, which is why it starts life equal to assigned_at.
    last_progress_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

-- A group may be assigned many times over a job's life (reassignment after a
-- node loss), but only ONE of those assignments may be live at a time.
CREATE UNIQUE INDEX idx_mailing_assignments_live
    ON orch_mailing_assignments (job_id, group_number)
    WHERE status IN ('assigned', 'running');

CREATE INDEX idx_mailing_assignments_job ON orch_mailing_assignments (job_id, status);
CREATE INDEX idx_mailing_assignments_worker ON orch_mailing_assignments (worker_id, status);
CREATE INDEX idx_mailing_assignments_progress ON orch_mailing_assignments (last_progress_at) WHERE status IN ('assigned', 'running');

-- ── Orchestrator notifications ──────────────────────────────────────────────
-- General-purpose control-plane notifications surfaced in the orch panel. The
-- batch mailing plane is the first producer (queue delays, completions,
-- dead-letters, watchdog reassignments) but nothing here is mailing-specific.
--
-- Read state is per admin, so a notification is a fact about the cluster rather
-- than a message addressed to one person.
CREATE TABLE orch_notifications (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    details     JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Optional correlation to a mailing job, so the panel can deep-link.
    job_id      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ
);

CREATE INDEX idx_orch_notifications_created ON orch_notifications (created_at DESC);
CREATE INDEX idx_orch_notifications_expiry ON orch_notifications (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE orch_notification_reads (
    notification_id  TEXT NOT NULL REFERENCES orch_notifications (id) ON DELETE CASCADE,
    admin_id         TEXT NOT NULL REFERENCES orch_system_admins (id) ON DELETE CASCADE,
    read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, admin_id)
);

CREATE INDEX idx_orch_notification_reads_admin ON orch_notification_reads (admin_id);
