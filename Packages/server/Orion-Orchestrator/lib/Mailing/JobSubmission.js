import { logger } from 'r-sync';
import { planGroups } from './GroupPlanner.js';
import { MailingError } from './MailingErrors.js';
import { MailingNotifications } from './MailingNotifications.js';
import { liveNodeIds } from './leases.js';

/**
 * Taking a parsed sheet and turning it into a queued job.
 *
 * Planning happens HERE, once, against the node count at submit time — the
 * group layout is then fixed for the life of the job. Re-planning later would
 * mean a node's leased group could change under it mid-send, and the arithmetic
 * gains nothing: a job with more groups than nodes already spreads correctly
 * across however many nodes are alive when each group is handed out.
 */

/**
 * @param {object} service   BatchMailingService
 * @param {object} parsed    output of parseMailingSheet
 * @param {object} actor     { id, email } — the submitting admin
 */
const submitJob = async (service, parsed, actor = {}) => {
    if (service.config.enabled === false) {
        throw new MailingError('MAILING::DISABLED', 'The batch mailing plane is disabled on this orchestrator', 503);
    }

    if (await service.jobs.exists(parsed.jobId)) {
        throw new MailingError(
            'MAILING::DUPLICATE-JOB',
            `A mailing job with id "${parsed.jobId}" already exists. Job ids are unique — clear the id column to have a new one generated.`,
            409
        );
    }

    const liveNodes = await liveNodeIds(service);
    // Planning against zero nodes is meaningless, but refusing the upload would
    // throw away a valid sheet over a transient fleet state. Plan against one
    // node instead: the cap still bounds the group size, and dispatch simply
    // waits until nodes appear.
    const nodeCount = liveNodes.length || 1;

    const plan = planGroups(parsed.rows.length, nodeCount, service.config.maxPerGroup);

    const job = await service.jobs.create({
        id: parsed.jobId,
        name: parsed.name,
        priority: parsed.priority,
        totalRecipients: plan.totalRecipients,
        groupSize: plan.groupSize,
        groupCount: plan.groupCount,
        plannedNodeCount: liveNodes.length,
        sourceFilename: parsed.filename,
        submittedBy: actor.id || null,
        submittedByEmail: actor.email || null
    });

    try {
        await service.recipients.insertMany(parsed.jobId, parsed.rows, plan.groupSize);
    } catch (err) {
        // A job row without its recipients is a job that would "run" and
        // instantly complete having sent nothing. Undo it.
        await service.jobs.setStatus(parsed.jobId, 'failed', { error: `Recipient load failed: ${err.message}` });
        await service.recipients.deleteForJob(parsed.jobId);
        throw new MailingError('MAILING::LOAD-FAILED', `The job could not be loaded: ${err.message}`, 500);
    }

    await announceQueuePosition(service, job, plan, liveNodes.length);

    // Don't make the operator wait for the next tick to see it start.
    service.dispatchTick().catch(err => logger.error(`BatchMailingService: post-submit dispatch failed — ${err.message}`));

    return { job, plan };
};

/**
 * Tells the operator, at submit time, whether this job starts now or waits —
 * and if it waits, behind what. This is the "delay warning" surfaced in the
 * panel: the information is most useful before anyone wonders why nothing is
 * happening.
 */
const announceQueuePosition = async (service, job, plan, liveNodeCount) => {
    const [running, queued, cooldown] = await Promise.all([service.jobs.findRunning(), service.jobs.listQueued(), service.jobs.cooldownRemaining()]);

    const ahead = queued.filter(q => q.id !== job.id && (q.priority < job.priority || (q.priority === job.priority && q.created_at < job.created_at)));

    const blockers = [];
    if (running) blockers.push(`"${running.name}" is currently running`);
    if (cooldown) blockers.push(`a ${Math.ceil(cooldown.seconds / 60)}min cooldown is in effect`);
    if (ahead.length > 0) blockers.push(`${ahead.length} job${ahead.length === 1 ? '' : 's'} ahead of it in the queue`);

    if (liveNodeCount === 0) {
        await service.notifications.create({
            type: MailingNotifications.NO_NODES,
            severity: 'warning',
            title: `"${job.name}" is queued but no nodes are live`,
            message:
                `${plan.totalRecipients} recipient${plan.totalRecipients === 1 ? '' : 's'} were accepted, but no node is currently ` +
                'available to send them. The job will start on its own as soon as a node joins the cluster.',
            details: { jobId: job.id, totalRecipients: plan.totalRecipients },
            jobId: job.id
        });
        return;
    }

    if (blockers.length === 0) {
        await service.notifications.create({
            type: MailingNotifications.JOB_QUEUED,
            severity: 'info',
            title: `"${job.name}" accepted and starting`,
            message:
                `${plan.totalRecipients} recipients in ${plan.groupCount} group${plan.groupCount === 1 ? '' : 's'} of up to ` +
                `${plan.groupSize}, across ${liveNodeCount} live node${liveNodeCount === 1 ? '' : 's'}.`,
            details: { jobId: job.id, ...plan },
            jobId: job.id
        });
        return;
    }

    await service.notifications.create({
        type: MailingNotifications.JOB_DELAYED,
        severity: 'warning',
        title: `"${job.name}" is queued and will not start yet`,
        message:
            `${plan.totalRecipients} recipients accepted. Only one mailing job runs at a time, and this one is waiting because ` +
            `${blockers.join(', and ')}. It starts automatically once the cluster is free.`,
        details: {
            jobId: job.id,
            priority: job.priority,
            runningJob: running ? { id: running.id, name: running.name } : null,
            cooldownSeconds: cooldown?.seconds ?? 0,
            jobsAhead: ahead.map(a => ({ id: a.id, name: a.name, priority: a.priority }))
        },
        jobId: job.id
    });
};

export { submitJob };
