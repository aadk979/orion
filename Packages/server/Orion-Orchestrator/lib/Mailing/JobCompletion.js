import { logger } from 'r-sync';
import { ClusterCommands } from '../protocol.js';
import { MailingError } from './MailingErrors.js';
import { MailingNotifications, completionNotificationFor } from './MailingNotifications.js';

/**
 * How a job ends — on its own, or because somebody stopped it.
 *
 * Both paths converge on the same three obligations: arm (or skip) the
 * cooldown, tell the panel, and mail the person who submitted it.
 */

/**
 * Ends a job and arms the cooldown. Nothing else may start until it expires —
 * that is the point of it, so it is written in the same statement as the status
 * change.
 */
const completeJob = async (service, job, status, { error = null } = {}) => {
    const finished = await service.jobs.finish(job.id, status, service.config.cooldownSeconds, { error });
    if (!finished) return null; // someone else already closed it

    const counts = await service.archive.counts(job.id);
    await service.jobs.refreshCounts(job.id);

    const durationSeconds = finished.started_at ? Math.max(0, Math.round((new Date(finished.completed_at) - new Date(finished.started_at)) / 1000)) : null;

    logger.info(
        `BatchMailingService: job "${job.name}" ${status} — ${counts.sent} sent, ${counts.failed} failed, ${counts.cancelled} cancelled` +
            `${durationSeconds !== null ? ` in ${Math.round(durationSeconds / 60)}min` : ''}`
    );

    await service.notifications.create({
        type: completionNotificationFor(status),
        severity: status === 'completed' ? (counts.failed > 0 ? 'warning' : 'info') : 'warning',
        title: `"${finished.name}" ${status}`,
        message:
            `${counts.sent} sent, ${counts.failed} undeliverable${counts.cancelled ? `, ${counts.cancelled} cancelled` : ''}. ` +
            `The next queued job starts in ${Math.round(service.config.cooldownSeconds / 60)} minutes.`,
        details: { jobId: finished.id, ...counts, durationSeconds, cooldownSeconds: service.config.cooldownSeconds },
        jobId: finished.id
    });

    if (counts.failed > 0) {
        await service.notifications.create({
            type: MailingNotifications.DEAD_LETTERS,
            severity: 'warning',
            title: `${counts.failed} recipient(s) in "${finished.name}" could not be reached`,
            message:
                `These addresses exhausted their ${service.config.maxAttempts} delivery attempts and were not retried further. ` +
                'The reason for each is on the job page.',
            details: { jobId: finished.id, failed: counts.failed },
            jobId: finished.id
        });
    }

    await emailSubmitter(service, finished, counts, durationSeconds, status);

    return finished;
};

/**
 * Stops a job. Graceful: nodes are told to finish the mail already handed to
 * the transport and then stop, so no mail is ever sent without its row being
 * retired.
 *
 * The unsent remainder is archived as 'cancelled' rather than deleted — "who
 * did we not reach" is the first question anyone asks after cancelling a blast,
 * and a DELETE makes it unanswerable.
 */
