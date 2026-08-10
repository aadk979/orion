import { logger } from '../../logger.js';
import { LeaseLostError } from './errors.js';
import { isPermanentRejection, isTransportFailure, isRateLimited, backoffFor } from './failures.js';
import { tokensFor, substitute } from './tokens.js';

/**
 * GroupSender — everything that happens between accepting one group and
 * reporting on it.
 *
 * It reads slices of the group from the queue, spends the node's rate budget on
 * them one at a time, and makes sure every row it touches ends up retired. It
 * owns no state beyond the run it was given: the transport, the rate limiter,
 * the database seam and the config all belong to the BatchMailerSystem it was
 * constructed with.
 *
 * ── The two failures it must never conflate ─────────────────────────────────
 *
 *   A BAD ADDRESS fails no matter how often it is tried. It gets `maxAttempts`
 *   tries with exponential backoff and is then DEAD-LETTERED — archived as
 *   failed and removed from the queue. Leaving it in place would have the
 *   orchestrator's watchdog reassign it forever and the job would never end.
 *
 *   A DEAD TRANSPORT fails for everyone. When enough consecutive recipients
 *   fail for reasons that are not about the address, the group stops and is
 *   handed back unfinished with a reason — there is nothing to be gained by
 *   burning through the remaining recipients against a broken SMTP server.
 */
class GroupSender {
    /**
     * @param {import('./BatchMailerSystem.js').BatchMailerSystem} system
     * @param {import('./GroupRun.js').GroupRun} run
     */
    constructor(system, run) {
        this.system = system;
        this.run = run;
    }

    get config() {
        return this.system.config;
    }

    /**
     * Sends the whole group, or as much of it as it is allowed to.
     *
     * Never throws for a delivery reason — the outcome IS the result, and the
     * caller reports it upstream either way.
     *
     * @returns {Promise<{ outcome: 'completed'|'cancelled'|'failed', error: string|null }>}
     */
    async drain() {
        const { run } = this;
        let outcome = 'completed';
        let error = null;

        try {
            for (;;) {
                if (this._shouldStop()) {
                    outcome = 'cancelled';
                    break;
                }

                const batch = await this.system._fetchBatch(run);
                if (batch.length === 0) break; // group drained

                for (const row of batch) {
                    if (this._shouldStop()) {
                        outcome = 'cancelled';
                        break;
                    }

                    await this._spendRateBudget();
                    await this.deliver(row);

                    if (run.consecutiveFailures >= this.config.consecutiveFailureAbort) {
                        outcome = 'failed';
                        error =
                            `${run.consecutiveFailures} consecutive recipients failed for transport reasons — ` +
                            'the mail server appears to be unreachable or rejecting this node, so the rest of the group was left unsent';
                        break;
                    }
                }

                if (outcome !== 'completed') break;
            }
        } catch (err) {
            if (err instanceof LeaseLostError) {
                // Reported as cancelled, not failed: nothing went wrong and the
                // work is already in hand elsewhere. Calling it a failure would
                // have the orchestrator release a group that is being sent.
                outcome = 'cancelled';
                error = err.message;
                logger.warn(`BatchMailerSystem: stopping group ${run.groupNumber} of ${run.jobId} — ${err.message}`);
            } else {
                outcome = 'failed';
                error = err.message;
                logger.error(`BatchMailerSystem: group ${run.groupNumber} of ${run.jobId} aborted — ${err.message}`);
            }
        }

        return { outcome, error };
    }

    /** Cancellation is checked between recipients, never mid-send. */
    _shouldStop() {
        return this.run.cancelled || this.system.stopping;
    }

    async _spendRateBudget() {
        if (this.system._limiter.delayUntilAllowed() > 0) this.system.count('rateLimitWaits');
        await this.system._limiter.wait();
    }

