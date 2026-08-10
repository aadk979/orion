import { logger } from 'r-sync';
import { MailingNotifications } from './MailingNotifications.js';
import { probeNodeForGroup, releaseAssignment } from './leases.js';
import { completeJob } from './JobCompletion.js';

/**
 * The watchdog — finding work that nobody is doing.
 *
 * It reads two thresholds off the same evidence, the last progress report:
 *
 *   groupStallSeconds (minutes)      a node that is online but wedged still
 *                                    holds its lease; reclaim just that group.
 *   groupSilentTimeoutSeconds (24h)  the specification's backstop; sweep the
 *                                    whole job, not just the one group.
 *
 * Nothing is concluded without asking first. A node mid-way through a slow
 * group is silent in exactly the same way as a dead one, and only the node can
 * tell the two apart.
 */

const watchdogTick = async service => {
    if (service.config.enabled === false || service._watchdogRunning) return { skipped: true };
    service._watchdogRunning = true;

    try {
        const silent = await service.assignments.listSilent(service.config.groupStallSeconds);
        if (silent.length === 0) return { checked: 0 };

        const reclaimed = [];
        const jobsNeedingSweep = new Set();

        for (const assignment of silent) {
            const overdue = assignment.silent_seconds >= service.config.groupSilentTimeoutSeconds;

            const stillWorking = await probeNodeForGroup(service, assignment.worker_id, assignment.job_id, assignment.group_number);

            if (stillWorking) {
                await service.assignments.recordProgress(assignment.job_id, assignment.group_number, assignment.worker_id, {
                    sent: assignment.sent_count,
                    failed: assignment.failed_count
                });
                continue;
            }

            await releaseAssignment(
                service,
                assignment,
                overdue
                    ? `no completion report for ${Math.round(assignment.silent_seconds / 3600)}h and the node does not report working on it`
                    : `no progress for ${Math.round(assignment.silent_seconds / 60)}min and the node does not report working on it`
            );
            reclaimed.push(assignment);
            if (overdue) jobsNeedingSweep.add(assignment.job_id);
        }

        for (const jobId of jobsNeedingSweep) {
            await recoverJob(service, jobId);
        }

        if (reclaimed.length > 0) {
            service.dispatchTick().catch(err => logger.error(`BatchMailingService: dispatch after watchdog failed — ${err.message}`));
        }

        return { checked: silent.length, reclaimed: reclaimed.length, jobsRecovered: jobsNeedingSweep.size };
    } finally {
        service._watchdogRunning = false;
    }
};

/**
 * The 24h recovery path from the specification: having heard nothing, count
 * what is actually left in the table for this job. Anything still there is work
 * no node is doing, so the leases are cleared and the fleet is put back on it.
 */
const recoverJob = async (service, jobId) => {
    const job = await service.jobs.findById(jobId);
    if (!job || job.status !== 'running') return null;

    const remaining = await service.recipients.countRemaining(jobId);

    if (remaining === 0) {
        // Silence because there was nothing left to do — close it out.
        await completeJob(service, job, 'completed');
        return { jobId, remaining: 0, recovered: false };
    }

    const groups = await service.recipients.groupsWithWork(jobId);
    for (const group of groups) {
        if (!group.lockedBy) continue;
        await service.assignments.release(jobId, group.groupNumber, 'watchdog recovery: rebuilding assignments');
        await service.recipients.releaseGroup(jobId, group.groupNumber);
    }

    logger.warn(`BatchMailingService: watchdog recovered "${job.name}" — ${remaining} recipient(s) across ${groups.length} group(s) reassigned`);

    await service.notifications.create({
        type: MailingNotifications.WATCHDOG_RECOVERED,
        severity: 'critical',
        title: `"${job.name}" was recovered by the watchdog`,
        message:
            `No node reported completion for over ${Math.round(service.config.groupSilentTimeoutSeconds / 3600)} hours, and ${remaining} ` +
            `recipient(s) are still unsent. The remaining work was recompiled into ${groups.length} group(s) and the fleet has been ` +
            'told to resume — nothing was lost, but the nodes are likely to have hit an error worth looking at.',
        details: { jobId, remaining, groups: groups.length },
        jobId
    });

    return { jobId, remaining, recovered: true, groups: groups.length };
};

export { watchdogTick };
