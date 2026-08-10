import { logger } from 'r-sync';
import { ClusterCommands } from '../protocol.js';
import { MailingNotifications } from './MailingNotifications.js';
import { liveNodeIds, releaseAssignment } from './leases.js';
import { completeJob } from './JobCompletion.js';

/**
 * Dispatch — the scheduler.
 *
 * One pass does two things in order: promote a job to running if the cluster is
 * free, then give every idle node a group.
 *
 * A node holds at most one group at a time. That single rule is what makes the
 * overflow behaviour fall out for free: with 7 groups and 5 nodes, the first
 * pass places 5, and groups 6 and 7 are placed by later passes as nodes report
 * back — no queue-of-queues, no per-node backlog to rebalance.
 */

/**
 * One pass of the scheduler.
 *
 * Guarded against overlapping itself: two passes racing would hand the same
 * group to two nodes. The flag lives on the service because `handleGroupDone`,
 * `cancelJob` and the watchdog all kick a pass off opportunistically.
 */
const dispatchTick = async service => {
    if (service.config.enabled === false || service._dispatching) return { skipped: true };
    service._dispatching = true;

    try {
        let job = await service.jobs.findRunning();

        if (!job) {
            job = await startNextJob(service);
            if (!job) return { idle: true };
        }

        return await dispatchGroups(service, job);
    } finally {
        service._dispatching = false;
    }
};

/**
 * Promotes the head of the queue to running, if the cluster is free.
 * `claimNext` does the whole check in one statement, so the cooldown and the
 * one-job-at-a-time rule cannot be raced.
 */
const startNextJob = async service => {
    const job = await service.jobs.claimNext();
    if (!job) return null;

    logger.info(`BatchMailingService: starting mailing job "${job.name}" (${job.id}) — ${job.total_recipients} recipients`);

    await service.notifications.create({
        type: MailingNotifications.JOB_STARTED,
        severity: 'info',
        title: `"${job.name}" has started`,
        message: `Sending to ${job.total_recipients} recipient${job.total_recipients === 1 ? '' : 's'} across ${job.group_count} group(s).`,
        details: { jobId: job.id, groupCount: job.group_count, groupSize: job.group_size },
        jobId: job.id
    });

    return job;
};

/** Hands out every unassigned group that has an idle node to take it. */
const dispatchGroups = async (service, job) => {
    const groups = await service.recipients.groupsWithWork(job.id);

    if (groups.length === 0) {
        await completeJob(service, job, 'completed');
        return { completed: true, jobId: job.id };
    }

    const [liveNodes, busy] = await Promise.all([liveNodeIds(service), service.assignments.busyWorkers()]);

    if (liveNodes.length === 0) {
        logger.warn(`BatchMailingService: job "${job.name}" has ${groups.length} group(s) outstanding but no live nodes`);
        return { jobId: job.id, dispatched: 0, waitingForNodes: true };
    }

    const liveSet = new Set(liveNodes);
    const idle = liveNodes.filter(id => !busy.has(id));
    const dispatched = [];

    for (const group of groups) {
        if (idle.length === 0) break;

        // A group whose lease points at a node the cluster no longer has (or
        // that has no live assignment) is not really assigned — reclaim it here
        // rather than leaving it invisible until the watchdog runs.
        if (group.lockedBy) {
            const assignment = await service.assignments.findLive(job.id, group.groupNumber);
            if (assignment && liveSet.has(assignment.worker_id)) continue; // genuinely in flight

            await releaseAssignment(
                service,
                assignment || { job_id: job.id, group_number: group.groupNumber, worker_id: group.lockedBy },
                assignment ? 'the node holding this group is no longer in the cluster' : 'the group was leased but no live assignment existed'
            );
        }

        const workerId = idle.shift();
        const placed = await assignGroup(service, job, group.groupNumber, workerId, group.remaining);
        if (placed) {
            dispatched.push({ groupNumber: group.groupNumber, workerId });
        } else {
            // The node refused or was unreachable — it is not idle in any useful
            // sense, so move on and let a later tick retry.
            logger.warn(`BatchMailingService: node ${workerId} did not accept group ${group.groupNumber} of "${job.name}"`);
        }
    }

    return { jobId: job.id, dispatched: dispatched.length, assignments: dispatched, groupsOutstanding: groups.length };
};

/**
 * Leases a group to a node and tells it to start.
 *
 * Order matters: the lease is taken FIRST, so a node that starts sending the
 * instant it receives the command is always working on rows already stamped
 * with its own id. If the command then fails, the lease is rolled back — the
 * reverse order would leave a window where a node is sending rows it does not
 * own.
 */
const assignGroup = async (service, job, groupNumber, workerId, remaining) => {
    await service.recipients.lockGroup(job.id, groupNumber, workerId);

    try {
        await service.assignments.create(job.id, groupNumber, workerId, remaining);
    } catch (err) {
        // The partial unique index rejected it: someone else already holds this
        // group. Leave their lease alone.
        await service.recipients.releaseGroup(job.id, groupNumber);
        logger.warn(`BatchMailingService: group ${groupNumber} of "${job.name}" is already assigned — ${err.message}`);
        return false;
    }

    try {
        const outcome = await service.orch.command(
            workerId,
            ClusterCommands.MAILING_ASSIGN,
            {
                jobId: job.id,
                jobName: job.name,
                groupNumber,
                recipientCount: remaining,
                rateLimit: service.config.nodeRateLimit,
                maxAttempts: service.config.maxAttempts,
                archiveTtlDays: service.config.archiveTtlDays
            },
            service.config.assignTimeoutMs
        );

        if (outcome?.ok !== true || outcome.result?.accepted !== true) {
            throw new Error(outcome?.error?.message || outcome?.result?.reason || 'the node did not accept the assignment');
        }

        logger.info(`BatchMailingService: group ${groupNumber} of "${job.name}" (${remaining} recipients) → ${workerId}`);
        return true;
    } catch (err) {
        await service.assignments.release(job.id, groupNumber, `dispatch failed: ${err.message}`);
        await service.recipients.releaseGroup(job.id, groupNumber);
        return false;
    }
};

export { dispatchTick };
