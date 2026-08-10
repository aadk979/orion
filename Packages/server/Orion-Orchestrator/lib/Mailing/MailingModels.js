/**
 * Data models for the batch mailing plane. Same contract as SystemAdmin/models.js:
 * every model takes anything exposing `query(text, params)`, so tests inject a stub.
 *
 * Writer split (see migrations/0002_batch_mailing.sql):
 *   - Jobs and Assignments: orchestrator only. Control-plane bookkeeping.
 *   - Recipients and Archive: dual-write. The orchestrator seeds and leases;
 *     the sending node retires rows itself. The node-side half lives in
 *     Orion-core's BatchMailerSystem — this file is the orchestrator's half.
 */

import { valueGeneratorExports } from 'r-sync';

const { generateId } = valueGeneratorExports;

/** Rows arrive in batches this size, keeping any one INSERT statement sane. */
const INSERT_CHUNK = 500;

// ── Jobs ─────────────────────────────────────────────────────────────────────

class MailingJobModel {
    constructor(db) {
        this.db = db;
    }

    async create({ id, name, priority = 5, totalRecipients = 0, groupSize = 0, groupCount = 0, plannedNodeCount = 0, sourceFilename = null, submittedBy = null, submittedByEmail = null }) {
        const { rows } = await this.db.query(
            `INSERT INTO orch_mailing_jobs
                (id, name, priority, total_recipients, group_size, group_count, planned_node_count,
                 source_filename, submitted_by, submitted_by_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [id, name, priority, totalRecipients, groupSize, groupCount, plannedNodeCount, sourceFilename, submittedBy, submittedByEmail]
        );
        return rows[0];
    }

    async findById(id) {
        const { rows } = await this.db.query('SELECT * FROM orch_mailing_jobs WHERE id = $1', [id]);
        return rows[0] || null;
    }

    async list({ status = null, limit = 50, offset = 0 } = {}) {
        const { rows } = await this.db.query(
            `SELECT * FROM orch_mailing_jobs
             WHERE ($1::text IS NULL OR status = $1)
             ORDER BY
                -- running first, then the queue in the order it will actually
                -- run, then history newest-first
                CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                CASE WHEN status = 'queued' THEN priority END ASC,
                CASE WHEN status = 'queued' THEN created_at END ASC,
                created_at DESC
             LIMIT $2 OFFSET $3`,
            [status, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0)]
        );
        return rows;
    }

    /** The job currently occupying the cluster, if any. */
    async findRunning() {
        const { rows } = await this.db.query("SELECT * FROM orch_mailing_jobs WHERE status = 'running' LIMIT 1");
        return rows[0] || null;
    }

    /**
     * The queue in the order it will run: most urgent first, oldest first
     * within a priority tier.
     */
    async listQueued() {
        const { rows } = await this.db.query("SELECT * FROM orch_mailing_jobs WHERE status = 'queued' ORDER BY priority ASC, created_at ASC");
        return rows;
    }

    /**
     * Claims the next queued job, atomically.
     *
     * The whole start decision is one statement so two orchestrator processes
     * (or one restarting mid-dispatch) cannot both start a job: the partial
     * unique index on status='running' makes the loser's UPDATE fail rather
     * than quietly produce a second concurrent blast. The cooldown check lives
     * in here too, for the same reason — it is part of "may this job start",
     * not a separate question asked a moment earlier.
     */
    async claimNext() {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_jobs
                SET status = 'running', started_at = now()
              WHERE id = (
                    SELECT id FROM orch_mailing_jobs
                     WHERE status = 'queued'
                     ORDER BY priority ASC, created_at ASC
                     LIMIT 1
                )
                AND NOT EXISTS (SELECT 1 FROM orch_mailing_jobs WHERE status = 'running')
                AND NOT EXISTS (
                    SELECT 1 FROM orch_mailing_jobs
                     WHERE cooldown_until IS NOT NULL AND cooldown_until > now()
                )
             RETURNING *`
        );
        return rows[0] || null;
    }

