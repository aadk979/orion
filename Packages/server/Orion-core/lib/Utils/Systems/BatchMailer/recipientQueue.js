/**
 * Every statement this node runs against the shared mailing tables.
 *
 * Each one is scoped by `locked_by = this node's worker id`. That is the lease
 * the orchestrator granted, and it is what makes it impossible for this node to
 * touch a row belonging to another node — even if it were handed a group number
 * that was reassigned out from under it.
 *
 * The functions take the BatchMailerSystem rather than a database handle so the
 * lookup of `_query` and `_workerId` stays late-bound: the system is where the
 * database seam lives, and both the shutdown path and the test harness swap
 * them out on the instance.
 */

/**
 * The next slice of this node's leased group, most urgent first.
 *
 * Read in batches rather than all at once: a group is capped in size but a
 * blast is not, and there is no reason to hold thousands of bodies in memory
 * when the send loop consumes them one at a time.
 */
const fetchBatch = async (system, run) => {
    const workerId = system._workerId();
    if (!workerId) throw new Error('This node has no cluster identity — it cannot claim mailing work');

    const { rows } = await system._query(
        `SELECT id, recipient, subject, content, content_type, fields, attempts, priority, row_number
           FROM orch_mailing_recipients
          WHERE job_id = $1 AND group_number = $2 AND locked_by = $3
          ORDER BY priority ASC NULLS LAST, row_number ASC
          LIMIT $4`,
        [run.jobId, run.groupNumber, workerId, system.config.fetchBatchSize]
    );

    return rows;
};

/**
 * What is actually left in this group — deliberately unscoped by `locked_by`,
 * because the number reported upstream is "how much of this group is unsent",
 * not "how much of it is still mine".
 */
const countRemaining = async (system, run) => {
    const { rows } = await system._query('SELECT count(*)::int AS remaining FROM orch_mailing_recipients WHERE job_id = $1 AND group_number = $2', [
        run.jobId,
        run.groupNumber
    ]);
    return rows[0]?.remaining ?? 0;
};

/**
 * Persists an attempt before the backoff sleep. If this node dies mid-wait,
 * whoever picks the group up next continues the budget instead of restarting it.
 */
const recordAttempt = async (system, row, attempts, error) => {
    await system._query('UPDATE orch_mailing_recipients SET attempts = $2, last_error = $3 WHERE id = $1', [row.id, attempts, error?.slice(0, 2000) || null]);
};

/**
 * Retires a recipient: write the delivery record and remove the queue row,
 * atomically.
 *
 * One statement, not a transaction block, so it cannot be interrupted halfway.
 * The two halves must move together — an archive row without the delete would
 * let the address be mailed again, and a delete without the archive would lose
 * the delivery record entirely.
 *
 * The `locked_by` predicate is a fencing token, and it is the reason this is
 * not just `WHERE id = $1`. If the orchestrator concluded this node was gone
 * and gave the group to someone else, this node may still be working through
 * rows it read before losing the lease — and the new holder is working through
 * the same rows. Scoping the delete means the stale node's write matches
 * nothing, which turns a silent duplicate send into a detectable stop.
 *
 * @returns {number} rows retired — 0 means the lease is gone
 */
const archiveAndDelete = async (system, row, outcome, { attempts, error }) => {
    const result = await system._query(
        `WITH removed AS (
            DELETE FROM orch_mailing_recipients WHERE id = $1 AND locked_by = $6
            RETURNING job_id, group_number, recipient, subject, locked_by
         )
         INSERT INTO orch_mailing_archive
            (job_id, group_number, recipient, subject, outcome, attempts, error, worker_id, expires_at)
         SELECT job_id, group_number, recipient, subject, $2, $3, $4, locked_by, now() + ($5 || ' days')::interval
           FROM removed`,
        [row.id, outcome, attempts, error?.slice(0, 2000) || null, String(system.config.archiveTtlDays), system._workerId()]
    );

    return result?.rowCount ?? 0;
};

export { fetchBatch, countRemaining, recordAttempt, archiveAndDelete };
