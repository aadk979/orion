import { logger } from '../../logger.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

import { defaultConfig } from './config.js';
import { GroupRun } from './GroupRun.js';
import { GroupSender } from './GroupSender.js';
import { SlidingRateLimiter } from './SlidingRateLimiter.js';
import { createBulkTransport, hasTransportConfig } from './transport.js';
import { reportProgress, reportGroupDone } from './reporting.js';
import * as queue from './recipientQueue.js';

/**
 * BatchMailerSystem — this node's half of the Orion batch mailing plane.
 *
 * The orchestrator plans a mail blast and hands each node ONE group at a time
 * over the cluster tunnel. Everything after that happens here, locally:
 *
 *   1. read the group's recipients straight from the shared database
 *   2. send each one, inside a strict rate budget
 *   3. archive the delivery record and delete the queue row, in one transaction
 *   4. heartbeat counts upstream while working; report once when the group ends
 *
 * ── Why this node writes to the database at all ─────────────────────────────
 *
 * The obvious alternative — report every send upstream and let the orchestrator
 * do the writes — turns a 200,000-recipient blast into 200,000 control-plane
 * messages, all converging on one process, purely to record work that already
 * happened. Instead the node owns its group outright: the orchestrator leases
 * rows by stamping them with this node's worker id, and this node only ever
 * reads or deletes rows carrying that id. One group in, one report out.
 *
 * ── Where the rest of it lives ──────────────────────────────────────────────
 *
 * This file is the node's outward surface: lifecycle, the three cluster
 * commands, the database seam, and the stats counters. The work itself is
 * elsewhere in this directory —
 *
 *   GroupSender.js       the send loop, retries, dead-lettering
 *   recipientQueue.js    every statement run against the mailing tables
 *   reporting.js         progress and completion reports upstream
 *   SlidingRateLimiter.js  the send budget
 *   failures.js          how an SMTP error is read
 *   tokens.js            <TOKEN> substitution
 *   transport.js         the dedicated bulk SMTP connection
 *   config.js, errors.js, GroupRun.js
 */

const dbModule = new SafeModuleHandler('Database', 'db', 'BatchMailerSystem.js');