    /**
     * When the cluster is free to start the next job — null when it is free
     * now. Drives both the dispatch tick and the delay warning in the panel.
     */
    async cooldownRemaining() {
        const { rows } = await this.db.query(
            `SELECT max(cooldown_until) AS until,
                    GREATEST(0, EXTRACT(EPOCH FROM (max(cooldown_until) - now())))::int AS seconds
               FROM orch_mailing_jobs
              WHERE cooldown_until IS NOT NULL AND cooldown_until > now()`
        );
        const row = rows[0];
        return row?.until ? { until: row.until, seconds: row.seconds } : null;
    }

    async setStatus(id, status, { error = null } = {}) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_jobs
                SET status = $2,
                    last_error = COALESCE($3, last_error),
                    completed_at = CASE WHEN $2 IN ('completed', 'cancelled', 'failed') THEN now() ELSE completed_at END
              WHERE id = $1
             RETURNING *`,
            [id, status, error]
        );
        return rows[0] || null;
    }

    /**
     * Terminal transition plus the cooldown that gates the next job. Written
     * together so a job can never be finished without its cooldown being armed.
     */
    async finish(id, status, cooldownSeconds, { error = null } = {}) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_jobs
                SET status = $2,
                    completed_at = now(),
                    last_error = COALESCE($4, last_error),
                    cooldown_until = now() + ($3 || ' seconds')::interval
              WHERE id = $1 AND status IN ('running', 'queued')
             RETURNING *`,
            [id, status, String(Math.max(0, Math.floor(cooldownSeconds))), error]
        );
        return rows[0] || null;
    }

    /**
     * Recomputes the counters from the archive — the archive is the record of
     * what actually happened, so the job row is a cache of it rather than an
     * independent tally that could drift.
     */
    async refreshCounts(id) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_jobs j
                SET sent_count      = c.sent,
                    failed_count    = c.failed,
                    cancelled_count = c.cancelled
               FROM (
                    SELECT count(*) FILTER (WHERE outcome = 'sent')::int      AS sent,
                           count(*) FILTER (WHERE outcome = 'failed')::int    AS failed,
                           count(*) FILTER (WHERE outcome = 'cancelled')::int AS cancelled
                      FROM orch_mailing_archive WHERE job_id = $1
               ) c
              WHERE j.id = $1
             RETURNING j.*`,
            [id]
        );
        return rows[0] || null;
    }

    async exists(id) {
        const { rows } = await this.db.query('SELECT 1 FROM orch_mailing_jobs WHERE id = $1', [id]);
        return rows.length > 0;
    }
}

// ── Recipients (the live queue) ──────────────────────────────────────────────

class MailingRecipientModel {
    constructor(db) {
        this.db = db;
    }

    /**
     * Seeds the queue. Rows carry their group number from the planner, so the
     * grouping decision is made once at submit time and never recomputed —
     * a node asked for "job X group 4" always gets the same 15 people.
     */
    async insertMany(jobId, rows, groupSize) {
        let inserted = 0;

        for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
            const chunk = rows.slice(start, start + INSERT_CHUNK);
            const values = [];
            const params = [];

            chunk.forEach((row, i) => {
                const base = i * 8;
                values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb)`);
                params.push(
                    jobId,
                    Math.floor((start + i) / groupSize) + 1,
                    row.rowNumber,
                    row.recipient,
                    row.subject,
                    row.content,
                    row.contentType || 'text',
                    JSON.stringify(row.fields || {})
                );
            });

            const { rowCount } = await this.db.query(
                `INSERT INTO orch_mailing_recipients
                    (job_id, group_number, row_number, recipient, subject, content, content_type, fields)
                 VALUES ${values.join(', ')}`,
                params
            );
            inserted += rowCount;
        }

        return inserted;
    }

    async countRemaining(jobId) {
        const { rows } = await this.db.query('SELECT count(*)::int AS remaining FROM orch_mailing_recipients WHERE job_id = $1', [jobId]);
        return rows[0]?.remaining ?? 0;
    }

    /**
     * Groups that still hold unsent recipients, with how many and who (if
     * anyone) currently holds the lease. This is the orchestrator's whole view
     * of "what is left to hand out".
     */
    async groupsWithWork(jobId) {
        const { rows } = await this.db.query(
            `SELECT group_number,
                    count(*)::int AS remaining,
                    max(locked_by) AS locked_by
               FROM orch_mailing_recipients
              WHERE job_id = $1
              GROUP BY group_number
              ORDER BY group_number`,
            [jobId]
        );
        return rows.map(r => ({ groupNumber: r.group_number, remaining: r.remaining, lockedBy: r.locked_by }));
    }

    /** Leases a group to a node. The node only ever touches rows carrying its own id. */
    async lockGroup(jobId, groupNumber, workerId) {
        const { rowCount } = await this.db.query(
            `UPDATE orch_mailing_recipients
                SET locked_by = $3, locked_at = now()
              WHERE job_id = $1 AND group_number = $2`,
            [jobId, groupNumber, workerId]
        );
        return rowCount;
    }

    /** Returns a group to the unassigned pool so it can go to a different node. */
    async releaseGroup(jobId, groupNumber) {
        const { rowCount } = await this.db.query(
            `UPDATE orch_mailing_recipients
                SET locked_by = NULL, locked_at = NULL
              WHERE job_id = $1 AND group_number = $2`,
            [jobId, groupNumber]
        );
        return rowCount;
    }

    /**
     * Releases a group ONLY if the named node still holds it.
     *
     * The unscoped release above is correct when the orchestrator is taking a
     * group back. It is wrong when reacting to a message FROM a node, because
     * that message may be stale: a node whose group was reclaimed and handed to
     * someone else can still report on it afterwards, and an unscoped release
     * would then strip the lease from the node now doing the work — which,
     * since a node reads its rows by `locked_by`, would have it see an empty
     * group and report success on mail it never sent.
     */
    async releaseGroupFromWorker(jobId, groupNumber, workerId) {
        const { rowCount } = await this.db.query(
            `UPDATE orch_mailing_recipients
                SET locked_by = NULL, locked_at = NULL
              WHERE job_id = $1 AND group_number = $2 AND locked_by = $3`,
            [jobId, groupNumber, workerId]
        );
        return rowCount;
    }

    /**
     * Releases everything held by a node that has gone away. Called on node
     * loss, which is why it is keyed on the worker rather than on a job.
     */
    async releaseAllForWorker(workerId) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_recipients
                SET locked_by = NULL, locked_at = NULL
              WHERE locked_by = $1
             RETURNING DISTINCT job_id, group_number`,
            [workerId]
        );
        return rows.map(r => ({ jobId: r.job_id, groupNumber: r.group_number }));
    }

    /**
     * Cancellation: the unsent remainder is archived as 'cancelled' and removed
     * in one statement, so the job's history shows exactly who was not reached.
     */
    async archiveAndClearRemaining(jobId, outcome = 'cancelled', archiveTtlDays = 90) {
        const { rows } = await this.db.query(
            `WITH moved AS (
                DELETE FROM orch_mailing_recipients
                 WHERE job_id = $1
                RETURNING job_id, group_number, recipient, subject, attempts, last_error, locked_by
             )
             INSERT INTO orch_mailing_archive
                (job_id, group_number, recipient, subject, outcome, attempts, error, worker_id, expires_at)
             SELECT job_id, group_number, recipient, subject, $2, attempts, last_error, locked_by,
                    now() + ($3 || ' days')::interval
               FROM moved
             RETURNING id`,
            [jobId, outcome, String(Math.max(1, Math.floor(archiveTtlDays)))]
        );
        return rows.length;
    }

    async deleteForJob(jobId) {
        const { rowCount } = await this.db.query('DELETE FROM orch_mailing_recipients WHERE job_id = $1', [jobId]);
        return rowCount;
    }
}

// ── Archive (terminal history) ───────────────────────────────────────────────

class MailingArchiveModel {
    constructor(db) {
        this.db = db;
    }

    async list(jobId, { outcome = null, limit = 100, offset = 0 } = {}) {
        const { rows } = await this.db.query(
            `SELECT * FROM orch_mailing_archive
              WHERE job_id = $1 AND ($2::text IS NULL OR outcome = $2)
              ORDER BY finished_at DESC
              LIMIT $3 OFFSET $4`,
            [jobId, outcome, Math.min(Number(limit) || 100, 500), Math.max(Number(offset) || 0, 0)]
        );
        return rows;
    }

    async counts(jobId) {
        const { rows } = await this.db.query(
            `SELECT outcome, count(*)::int AS count FROM orch_mailing_archive WHERE job_id = $1 GROUP BY outcome`,
            [jobId]
        );
        return rows.reduce((acc, r) => ({ ...acc, [r.outcome]: r.count }), { sent: 0, failed: 0, cancelled: 0 });
    }

    async purgeExpired() {
        const { rowCount } = await this.db.query('DELETE FROM orch_mailing_archive WHERE expires_at IS NOT NULL AND expires_at < now()');
        return rowCount;
    }
}

// ── Assignments (the dispatch ledger) ────────────────────────────────────────

class MailingAssignmentModel {
    constructor(db) {
        this.db = db;
    }

    /**
     * Records a dispatch. The partial unique index on (job_id, group_number)
     * WHERE status IN ('assigned','running') means a double-dispatch of the
     * same group raises rather than silently producing two nodes sending the
     * same mails — ON CONFLICT DO NOTHING would hide exactly the bug worth
     * knowing about.
     */
    async create(jobId, groupNumber, workerId, remainingCount = null) {
        const { rows } = await this.db.query(
            `INSERT INTO orch_mailing_assignments (job_id, group_number, worker_id, remaining_count)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [jobId, groupNumber, workerId, remainingCount]
        );
        return rows[0];
    }

    async findLive(jobId, groupNumber) {
        const { rows } = await this.db.query(
            `SELECT * FROM orch_mailing_assignments
              WHERE job_id = $1 AND group_number = $2 AND status IN ('assigned', 'running')`,
            [jobId, groupNumber]
        );
        return rows[0] || null;
    }

    async listLive(jobId = null) {
        const { rows } = await this.db.query(
            `SELECT * FROM orch_mailing_assignments
              WHERE status IN ('assigned', 'running') AND ($1::text IS NULL OR job_id = $1)
              ORDER BY assigned_at`,
            [jobId]
        );
        return rows;
    }

    async listForJob(jobId) {
        const { rows } = await this.db.query('SELECT * FROM orch_mailing_assignments WHERE job_id = $1 ORDER BY group_number, assigned_at', [jobId]);
        return rows;
    }

    /** Nodes currently holding a live group — used to skip them when handing out work. */
    async busyWorkers() {
        const { rows } = await this.db.query("SELECT DISTINCT worker_id FROM orch_mailing_assignments WHERE status IN ('assigned', 'running')");
        return new Set(rows.map(r => r.worker_id));
    }

    async recordProgress(jobId, groupNumber, workerId, { sent = 0, failed = 0, remaining = null } = {}) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_assignments
                SET status = 'running',
                    sent_count = $4,
                    failed_count = $5,
                    remaining_count = COALESCE($6, remaining_count),
                    last_progress_at = now()
              WHERE job_id = $1 AND group_number = $2 AND worker_id = $3 AND status IN ('assigned', 'running')
             RETURNING *`,
            [jobId, groupNumber, workerId, sent, failed, remaining]
        );
        return rows[0] || null;
    }

    async finish(jobId, groupNumber, workerId, status, { sent = 0, failed = 0, remaining = null, error = null } = {}) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_assignments
                SET status = $4,
                    sent_count = $5,
                    failed_count = $6,
                    remaining_count = COALESCE($7, remaining_count),
                    last_error = $8,
                    last_progress_at = now(),
                    completed_at = now()
              WHERE job_id = $1 AND group_number = $2 AND worker_id = $3 AND status IN ('assigned', 'running')
             RETURNING *`,
            [jobId, groupNumber, workerId, status, sent, failed, remaining, error]
        );
        return rows[0] || null;
    }

    /** Reclaims a live assignment without a node's cooperation (loss, stall, timeout). */
    async release(jobId, groupNumber, reason) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_assignments
                SET status = 'released', last_error = $3, completed_at = now()
              WHERE job_id = $1 AND group_number = $2 AND status IN ('assigned', 'running')
             RETURNING *`,
            [jobId, groupNumber, reason]
        );
        return rows[0] || null;
    }

    async releaseAllForWorker(workerId, reason) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_assignments
                SET status = 'released', last_error = $2, completed_at = now()
              WHERE worker_id = $1 AND status IN ('assigned', 'running')
             RETURNING *`,
            [workerId, reason]
        );
        return rows;
    }

    async cancelAllForJob(jobId, reason) {
        const { rows } = await this.db.query(
            `UPDATE orch_mailing_assignments
                SET status = 'cancelled', last_error = $2, completed_at = now()
              WHERE job_id = $1 AND status IN ('assigned', 'running')
             RETURNING *`,
            [jobId, reason]
        );
        return rows;
    }

    /**
     * Live assignments that have been silent for longer than `seconds` — the
     * watchdog's input. Silence is measured from the last progress report, not
     * from dispatch, so a node that is slowly working through a big group is
     * never mistaken for a dead one.
     */
    async listSilent(seconds) {
        const { rows } = await this.db.query(
            `SELECT *, EXTRACT(EPOCH FROM (now() - last_progress_at))::int AS silent_seconds
               FROM orch_mailing_assignments
              WHERE status IN ('assigned', 'running')
                AND last_progress_at < now() - ($1 || ' seconds')::interval
              ORDER BY last_progress_at`,
            [String(Math.max(1, Math.floor(seconds)))]
        );
        return rows;
    }
}

