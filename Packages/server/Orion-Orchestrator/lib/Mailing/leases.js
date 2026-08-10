import { logger } from 'r-sync';
import { ClusterCommands } from '../protocol.js';

/**
 * Leases — who is allowed to send which group, and how a lease is taken back.
 *
 * These three are the only things the dispatcher, the watchdog, the node-report
 * handlers and restart recovery all need from each other, so they live here
 * rather than in any one of them.
 *
 * Every recovery path in the plane ends at `releaseAssignment`: node loss,
 * stall detection, the 24h watchdog, a refused dispatch and an orchestrator
 * restart all converge on it and then let the ordinary dispatch loop pick the
 * group up again. There is no separate recovery mode to get wrong.
 */

/**
 * Nodes eligible to send. Transport-active AND application-online: a node whose
 * tunnel is up but which has not said hello cannot execute a command, and
 * handing it a group would only produce a dispatch failure.
 */
const liveNodeIds = async service => {
    const status = await service.orch.getClusterStatus();
    return status.nodes
        .filter(node => node.online === true && node.transport?.status && String(node.transport.status).toUpperCase() === 'ACTIVE')
        .map(node => node.workerId);
};

/**
 * Asks a node whether it is still working on a specific group.
 *
 * An unreachable node answers "no" by failing — which is the correct reading,
 * since a node we cannot talk to is a node that cannot report completion
 * either.
 */
const probeNodeForGroup = async (service, workerId, jobId, groupNumber) => {
    try {
        const outcome = await service.orch.command(workerId, ClusterCommands.MAILING_STATUS, { jobId }, service.config.assignTimeoutMs);
        if (outcome?.ok !== true) return false;

        const active = outcome.result?.active || [];
        return active.some(entry => entry.jobId === jobId && entry.groupNumber === groupNumber);
    } catch (_) {
        return false;
    }
};

/** Reclaims one assignment: close the ledger row, drop the lease. */
const releaseAssignment = async (service, assignment, reason) => {
    await service.assignments.release(assignment.job_id, assignment.group_number, reason);
    await service.recipients.releaseGroup(assignment.job_id, assignment.group_number);

    logger.warn(`BatchMailingService: released group ${assignment.group_number} of ${assignment.job_id} from ${assignment.worker_id} — ${reason}`);
};

/**
 * The orchestrator restarted. Any assignment still marked live is a lease held
 * by a conversation that no longer exists — we have no way to know whether that
 * node is still sending, so the safe reading is "not dispatched". Releasing it
 * does not lose work: the recipients are still in the table, and a node that IS
 * still sending will be told to stop the moment it reports in against a
 * released assignment.
 */
const recoverAfterRestart = async service => {
    const live = await service.assignments.listLive();
    if (live.length === 0) return { released: 0 };

    logger.warn(`BatchMailingService: ${live.length} assignment(s) survived a restart — reconciling before dispatch`);

    for (const assignment of live) {
        // Ask the node what it thinks it is doing. A node that is genuinely
        // still working keeps its group; only the ones we cannot confirm are
        // reclaimed.
        const stillWorking = await probeNodeForGroup(service, assignment.worker_id, assignment.job_id, assignment.group_number);
        if (stillWorking) {
            await service.assignments.recordProgress(assignment.job_id, assignment.group_number, assignment.worker_id, {
                sent: assignment.sent_count,
                failed: assignment.failed_count
            });
            continue;
        }
        await releaseAssignment(service, assignment, 'orchestrator restarted while this group was in flight');
    }

    return { released: live.length };
};

export { liveNodeIds, probeNodeForGroup, releaseAssignment, recoverAfterRestart };
