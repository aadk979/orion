import { logger } from 'r-sync';

import { MailingJobModel, MailingRecipientModel, MailingArchiveModel, MailingAssignmentModel, OrchNotificationModel } from './MailingModels.js';
import { defaultConfig, PURGE_INTERVAL_MS, resolveConfig } from './MailingConfig.js';
import { MailingError } from './MailingErrors.js';
import { MailingNotifications } from './MailingNotifications.js';
import { recoverAfterRestart, liveNodeIds } from './leases.js';
import { submitJob } from './JobSubmission.js';
import { dispatchTick } from './Dispatcher.js';
import { handleProgress, handleGroupDone, handleNodeLost } from './NodeReports.js';
import { watchdogTick } from './MailingWatchdog.js';
import { completeJob, cancelJob } from './JobCompletion.js';
import { listJobs, listDeadLetters, getJobDetail, getQueueState } from './MailingReads.js';

/**
 * BatchMailingService — the orchestrator half of the batch mailing plane.
 *
 * ── The shape of a job ──────────────────────────────────────────────────────
 *
 * A sheet is parsed, planned into groups, and written to the database as a
 * queued job. Exactly ONE job runs cluster-wide at a time; the rest wait, most
 * urgent first and oldest first within a tier. When a job finishes, a cooldown
 * runs before the next one starts.
 *
 * While a job runs, this service hands each idle live node one group. A node
 * that reports its group finished immediately gets the next one, so with more
 * groups than nodes the fleet keeps cycling until the queue table is empty.
 *
 * ── Why the orchestrator does so little during a send ───────────────────────
 *
 * It does not touch a single mail. The recipients live in the shared database;
 * a node reads its leased group, sends, and retires each row itself. This
 * service only ever deals in GROUPS — assign one, hear back about one. That is
 * what keeps a 200,000-recipient blast from becoming 200,000 control-plane
 * messages, and it means the count of what is left is a COUNT(*) rather than a
 * tally this process has to keep correct across restarts.
 *
 * ── This file, and the rest of the directory ────────────────────────────────
 *
 * This class is the plane's wiring and its public surface: it owns the models,
 * the config and the three timers, and every method below is a named entry
 * point into one of the modules that does the work. The modules take the
 * service rather than a database handle, so a caller can swap any model for a
 * stub and the whole plane follows.
 *
 *   JobSubmission.js     a sheet becomes a queued job
 *   Dispatcher.js        the scheduler: start a job, hand out groups
 *   NodeReports.js       progress, group-done, node-lost
 *   MailingWatchdog.js   stall detection and the 24h recovery sweep
 *   JobCompletion.js     finishing and cancelling, plus the submitter's summary
 *   MailingReads.js      the panel and CLI views
 *   leases.js            who holds which group, and how it is taken back
 *   MailingModels.js     every SQL statement
 *   GroupPlanner.js      how many groups, and how big
 *   SheetParser.js       the upload
 */
