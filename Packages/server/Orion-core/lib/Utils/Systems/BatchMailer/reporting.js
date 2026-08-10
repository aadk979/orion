import { logger } from '../../logger.js';

/**
 * What this node tells the orchestrator while it works, and when it stops.
 *
 * Both take the BatchMailerSystem so the cluster link is looked up through
 * `system._link()` at call time — the tunnel comes and goes, and a reference
 * captured at construction would outlive its connection.
 */

/**
 * Counts, on a timer, while groups are in flight. This is not how the
 * orchestrator learns what was sent — the database already knows that. It is
 * how it tells a node that is working slowly from one that has wedged.
 */
const reportProgress = async system => {
    if (system._active.size === 0) return;

    const link = system._link();
    if (!link?.connected) return;

    const { ClusterEvents, buildMailingProgress } = link.protocol || {};
    if (!ClusterEvents || !buildMailingProgress) return;

    for (const run of system._active.values()) {
        try {
            await link.emitToOrchestrator(
                ClusterEvents.MAILING_PROGRESS,
                buildMailingProgress(run.jobId, run.groupNumber, { sent: run.sent, failed: run.failed, remaining: run.remaining })
            );
        } catch (err) {
            logger.warn(`BatchMailerSystem: progress for group ${run.groupNumber} not delivered — ${err.message}`);
        }
    }
};

/**
 * The one report that matters: this group is finished.
 *
 * Its absence is what the orchestrator's watchdog is watching for, so a failure
 * to deliver it is logged loudly — the work is done either way, but the cluster
 * will spend up to a day rediscovering that.
 */
const reportGroupDone = async (system, run, outcome, error) => {
    const link = system._link();
    if (!link?.connected) {
        logger.error(
            `BatchMailerSystem: group ${run.groupNumber} of ${run.jobId} finished (${outcome}) but the orchestrator link is down — ` +
                'the orchestrator will recover this group through its watchdog'
        );
        return;
    }

    const { ClusterEvents, buildMailingGroupDone } = link.protocol || {};
    if (!ClusterEvents || !buildMailingGroupDone) return;

    try {
        await link.emitToOrchestrator(
            ClusterEvents.MAILING_GROUP_DONE,
            buildMailingGroupDone(run.jobId, run.groupNumber, outcome, {
                sent: run.sent,
                failed: run.failed,
                remaining: run.remaining ?? 0,
                error
            })
        );
    } catch (err) {
        logger.error(`BatchMailerSystem: completion report for group ${run.groupNumber} not delivered — ${err.message}`);
    }
};

export { reportProgress, reportGroupDone };