// ── Orchestrator notifications ───────────────────────────────────────────────

class OrchNotificationModel {
    constructor(db) {
        this.db = db;
    }

    async create({ type, severity = 'info', title, message, details = {}, jobId = null, ttlDays = 30 }) {
        const id = generateId('NTF', 24);
        const { rows } = await this.db.query(
            `INSERT INTO orch_notifications (id, type, severity, title, message, details, job_id, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, now() + ($8 || ' days')::interval)
             RETURNING *`,
            [id, type, severity, title, message, JSON.stringify(details), jobId, String(Math.max(1, Math.floor(ttlDays)))]
        );
        return rows[0];
    }

    /**
     * The feed for one admin, with that admin's read state joined in. Read
     * state is per admin because a notification is a fact about the cluster,
     * not a message addressed to a person — two admins each see it, and each
     * dismisses it for themselves.
     */
    async listFor(adminId, { limit = 50, offset = 0, unreadOnly = false } = {}) {
        const { rows } = await this.db.query(
            `SELECT n.*, (r.read_at IS NOT NULL) AS read, r.read_at
               FROM orch_notifications n
               LEFT JOIN orch_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
              WHERE (n.expires_at IS NULL OR n.expires_at > now())
                AND ($4::bool IS NOT TRUE OR r.read_at IS NULL)
              ORDER BY n.created_at DESC
              LIMIT $2 OFFSET $3`,
            [adminId, Math.min(Number(limit) || 50, 200), Math.max(Number(offset) || 0, 0), unreadOnly === true]
        );
        return rows;
    }