class BatchMailerSystem {
    constructor(config = {}) {
        this.config = { ...defaultConfig, ...config, mail: { ...(config.mail || {}) } };
        this.enabled = this.config.enabled === true;

        this.transporter = null;
        this.stopping = false;

        /** key → GroupRun */
        this._active = new Map();
        this._limiter = new SlidingRateLimiter(this.config.ratePerWindow, this.config.rateWindowMs);
        this._progressTimer = null;

        this._stats = {
            groupsAccepted: 0,
            groupsCompleted: 0,
            groupsFailed: 0,
            groupsCancelled: 0,
            mailsSent: 0,
            mailsFailed: 0,
            deadLettered: 0,
            rateLimitWaits: 0
        };
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async start() {
        if (!this.enabled) return false;

        if (!hasTransportConfig(this.config.mail)) {
            // Enabled without credentials would mean accepting groups and then
            // failing every single mail — worse than declining the work.
            this.enabled = false;
            logger.error(
                'BatchMailerSystem: enabled but utilities.batchMailer.mail has no service, host or email — ' +
                    'the batch mailer is staying OFF rather than accepting groups it cannot send'
            );
            return false;
        }

        this.transporter = await createBulkTransport(this.config.mail);

        this._progressTimer = setInterval(() => {
            reportProgress(this).catch(err => logger.warn(`BatchMailerSystem: progress report failed — ${err.message}`));
        }, this.config.progressIntervalMs);
        this._progressTimer.unref?.();

        logger.info(
            `BatchMailerSystem: ready — ${this.config.ratePerWindow} mails per ${Math.round(this.config.rateWindowMs / 1000)}s, ` +
                `${this.config.maxAttempts} attempts per recipient`
        );
        return true;
    }

    /**
     * Shutdown. In-flight groups are asked to stop between recipients and then
     * given a bounded window to report back.
     *
     * The wait matters: a group that stops without reporting is a group the
     * orchestrator has to rediscover through its watchdog, which can take up to
     * a day. A few seconds here turns that into an immediate reassignment. The
     * window is bounded because a shutdown that hangs on mail is worse than a
     * slow reassignment.
     */
    async stop({ drainTimeoutMs = 10_000 } = {}) {
        this.stopping = true;

        for (const run of this._active.values()) {
            run.cancelled = true;
        }

        const deadline = Date.now() + drainTimeoutMs;
        while (this._active.size > 0 && Date.now() < deadline) {
            await this._sleep(250);
        }
        if (this._active.size > 0) {
            logger.warn(`BatchMailerSystem: ${this._active.size} group(s) still finishing at shutdown — the orchestrator will reclaim them`);
        }

        if (this._progressTimer) {
            clearInterval(this._progressTimer);
            this._progressTimer = null;
        }
        if (this.transporter) {
            try {
                this.transporter.close();
            } catch (_) {
                /* pool may already be torn down */
            }
            this.transporter = null;
        }
    }

    // ── Cluster command surface ───────────────────────────────────────────────

    /**
     * mailing:assign — take on one group.
     *
     * Returns as soon as the group is accepted; the sending runs in the
     * background and may take hours. The orchestrator's command channel has a
     * short timeout, and a group that took its whole duration to acknowledge
     * would time out every time.
     */
    acceptGroup(args = {}) {
        const { jobId, jobName, groupNumber, recipientCount, rateLimit, maxAttempts, archiveTtlDays } = args;

        if (!this.enabled) return { accepted: false, reason: 'BATCH_MAILER_DISABLED' };
        if (this.stopping) return { accepted: false, reason: 'NODE_SHUTTING_DOWN' };
        if (!jobId || !Number.isInteger(groupNumber)) return { accepted: false, reason: 'INVALID_ASSIGNMENT' };

        // One group at a time per node is the orchestrator's scheduling
        // assumption — taking a second would double this node's effective send
        // rate and quietly break the rate budget the cluster is relying on.
        if (this._active.size > 0) {
            const [current] = this._active.values();
            return { accepted: false, reason: 'ALREADY_SENDING', busyWith: { jobId: current.jobId, groupNumber: current.groupNumber } };
        }

        // The orchestrator owns these numbers — it knows the fleet size and the
        // provider's limits, this node only knows itself.
        if (rateLimit?.perWindow && rateLimit?.windowMs) {
            this._limiter = new SlidingRateLimiter(rateLimit.perWindow, rateLimit.windowMs);
        }
        if (Number.isInteger(maxAttempts) && maxAttempts > 0) this.config.maxAttempts = maxAttempts;
        if (Number.isInteger(archiveTtlDays) && archiveTtlDays > 0) this.config.archiveTtlDays = archiveTtlDays;

        const run = new GroupRun(jobId, jobName || jobId, groupNumber);
        run.remaining = Number.isInteger(recipientCount) ? recipientCount : null;
        this._active.set(run.key, run);
        this._stats.groupsAccepted += 1;

        logger.info(`BatchMailerSystem: accepted group ${groupNumber} of "${run.jobName}" (${run.remaining ?? '?'} recipients)`);

        // Deliberately not awaited — see above.
        this._runGroup(run).catch(err => logger.error(`BatchMailerSystem: group ${groupNumber} of ${jobId} crashed — ${err.message}`));

        return { accepted: true, jobId, groupNumber, workerId: this._workerId() };
    }

    /** mailing:status — what this node is doing, for the orchestrator's watchdog. */
    getMailingStatus(args = {}) {
        const jobId = args.jobId || null;

        const active = [...this._active.values()]
            .filter(run => !jobId || run.jobId === jobId)
            .map(run => ({
                jobId: run.jobId,
                jobName: run.jobName,
                groupNumber: run.groupNumber,
                sent: run.sent,
                failed: run.failed,
                remaining: run.remaining,
                cancelled: run.cancelled,
                runningForSeconds: Math.round((Date.now() - run.startedAt) / 1000)
            }));

        return { enabled: this.enabled, workerId: this._workerId(), active, stats: this._stats };
    }

    /**
     * mailing:cancel — stop, gracefully.
     *
     * The flag is checked between recipients, never mid-send: a mail already
     * handed to the transport is allowed to finish so it cannot go out with its
     * queue row left behind, which is the one outcome that would produce a
     * duplicate on the next assignment.
     */
    cancelGroup(args = {}) {
        const { jobId, groupNumber } = args;
        if (!jobId) return { cancelled: 0 };

        let cancelled = 0;
        for (const run of this._active.values()) {
            if (run.jobId !== jobId) continue;
            if (Number.isInteger(groupNumber) && run.groupNumber !== groupNumber) continue;
            run.cancelled = true;
            cancelled += 1;
        }

        if (cancelled > 0) logger.warn(`BatchMailerSystem: cancelling ${cancelled} in-flight group(s) of ${jobId} on request`);
        return { cancelled };
    }

    // ── One group, start to finish ────────────────────────────────────────────

    /**
     * Hands the group to a GroupSender and, whatever comes back, closes it out:
     * drop it from the active set, count it, and tell the orchestrator.
     */
    async _runGroup(run) {
        // Defaults for the path GroupSender cannot cover: something threw on its
        // way out. The group still has to be reported, or the orchestrator waits
        // a day for a watchdog to notice.
        let outcome = 'failed';
        let error = null;

        try {
            ({ outcome, error } = await new GroupSender(this, run).drain());
        } catch (err) {
            error = err.message;
            logger.error(`BatchMailerSystem: group ${run.groupNumber} of ${run.jobId} aborted — ${err.message}`);
        } finally {
            this._active.delete(run.key);
        }

        // Whatever happened, the count of what is genuinely left comes from the
        // table, not from this process's bookkeeping.
        run.remaining = await this._countRemaining(run).catch(() => run.remaining);

        this._stats[outcome === 'completed' ? 'groupsCompleted' : outcome === 'cancelled' ? 'groupsCancelled' : 'groupsFailed'] += 1;

        logger.info(
            `BatchMailerSystem: group ${run.groupNumber} of "${run.jobName}" ${outcome} — ` +
                `${run.sent} sent, ${run.failed} undeliverable, ${run.remaining ?? '?'} left`
        );

        await reportGroupDone(this, run, outcome, error);
    }

    // ── Seams ─────────────────────────────────────────────────────────────────
    //
    // The node's four points of contact with the world outside this process.
    // They are methods rather than imports on purpose: the send loop reaches
    // them through the system, so a test (or any instrumentation) can replace
    // one on the instance without the rest of the plane knowing.

    _query(text, params) {
        return dbModule.getModule().query(text, params);
    }

    _workerId() {
        return globalAccessPoint.clusterLinkSystem()?.rsync?.workerId || null;
    }

    _link() {
        return globalAccessPoint.clusterLinkSystem() || null;
    }

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ── The queue ─────────────────────────────────────────────────────────────
    //
    // Thin named entry points onto recipientQueue.js, which holds the SQL and
    // the reasoning behind each statement's `locked_by` scoping.

    _fetchBatch(run) {
        return queue.fetchBatch(this, run);
    }

    _countRemaining(run) {
        return queue.countRemaining(this, run);
    }

    _recordAttempt(row, attempts, error) {
        return queue.recordAttempt(this, row, attempts, error);
    }

    /** @returns {Promise<number>} rows retired — 0 means the lease is gone */
    _archiveAndDelete(row, outcome, meta) {
        return queue.archiveAndDelete(this, row, outcome, meta);
    }

    // ── Observability ─────────────────────────────────────────────────────────

    /** Bumps one of the lifetime counters. The send loop's only write to this object. */
    count(key, by = 1) {
        if (key in this._stats) this._stats[key] += by;
    }

    getStats() {
        return {
            enabled: this.enabled,
            activeGroups: this._active.size,
            ratePerWindow: this._limiter.limit,
            rateWindowMs: this._limiter.windowMs,
            maxAttempts: this.config.maxAttempts,
            ...this._stats
        };
    }
}

export { BatchMailerSystem };
