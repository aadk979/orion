/**
 * ClusterHealth — the cluster-wide health state machine.
 *
 * Individual node signals (registry liveness + latest status snapshots) are
 * reduced into ONE fleet state: FORMING → HEALTHY ⇄ DEGRADED ⇄ INCIDENT.
 * The orchestrator evaluates on an interval, and INCIDENT entry can be gated
 * behind a fleet consensus vote (see OrionOrchestrator) so a skewed registry
 * view alone can't declare a cluster-wide emergency.
 *
 * A node counts as UNHEALTHY when it is offline, or its latest status snapshot
 * shows ETS lockdown / event-loop degradation, or its last report is older
 * than `statusMaxAgeSeconds` (a node that stopped reporting application status
 * can't be assumed fine just because transport heartbeats still arrive).
 */

import { ClusterStates } from './protocol.js';

const defaultConfig = Object.freeze({
    /** Fleet fraction of unhealthy nodes at (or above) which the cluster is an INCIDENT */
    incidentRatio: 0.5,
    /** INCIDENT requires at least this many unhealthy nodes (avoids 1-node clusters flapping straight to INCIDENT) */
    minUnhealthyForIncident: 2,
    /** Status snapshot older than this makes a node unhealthy (0 disables the check) */
    statusMaxAgeSeconds: 300
});

class ClusterHealth {
    constructor(config = {}) {
        this.config = { ...defaultConfig, ...config };
        this.state = ClusterStates.FORMING;
        this.changedAt = Math.floor(Date.now() / 1000);
        this.lastEvaluation = null;
    }

    isNodeUnhealthy(node, nowUnix) {
        if (!node.online) return 'offline';

        const status = node.lastStatus?.status;
        if (status?.etsLockdown) return 'ets-lockdown';
        if (status?.elmDegraded) return 'elm-degraded';

        if (this.config.statusMaxAgeSeconds > 0 && node.lastStatusAt !== null && nowUnix - node.lastStatusAt > this.config.statusMaxAgeSeconds) {
            return 'status-stale';
        }

        return null;
    }

    /**
     * Pure evaluation: reduces the node list to a target state + evidence.
     * Does NOT transition — the orchestrator owns transitions (it may need a
     * consensus confirmation first).
     */
    evaluate(nodes, nowUnix = Math.floor(Date.now() / 1000)) {
        if (!nodes || nodes.length === 0) {
            return { targetState: ClusterStates.FORMING, total: 0, unhealthy: [], ratio: 0 };
        }

        const unhealthy = [];
        for (const node of nodes) {
            const reason = this.isNodeUnhealthy(node, nowUnix);
            if (reason) unhealthy.push({ workerId: node.workerId, reason });
        }

        const ratio = unhealthy.length / nodes.length;

        let targetState = ClusterStates.HEALTHY;
        if (unhealthy.length > 0) targetState = ClusterStates.DEGRADED;
        if (ratio >= this.config.incidentRatio && unhealthy.length >= this.config.minUnhealthyForIncident) {
            targetState = ClusterStates.INCIDENT;
        }

        const evaluation = { targetState, total: nodes.length, unhealthy, ratio: Number(ratio.toFixed(4)) };
        this.lastEvaluation = { ...evaluation, evaluatedAt: nowUnix };
        return evaluation;
    }

    /** Commits a transition. Returns the previous state, or null if unchanged. */
    transitionTo(state) {
        if (state === this.state) return null;
        const previous = this.state;
        this.state = state;
        this.changedAt = Math.floor(Date.now() / 1000);
        return previous;
    }

    getSnapshot() {
        return {
            state: this.state,
            changedAt: this.changedAt,
            lastEvaluation: this.lastEvaluation
        };
    }
}

export { ClusterHealth };