    /**
     * Sends one recipient, retrying inside its own attempt budget.
     *
     * Every path out of here is terminal for the row: it is either archived as
     * sent or archived as failed, and deleted from the queue either way. A row
     * that stays in the queue after being handled is a row that gets mailed
     * twice on the next assignment.
     */
    async deliver(row) {
        let attempt = row.attempts || 0;
        let lastError = null;
        // Throttle replies do not consume the retry budget, so they need their
        // own ceiling — otherwise a provider that throttles indefinitely would
        // hold this recipient (and the whole group behind it) forever.
        let throttleRetries = 0;
        const maxThrottleRetries = this.config.maxAttempts * 2;

        while (attempt < this.config.maxAttempts) {
            attempt += 1;

            try {
                await this.sendOne(row);
                this.system._limiter.record();

                await this._retire(row, 'sent', { attempts: attempt, error: null });

                this.run.sent += 1;
                this.run.consecutiveFailures = 0;
                this.system.count('mailsSent');
                this._decrementRemaining();

                return { sent: true, attempts: attempt };
            } catch (err) {
                // Losing the lease is not a delivery failure and must not be
                // retried or dead-lettered — it ends the group.
                if (err instanceof LeaseLostError) throw err;

                lastError = err;
                this.system.count('mailsFailed');

                // Asked before isPermanentRejection, because a 421/450/451/452
                // is "slow down", not "never": charge the rate budget rather
                // than the retry budget, until the throttle ceiling runs out.
                if (isRateLimited(err) && throttleRetries < maxThrottleRetries) {
                    this.system._limiter.record();
                    throttleRetries += 1;
                    attempt -= 1;
                    await this.system._sleep(this._backoffFor(throttleRetries));
                    continue;
                }

                // No number of retries fixes a nonexistent mailbox.
                if (isPermanentRejection(err)) break;

                if (attempt < this.config.maxAttempts) {
                    // Persist the attempt count before sleeping: if this node
                    // dies mid-backoff, whoever picks the group up next
                    // continues the budget instead of restarting it.
                    await this.system._recordAttempt(row, attempt, err.message).catch(() => {});
                    await this.system._sleep(this._backoffFor(attempt));
                }
            }
        }

        return this._deadLetter(row, attempt, lastError);
    }

    async sendOne(row) {
        const { transporter } = this.system;
        if (!transporter) throw new Error('The batch mail transport is not configured on this node');

        const mailConfig = this.config.mail || {};
        const tokens = tokensFor(row, this.run, mailConfig);

        const mail = {
            from: mailConfig.from || mailConfig.email,
            to: row.recipient,
            subject: substitute(row.subject, tokens)
        };

        const body = substitute(row.content, tokens);
        if (row.content_type === 'html') {
            mail.html = body;
        } else {
            mail.text = body;
        }

        return transporter.sendMail(mail);
    }

    /** Attempts exhausted, or a permanent rejection: archive it as failed and move on. */
    async _deadLetter(row, attempts, lastError) {
        await this._retire(row, 'failed', { attempts, error: lastError?.message || 'delivery failed' });

        this.run.failed += 1;
        this.system.count('deadLettered');
        this._decrementRemaining();

        if (isTransportFailure(lastError)) {
            this.run.consecutiveFailures += 1;
        } else {
            // A bad address says nothing about the transport, so it must not
            // count towards the "server is down" threshold.
            this.run.consecutiveFailures = 0;
        }

        logger.warn(`BatchMailerSystem: ${row.recipient} dead-lettered after ${attempts} attempt(s) — ${lastError?.message || 'unknown error'}`);

        return { sent: false, attempts, error: lastError?.message || null };
    }

    /**
     * Archives the row and removes it from the queue.
     *
     * A retire that matches nothing means the row was not ours: the orchestrator
     * reassigned this group while we were sending, and another node is working
     * it. Stop at once rather than continue duplicating its mail.
     */
    async _retire(row, outcome, meta) {
        const retired = await this.system._archiveAndDelete(row, outcome, meta);
        if (retired === 0) throw new LeaseLostError(this.run.jobId, this.run.groupNumber);
    }

    _decrementRemaining() {
        if (this.run.remaining !== null) this.run.remaining = Math.max(0, this.run.remaining - 1);
    }

    _backoffFor(attempt) {
        return backoffFor(attempt, this.config.backoffBaseMs, this.config.backoffMaxMs);
    }
}

export { GroupSender };
