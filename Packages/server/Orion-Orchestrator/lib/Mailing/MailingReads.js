import { MailingError } from './MailingErrors.js';
import { liveNodeIds } from './leases.js';

/**
 * Read-only views for the panel and the CLI.
 *
 * Nothing here writes, and nothing here is on the sending path — these exist so
 * an operator can answer "what is happening" and, more often, "why is nothing
 * happening".
 */

const listJobs = (service, options = {}) => service.jobs.list(options);

const listDeadLetters = (service, jobId, options = {}) => service.archive.list(jobId, { ...options, outcome: 'failed' });

/** The full picture of one job: counters, per-group progress, and who holds what right now. */
const getJobDetail = async (service, jobId) => {
    const job = await service.jobs.findById(jobId);
    if (!job) throw new MailingError('MAILING::JOB-NOT-FOUND', `No mailing job with id "${jobId}"`, 404);

    const [groups, assignments, counts, remaining] = await Promise.all([
        service.recipients.groupsWithWork(jobId),
        service.assignments.listForJob(jobId),
        service.archive.counts(jobId),
        service.recipients.countRemaining(jobId)
    ]);

    const remainingByGroup = new Map(groups.map(g => [g.groupNumber, g]));

    // Every planned group, including the ones already drained — a progress view
    // that silently omits finished groups reads like work vanished.
    const groupView = Array.from({ length: job.group_count }, (_, i) => {
        const groupNumber = i + 1;
        const outstanding = remainingByGroup.get(groupNumber);
        const live = assignments.find(a => a.group_number === groupNumber && ['assigned', 'running'].includes(a.status));
        const history = assignments.filter(a => a.group_number === groupNumber);
        const lastFinished = [...history].reverse().find(a => a.completed_at);

        return {
            groupNumber,
            remaining: outstanding?.remaining ?? 0,
            status: !outstanding ? 'completed' : live ? live.status : 'waiting',
            workerId: live?.worker_id || outstanding?.lockedBy || null,
            sent: live?.sent_count ?? lastFinished?.sent_count ?? 0,
            failed: live?.failed_count ?? lastFinished?.failed_count ?? 0,
            assignedAt: live?.assigned_at || null,
            lastProgressAt: live?.last_progress_at || null,
            attempts: history.length
        };
    });

    return {
        job: {
            ...job,
            remaining,
            progressPercent: job.total_recipients > 0 ? Math.round(((job.total_recipients - remaining) / job.total_recipients) * 100) : 100
        },
        counts,
        groups: groupView,
        assignments
    };
};

/** Queue state for the panel banner: what is running, what is waiting, and why nothing has started yet. */
const getQueueState = async service => {
    const [running, queued, cooldown, liveNodes] = await Promise.all([
        service.jobs.findRunning(),
        service.jobs.listQueued(),
        service.jobs.cooldownRemaining(),
        liveNodeIds(service)
    ]);

    const runningDetail = running
        ? {
              id: running.id,
              name: running.name,
              totalRecipients: running.total_recipients,
              remaining: await service.recipients.countRemaining(running.id),
              startedAt: running.started_at
          }
        : null;

    return {
        enabled: service.config.enabled !== false,
        running: runningDetail,
        queued: queued.map((job, index) => ({
            id: job.id,
            name: job.name,
            priority: job.priority,
            totalRecipients: job.total_recipients,
            position: index + 1,
            createdAt: job.created_at
        })),
        cooldown: cooldown ? { until: cooldown.until, seconds: cooldown.seconds } : null,
        liveNodeCount: liveNodes.length,
        // The one-line answer to "why is my job not sending?"
        blockedReason: !running && queued.length > 0 ? (cooldown ? 'cooldown' : liveNodes.length === 0 ? 'no-live-nodes' : null) : null
    };
};

export { listJobs, listDeadLetters, getJobDetail, getQueueState };