    async unreadCount(adminId) {
        const { rows } = await this.db.query(
            `SELECT count(*)::int AS count
               FROM orch_notifications n
               LEFT JOIN orch_notification_reads r ON r.notification_id = n.id AND r.admin_id = $1
              WHERE (n.expires_at IS NULL OR n.expires_at > now()) AND r.read_at IS NULL`,
            [adminId]
        );
        return rows[0]?.count ?? 0;
    }

    async markRead(notificationId, adminId) {
        await this.db.query(
            `INSERT INTO orch_notification_reads (notification_id, admin_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [notificationId, adminId]
        );
    }

    async markAllRead(adminId) {
        const { rowCount } = await this.db.query(
            `INSERT INTO orch_notification_reads (notification_id, admin_id)
             SELECT n.id, $1 FROM orch_notifications n
              WHERE (n.expires_at IS NULL OR n.expires_at > now())
             ON CONFLICT DO NOTHING`,
            [adminId]
        );
        return rowCount;
    }

    async purgeExpired() {
        const { rowCount } = await this.db.query('DELETE FROM orch_notifications WHERE expires_at IS NOT NULL AND expires_at < now()');
        return rowCount;
    }
}

export { MailingJobModel, MailingRecipientModel, MailingArchiveModel, MailingAssignmentModel, OrchNotificationModel, INSERT_CHUNK };