const cancelJob = async (service, jobId, actor = {}, reason = null) => {
    const job = await service.jobs.findById(jobId);
    if (!job) throw new MailingError('MAILING::JOB-NOT-FOUND', `No mailing job with id "${jobId}"`, 404);

    if (!['queued', 'running'].includes(job.status)) {
        throw new MailingError('MAILING::NOT-CANCELLABLE', `Job "${job.name}" is ${job.status} and cannot be cancelled`, 409);
    }

    const live = await service.assignments.listLive(jobId);

    // Tell the nodes first. A node that stops promptly is one that will not send
    // a mail whose row we are about to archive as cancelled.
    await Promise.allSettled(
        live.map(assignment =>
            service.orch.command(
                assignment.worker_id,
                ClusterCommands.MAILING_CANCEL,
                { jobId, groupNumber: assignment.group_number },
                service.config.assignTimeoutMs,
                actor.id ? { type: 'admin', id: actor.id, email: actor.email } : null
            )
        )
    );

    const by = actor.email || 'an administrator';

    await service.assignments.cancelAllForJob(jobId, reason || `cancelled by ${by}`);
    const archived = await service.recipients.archiveAndClearRemaining(jobId, 'cancelled', service.config.archiveTtlDays);

    // Cancelling should not also cost the next job an hour, so the cooldown is
    // zero here — the cluster is free immediately.
    await service.jobs.finish(jobId, 'cancelled', 0, { error: reason || `cancelled by ${by}` });
    const counts = await service.archive.counts(jobId);
    await service.jobs.refreshCounts(jobId);

    logger.warn(`BatchMailingService: job "${job.name}" cancelled by ${by} — ${archived} recipient(s) unsent`);

    await service.notifications.create({
        type: MailingNotifications.JOB_CANCELLED,
        severity: 'warning',
        title: `"${job.name}" was cancelled`,
        message:
            `${actor.email || 'An administrator'} stopped this job. ${counts.sent} recipient(s) had already been mailed; ` +
            `${archived} were not and are recorded as cancelled. The next queued job may start immediately.`,
        details: { jobId, cancelledBy: actor.email || null, reason, unsent: archived, ...counts },
        jobId
    });

    await emailSubmitter(service, await service.jobs.findById(jobId), counts, null, 'cancelled');

    service.dispatchTick().catch(err => logger.error(`BatchMailingService: dispatch after cancellation failed — ${err.message}`));

    return { jobId, cancelled: true, unsent: archived, ...counts };
};

/**
 * Summary mail to whoever submitted the job. Best effort by design: the job has
 * finished either way, and a mail failure must not turn a completed blast into
 * a failed one.
 */
const emailSubmitter = async (service, job, counts, durationSeconds, status) => {
    if (service.config.emailSubmitterOnCompletion !== true) return;
    // `job` can be null if the row was removed between finishing and this call —
    // the summary is a courtesy, so it is skipped rather than turning a
    // completed blast into an error.
    if (!service.mailer || !job?.submitted_by_email) return;

    const lines = [
        `Your mailing job "${job.name}" ${status}.`,
        '',
        `Job id:        ${job.id}`,
        `Recipients:    ${job.total_recipients}`,
        `Sent:          ${counts.sent}`,
        `Undeliverable: ${counts.failed}`,
        ...(counts.cancelled ? [`Cancelled:     ${counts.cancelled}`] : []),
        ...(durationSeconds !== null ? [`Duration:      ${Math.round(durationSeconds / 60)} minutes`] : []),
        '',
        ...(counts.failed > 0
            ? [`${counts.failed} address(es) exhausted their delivery attempts. The per-address reasons are on the job page in the orch panel.`, '']
            : []),
        'This is an automated summary from the Orion orchestrator.'
    ];

    try {
        await sendPlainMail(service, job.submitted_by_email, `Mailing job "${job.name}" ${status}`, lines.join('\n'));
    } catch (err) {
        logger.warn(`BatchMailingService: completion summary to ${job.submitted_by_email} not delivered — ${err.message}`);
    }
};

/**
 * AdminMailer only knows how to send magic links, so the summary goes through
 * its transport directly. In console mode (no mail configured) the summary is
 * logged, exactly as a magic link would be.
 */
const sendPlainMail = async (service, to, subject, text) => {
    const { mailer } = service;

    if (mailer.consoleMode || !mailer.transporter) {
        logger.info(`BatchMailingService (console mode — no mail config): summary for ${to}\n${subject}\n${text}`);
        return { sent: true, mode: 'console' };
    }

    await mailer.transporter.sendMail({ from: mailer.config.from || mailer.config.email, to, subject, text });
    return { sent: true, mode: 'smtp' };
};

export { completeJob, cancelJob };