class BatchMailingService {
    /**
     * @param {object} db          AdminDatabase (anything with query(text, params))
     * @param {object} orch        OrionOrchestrator — for live nodes and command dispatch
     * @param {object} config      see MailingConfig.js
     * @param {object} [deps]      { mailer } — AdminMailer, for completion summaries
     */
    constructor(db, orch, config = {}, deps = {}) {
        this.db = db;
        this.orch = orch;
        this.config = resolveConfig(config);
        this.mailer = deps.mailer || null;

        this.jobs = new MailingJobModel(db);
        this.recipients = new MailingRecipientModel(db);
        this.archive = new MailingArchiveModel(db);
        this.assignments = new MailingAssignmentModel(db);
        this.notifications = new OrchNotificationModel(db);

        this._dispatchTimer = null;
        this._watchdogTimer = null;
        this._purgeTimer = null;
        // Neither loop may overlap itself: two dispatch passes racing would hand
        // the same group to two nodes. The flags live here because several
        // paths kick a pass off opportunistically.
        this._dispatching = false;
        this._watchdogRunning = false;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    start() {
        if (this.config.enabled === false) {
            logger.info('BatchMailingService: disabled by configuration');
            return this;
        }

        this._dispatchTimer = setInterval(() => {
            this.dispatchTick().catch(err => logger.error(`BatchMailingService: dispatch tick failed — ${err.message}`));
        }, this.config.dispatchIntervalMs);
        this._dispatchTimer.unref?.();

        this._watchdogTimer = setInterval(() => {
            this.watchdogTick().catch(err => logger.error(`BatchMailingService: watchdog tick failed — ${err.message}`));
        }, this.config.watchdogIntervalMs);
        this._watchdogTimer.unref?.();

        // Delivery records and notifications carry their own expiry. Orion-core's
        // DatabaseJanitor cannot reap them — workers deliberately have no DELETE
        // on either table — so the single writer does it.
        this._purgeTimer = setInterval(() => {
            this._purgeExpired().catch(err => logger.warn(`BatchMailingService: purge cycle failed — ${err.message}`));
        }, PURGE_INTERVAL_MS);
        this._purgeTimer.unref?.();

        // A restart is exactly when leases are stale — reconcile before the
        // first ordinary tick rather than waiting for the watchdog interval.
        this.recoverAfterRestart().catch(err => logger.error(`BatchMailingService: restart recovery failed — ${err.message}`));

        logger.info(
            `BatchMailingService: ready — max ${this.config.maxPerGroup}/group, ` +
                `${this.config.nodeRateLimit.perWindow} mails per ${Math.round(this.config.nodeRateLimit.windowMs / 1000)}s per node, ` +
                `${Math.round(this.config.cooldownSeconds / 60)}min cooldown between jobs`
        );
        return this;
    }

    stop() {
        for (const timer of ['_dispatchTimer', '_watchdogTimer', '_purgeTimer']) {
            if (this[timer]) {
                clearInterval(this[timer]);
                this[timer] = null;
            }
        }
    }

    async _purgeExpired() {
        const [archive, notifications] = await Promise.all([this.archive.purgeExpired(), this.notifications.purgeExpired()]);
        if (archive > 0 || notifications > 0) {
            logger.info(`BatchMailingService: purged ${archive} expired delivery record(s) and ${notifications} expired notification(s)`);
        }
        return { archive, notifications };
    }

    // ── Submission ────────────────────────────────────────────────────────────

    /** Accepts a parsed sheet as a new job. @see JobSubmission.js */
    submitJob(parsed, actor = {}) {
        return submitJob(this, parsed, actor);
    }

    // ── Dispatch & recovery ───────────────────────────────────────────────────

    /** One pass of the scheduler. @see Dispatcher.js */
    dispatchTick() {
        return dispatchTick(this);
    }

    /** Looks for assignments that have gone quiet. @see MailingWatchdog.js */
    watchdogTick() {
        return watchdogTick(this);
    }

    /** Reconciles leases held across an orchestrator restart. @see leases.js */
    recoverAfterRestart() {
        return recoverAfterRestart(this);
    }

    // ── Inbound node reports ──────────────────────────────────────────────────

    /** MAILING_PROGRESS — a heartbeat with counts. */
    handleProgress(workerId, payload = {}) {
        return handleProgress(this, workerId, payload);
    }

    /** MAILING_GROUP_DONE — a node has finished with its group. */
    handleGroupDone(workerId, payload = {}) {
        return handleGroupDone(this, workerId, payload);
    }

    /** A node left the cluster; everything it held goes back in the pool. */
    handleNodeLost(workerId, reason = 'node left the cluster') {
        return handleNodeLost(this, workerId, reason);
    }

    // ── Completion & cancellation ─────────────────────────────────────────────

    /** Ends a job and arms the cooldown. @see JobCompletion.js */
    completeJob(job, status, options = {}) {
        return completeJob(this, job, status, options);
    }

    /** Stops a job gracefully and archives the unsent remainder. @see JobCompletion.js */
    cancelJob(jobId, actor = {}, reason = null) {
        return cancelJob(this, jobId, actor, reason);
    }

    // ── Reads for the panel and CLI ───────────────────────────────────────────

    listJobs(options = {}) {
        return listJobs(this, options);
    }

    getJobDetail(jobId) {
        return getJobDetail(this, jobId);
    }

    listDeadLetters(jobId, options = {}) {
        return listDeadLetters(this, jobId, options);
    }

    getQueueState() {
        return getQueueState(this);
    }

    /** Nodes eligible to send right now. */
    liveNodeIds() {
        return liveNodeIds(this);
    }
}

export { BatchMailingService, MailingError, MailingNotifications, defaultConfig as mailingDefaultConfig };
