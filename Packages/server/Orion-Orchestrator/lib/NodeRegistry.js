/**
 * NodeRegistry — the orchestrator's application-level view of the cluster.
 *
 * R_Sync's LokiJS store already tracks the TRANSPORT view of each worker
 * (tunnel keys, ip/port, lastHeartbeat). This registry layers the ORION view on
 * top: which service the node runs, its latest system-status snapshot, and its
 * recent alert history. The two views are merged by workerId in
 * OrionOrchestrator.getClusterStatus().
 */

const ALERT_HISTORY_LIMIT = 50;

class NodeRegistry {
    constructor() {
        this._nodes = new Map();
    }

    _ensure(workerId) {
        if (!this._nodes.has(workerId)) {
            this._nodes.set(workerId, {
                workerId,
                hello: null,
                lastStatus: null,
                lastStatusAt: null,
                lastSeen: null,
                online: false,
                offlineReason: null,
                alerts: []
            });
        }
        return this._nodes.get(workerId);
    }

    /** Any authenticated event from the node proves liveness */
    touch(workerId, unixTime) {
        const node = this._ensure(workerId);
        node.lastSeen = unixTime;
        node.online = true;
        node.offlineReason = null;
        return node;
    }

    recordHello(workerId, helloData, unixTime) {
        const node = this.touch(workerId, unixTime);
        node.hello = helloData || null;
        return node;
    }

    recordStatus(workerId, statusData, unixTime) {
        const node = this.touch(workerId, unixTime);
        node.lastStatus = statusData || null;
        node.lastStatusAt = unixTime;
        return node;
    }

    recordAlert(workerId, alertData, unixTime) {
        const node = this.touch(workerId, unixTime);
        node.alerts.push({ ...alertData, receivedAt: unixTime });
        if (node.alerts.length > ALERT_HISTORY_LIMIT) {
            node.alerts.splice(0, node.alerts.length - ALERT_HISTORY_LIMIT);
        }
        return node;
    }

    markOffline(workerId, reason) {
        const node = this._ensure(workerId);
        node.online = false;
        node.offlineReason = reason || 'unknown';
        return node;
    }

    getNode(workerId) {
        return this._nodes.get(workerId) || null;
    }

    getNodes() {
        return [...this._nodes.values()];
    }

    /**
     * Marks nodes that have not been seen within `staleAfterSeconds` as offline.
     * Returns the nodes that flipped online → offline on THIS sweep so the
     * caller can raise a NODE_STALE alert exactly once per outage.
     */
    sweepStale(staleAfterSeconds, nowUnix) {
        const flipped = [];
        for (const node of this._nodes.values()) {
            if (!node.online || node.lastSeen === null) continue;
            if (nowUnix - node.lastSeen > staleAfterSeconds) {
                node.online = false;
                node.offlineReason = 'stale';
                flipped.push(node);
            }
        }
        return flipped;
    }

    summarize() {
        const nodes = this.getNodes();
        return {
            total: nodes.length,
            online: nodes.filter(n => n.online).length,
            offline: nodes.filter(n => !n.online).length
        };
    }

    /**
     * Rehydrates persisted records (orchestrator restart). Restored nodes are
     * ALWAYS offline ('orch-restart') until they prove liveness again —
     * persisted knowledge is identity, never current truth.
     */
    hydrate(records) {
        for (const record of records || []) {
            if (!record?.workerId || this._nodes.has(record.workerId)) continue;
            this._nodes.set(record.workerId, {
                workerId: record.workerId,
                hello: record.hello || null,
                lastStatus: null,
                lastStatusAt: record.lastStatusAt || null,
                lastSeen: record.lastSeen || null,
                online: false,
                offlineReason: 'orch-restart',
                alerts: Array.isArray(record.alerts) ? record.alerts : []
            });
        }
        return this._nodes.size;
    }
}

export { NodeRegistry, ALERT_HISTORY_LIMIT };
