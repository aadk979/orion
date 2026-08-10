import { logger } from 'r-sync';
import { MailingNotifications } from './MailingNotifications.js';

/**
 * Everything a node tells the orchestrator, and what is done about it.
 *
 * Three inbound signals, in ascending order of consequence: a heartbeat, a
 * finished group, and a node that has gone. All three end by kicking dispatch,
 * because in every case some capacity has just become free.
 */

/** MAILING_PROGRESS — a heartbeat with counts. Cheap and frequent. */
const handleProgress = async (service, workerId, payload = {}) => {
    const { jobId, groupNumber, sent, failed, remaining } = payload;
    if (!jobId || !Number.isInteger(groupNumber)) return null;

    return service.assignments.recordProgress(jobId, groupNumber, workerId, { sent, failed, remaining });
};

/**
 * MAILING_GROUP_DONE — a node has finished with its group.
 *
 * This is the pivot of the whole loop: close the assignment, then immediately
 * look for more work. A node that just freed itself is the best candidate for
 * the next group, and dispatchTick will find it.
 */
const handleGroupDone = async (service, workerId, payload = {}) => {
    const { jobId, groupNumber, outcome, sent = 0, failed = 0, remaining = 0, error = null } = payload;
    if (!jobId || !Number.isInteger(groupNumber)) return null;

    const status = outcome === 'completed' ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'failed';
    const closed = await service.assignments.finish(jobId, groupNumber, workerId, status, { sent, failed, remaining, error });

    // No live assignment matched, so this report is STALE — the group was
    // already reclaimed (watchdog, node-loss sweep, restart) and may now belong
    // to a different node. Acting on it would strip the lease from whoever is
    // doing the work now. Record it and stop.
    if (!closed) {
        logger.warn(
            `BatchMailingService: ignoring a late "${status}" report from ${workerId} for group ${groupNumber} of ${jobId} — ` +
                'that group is no longer assigned to it'
        );
        await service.jobs.refreshCounts(jobId);
        return { jobId, groupNumber, status, stale: true };
    }

    // A group the node gave up on still has rows; they must go back in the pool
    // or nobody will ever send them. Scoped to this worker so a race cannot
    // release a lease that has since moved on.
    if (status !== 'completed') {
        await service.recipients.releaseGroupFromWorker(jobId, groupNumber, workerId);
    }

    logger.info(`BatchMailingService: ${workerId} finished group ${groupNumber} of ${jobId} — ${status} (${sent} sent, ${failed} failed, ${remaining} left)`);

    await service.jobs.refreshCounts(jobId);

    if (status === 'failed' && error) {
        await service.notifications.create({
            type: MailingNotifications.GROUP_REASSIGNED,
            severity: 'warning',
            title: `Group ${groupNumber} was returned by ${workerId}`,
            message: `The node stopped sending group ${groupNumber} and returned ${remaining} unsent recipient(s) to the queue: ${error}`,
            details: { jobId, groupNumber, workerId, sent, failed, remaining, error },
            jobId
        });
    }

    // Cancellation is driven by cancelJob(); a node reporting back during one
    // must not restart dispatch for a job that is stopping.
    if (status !== 'cancelled') {
        service.dispatchTick().catch(err => logger.error(`BatchMailingService: dispatch after group completion failed — ${err.message}`));
    }

    return { jobId, groupNumber, status };
};

/**
 * A node left the cluster. Everything it held goes straight back into the pool
 * — its groups have not been sent, and waiting 24 hours to find that out helps
 * nobody.
 */
const handleNodeLost = async (service, workerId, reason = 'node left the cluster') => {
    if (service.config.enabled === false) return null;

    try {
        const released = await service.assignments.releaseAllForWorker(workerId, reason);
        if (released.length === 0) return { released: 0 };

        const groups = await service.recipients.releaseAllForWorker(workerId);

        logger.warn(`BatchMailingService: ${workerId} left holding ${released.length} group(s) — released for reassignment (${reason})`);

        await service.notifications.create({
            type: MailingNotifications.GROUP_REASSIGNED,
            severity: 'warning',
            title: `${released.length} mailing group(s) released from ${workerId}`,
            message:
                `${workerId} ${reason}. The group${released.length === 1 ? '' : 's'} it was sending ` +
                `(${released.map(a => `#${a.group_number}`).join(', ')}) went back to the queue and will be picked up by another node.`,
            details: { workerId, reason, groups: released.map(a => ({ jobId: a.job_id, groupNumber: a.group_number })) },
            jobId: released[0]?.job_id || null
        });

        service.dispatchTick().catch(err => logger.error(`BatchMailingService: dispatch after node loss failed — ${err.message}`));

        return { released: released.length, groups };
    } catch (err) {
        logger.error(`BatchMailingService: releasing ${workerId}'s groups failed — ${err.message}`);
        return null;
    }
};

export { handleProgress, handleGroupDone, handleNodeLost };
