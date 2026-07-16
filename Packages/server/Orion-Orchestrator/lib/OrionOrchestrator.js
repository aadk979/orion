/**
 * OrionOrchestrator — the Orion cluster control plane.
 *
 * Wraps an R_Sync ORCHESTRATOR instance and speaks the Orion cluster protocol
 * (lib/protocol.js) with every Orion-core node whose ClusterLinkSystem is
 * enabled. Subsystems:
 *
 *   - NodeRegistry (+ RegistryStore): identity, status, alert history per node —
 *     persisted across orchestrator restarts and rehydrated on boot
 *   - CommandDispatcher: awaitable remote commands with correlation + timeouts,
 *     every execution recorded in a command audit ring
 *   - PolicyEngine: declarative alert → reaction rules (verify, escalate,
 *     command, consensus, delayed remediation) with per-node cooldowns
 *   - ConsensusEngine: quorum votes evaluated by the fleet's own local views
 *   - ClusterHealth: FORMING/HEALTHY/DEGRADED/INCIDENT state machine; INCIDENT
 *     entry is consensus-confirmed (configurable) and every transition is
 *     escalated AND broadcast to all nodes (CLUSTER_STATE)
 *   - EscalationHub: pluggable notification channels (log always, webhook via
 *     config, custom via addEscalationChannel) with ring-buffer history
 *
 * One orchestrator process per cluster; R_Sync enforces the singleton.
 */

import { R_Sync, getAllWorkers, getWorkerById, valueGeneratorExports, logger } from 'r-sync';
import { NodeRegistry } from './NodeRegistry.js';
import { CommandDispatcher, DEFAULT_COMMAND_TIMEOUT_MS } from './CommandDispatcher.js';
import { PolicyEngine } from './PolicyEngine.js';
import { ConsensusEngine } from './ConsensusEngine.js';
import { ClusterHealth } from './ClusterHealth.js';
import { EscalationHub } from './EscalationHub.js';
import { RegistryStore } from './RegistryStore.js';
import {
    PROTOCOL_VERSION,
    ClusterEvents,
    ClusterCommands,
    ClusterAlerts,
    ClusterStates,
    ConsensusTopics,
    buildAlert,
    buildClusterState
} from './protocol.js';
import { __Version__ } from './orch.meta.js';

const { generateId } = valueGeneratorExports;

const getCurrentUnixTime = () => Math.floor(Date.now() / 1000);

// R_Sync stores worker status lowercase ('active'); compare case-insensitively
// so a transport-side casing change can never silently empty the fleet.
const isActiveWorker = (w) => String(w?.status).toUpperCase() === 'ACTIVE';

const COMMAND_LOG_LIMIT = 200;

const defaultConfig = Object.freeze({
    publicIp: '127.0.0.1',
    port: 55321,
    encryptionAlg: 'ECC_256',
    trustAdvertisedWorkerIp: false,
    /** Node flagged stale when silent for this long (transport heartbeats count) */
    nodeStaleAfterSeconds: 120,
    /** How often the stale sweep runs */
    staleSweepIntervalMs: 30_000,
    commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    /** Cluster health evaluation cadence */
    healthEvaluationIntervalMs: 15_000,
    /** Ask the fleet to confirm (consensus on NODE_HEALTHY) before declaring INCIDENT */
    confirmIncidentViaConsensus: true,
    /** Re-request hello from live nodes after a restart so the registry rehydrates */
    identifyOnStart: true,
    identifyTimeoutMs: 5_000,
    /** Sub-system configs — see each module */
    health: {},                    // ClusterHealth
    consensus: {},                 // default { quorumRatio, minVoters, timeoutMs } for proposals
    policies: {},                  // PolicyEngine { useDefaults, rules }
    escalations: {},               // EscalationHub { webhook: { url, headers } }
    persistence: { enabled: true } // RegistryStore { enabled, directory, fileName, debounceMs }
});

class OrionOrchestrator {

    constructor(config = {}) {
        if (!config.cluster) {
            throw new Error('Configuration error: OrionOrchestrator requires a cluster name');
        }

        this.config = { ...defaultConfig, ...config };
        this.cluster = this.config.cluster;

        this.rsync = null;
        this.started = false;

        this._registry = new NodeRegistry();
        this._dispatcher = null;
        this._staleSweepTimer = null;
        this._healthTimer = null;
        this._commandLog = [];

        // ── Subsystems ────────────────────────────────────────────────────────
        this._escalations = new EscalationHub(this.config.escalations);
        this._health = new ClusterHealth(this.config.health);
        this._store = (this.config.persistence?.enabled ?? true)
            ? new RegistryStore(this.config.persistence)
            : null;

        this._consensus = new ConsensusEngine(
            (workerId, action, args, timeoutMs) => this.command(workerId, action, args, timeoutMs),
            async () => (await getAllWorkers()).filter(isActiveWorker)
        );

        this._policies = new PolicyEngine(
            {
                escalate: (escalation) => this._escalations.raise(escalation),
                command: (workerId, action, args, timeoutMs) => this.command(workerId, action, args, timeoutMs),
                consensus: (topic, params, options) => this.proposeConsensus(topic, params, options)
            },
            this.config.policies
        );

        // Hook arrays — node hooks receive (workerId, payload, node);
        // clusterState hooks receive (state, previousState, evaluation)
        this._hooks = {
            hello: [],
            status: [],
            alert: [],
            goodbye: [],
            event: [],
            clusterState: []
        };
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async start() {
        if (this.started) return this;

        // Rehydrate identity knowledge from the last run — nodes come back
        // OFFLINE until they prove liveness.
        if (this._store) {
            const restored = this._registry.hydrate(await this._store.load());
            if (restored > 0) {
                logger.info(`OrionOrchestrator: rehydrated ${restored} node record(s) from disk`);
            }
        }

        this.rsync = new R_Sync({
            role: 'ORCHESTRATOR',
            cluster: this.cluster,
            publicIp: this.config.publicIp,
            port: this.config.port,
            encryptionAlg: this.config.encryptionAlg,
            trustAdvertisedWorkerIp: this.config.trustAdvertisedWorkerIp
        });

        this._dispatcher = new CommandDispatcher(
            (workerId, eventName, data) => this.rsync.sendTo(workerId, eventName, data),
            () => generateId('CMD', 16)
        );

        this.rsync.onWorkerEvent((workerId, event) => this._routeWorkerEvent(workerId, event));

        await this.rsync.startOrchestrator();
        this.started = true;

        this._staleSweepTimer = setInterval(() => this._sweepStaleNodes(), this.config.staleSweepIntervalMs);
        this._healthTimer = setInterval(() => {
            this._evaluateHealth().catch(err => logger.error(`OrionOrchestrator: health evaluation error — ${err.message}`));
        }, this.config.healthEvaluationIntervalMs);

        // Nodes that survived our restart still hold live tunnels — ask them to
        // re-identify so the registry regains identity + liveness immediately.
        if (this.config.identifyOnStart) {
            this._identifySweep().catch(err => logger.warn(`OrionOrchestrator: identify sweep failed — ${err.message}`));
        }

        logger.info(`OrionOrchestrator v${__Version__} ready — cluster "${this.cluster}" on ${this.config.publicIp}:${this.config.port} (protocol v${PROTOCOL_VERSION})`);
        return this;
    }

    async stop() {
        if (this._staleSweepTimer) {
            clearInterval(this._staleSweepTimer);
            this._staleSweepTimer = null;
        }
        if (this._healthTimer) {
            clearInterval(this._healthTimer);
            this._healthTimer = null;
        }

        this._policies.stop();

        if (this._dispatcher) {
            this._dispatcher.clear('Orchestrator stopping');
        }

        if (this._store) {
            try {
                await this._store.flush(() => this._registry.getNodes());
            } catch (err) {
                logger.warn(`OrionOrchestrator: final registry persist failed — ${err.message}`);
            }
        }

        if (this.rsync) {
            await this.rsync.stop();
            this.rsync = null;
        }

        this.started = false;
        logger.info('OrionOrchestrator stopped');
    }

    async _identifySweep() {
        const workers = (await getAllWorkers()).filter(isActiveWorker);
        if (workers.length === 0) return;

        logger.info(`OrionOrchestrator: identify sweep across ${workers.length} live tunnel(s)`);
        const results = await Promise.allSettled(
            workers.map(w => this.command(w.id, ClusterCommands.IDENTIFY, {}, this.config.identifyTimeoutMs))
        );

        const now = getCurrentUnixTime();
        results.forEach((res, i) => {
            if (res.status === 'fulfilled' && res.value?.ok === true && res.value.result) {
                this._registry.recordHello(workers[i].id, res.value.result, now);
            }
        });
        this._persist();
    }

    _persist() {
        if (this._store) {
            this._store.schedulePersist(() => this._registry.getNodes());
        }
    }

    // ── Event routing ─────────────────────────────────────────────────────────

    async _routeWorkerEvent(workerId, event) {
        const now = getCurrentUnixTime();

        try {
            const wasOffline = this._registry.getNode(workerId)?.online === false;

            switch (event.name) {
                case ClusterEvents.NODE_HELLO: {
                    const node = this._registry.recordHello(workerId, event.data, now);
                    logger.info(`Cluster node online: ${workerId} (${event.data?.appName || 'unnamed'} / ${event.data?.serviceID || 'no service id'})`);
                    this._invokeHooks('hello', workerId, event.data, node);
                    if (wasOffline) await this._raiseRecovery(workerId, node);
                    this._persist();
                    break;
                }
                case ClusterEvents.NODE_STATUS: {
                    const node = this._registry.recordStatus(workerId, event.data, now);
                    this._invokeHooks('status', workerId, event.data, node);
                    if (wasOffline) await this._raiseRecovery(workerId, node);
                    this._persist();
                    break;
                }
                case ClusterEvents.NODE_ALERT: {
                    const node = this._registry.recordAlert(workerId, event.data, now);
                    logger.warn(`Cluster alert from ${workerId}: ${event.data?.type} (${event.data?.severity})`);
                    this._invokeHooks('alert', workerId, event.data, node);
                    await this._policies.handleAlert(workerId, event.data, node);
                    this._persist();
                    break;
                }
                case ClusterEvents.NODE_GOODBYE: {
                    const node = this._registry.markOffline(workerId, event.data?.reason || 'graceful-shutdown');
                    logger.info(`Cluster node leaving: ${workerId} (${event.data?.reason || 'graceful-shutdown'})`);
                    this._invokeHooks('goodbye', workerId, event.data, node);
                    this._persist();
                    break;
                }
                case ClusterEvents.COMMAND_RESULT: {
                    this._registry.touch(workerId, now);
                    const matched = this._dispatcher.resolveResult(workerId, event.data);
                    if (!matched) {
                        logger.warn(`Unmatched command result from ${workerId} (commandId: ${event.data?.commandId || 'none'})`);
                    }
                    break;
                }
                default: {
                    // Application-defined traffic — surface it, never swallow it
                    const node = this._registry.touch(workerId, now);
                    this._invokeHooks('event', workerId, event, node);
                }
            }
        } catch (err) {
            logger.error(`OrionOrchestrator event routing error (${event?.name} from ${workerId}): ${err.message}`);
        }
    }

    async _raiseRecovery(workerId, node) {
        const alert = buildAlert(ClusterAlerts.NODE_RECOVERED, 'info', {
            workerId,
            offlineReason: node.offlineReason
        });
        this._registry.recordAlert(workerId, alert, getCurrentUnixTime());
        this._invokeHooks('alert', workerId, alert, node);
        await this._policies.handleAlert(workerId, alert, node);
    }

    _invokeHooks(kind, ...args) {
        for (const hook of this._hooks[kind]) {
            try {
                hook(...args);
            } catch (err) {
                logger.error(`OrionOrchestrator "${kind}" hook error: ${err.message}`);
            }
        }
    }

    async _sweepStaleNodes() {
        const flipped = this._registry.sweepStale(this.config.nodeStaleAfterSeconds, getCurrentUnixTime());
        for (const node of flipped) {
            logger.warn(`Cluster node stale: ${node.workerId} — no contact for ${this.config.nodeStaleAfterSeconds}s`);
            const alert = buildAlert(ClusterAlerts.NODE_STALE, 'critical', {
                workerId: node.workerId,
                lastSeen: node.lastSeen
            });
            this._registry.recordAlert(node.workerId, alert, getCurrentUnixTime());
            this._invokeHooks('alert', node.workerId, alert, node);
            await this._policies.handleAlert(node.workerId, alert, node);
        }
        if (flipped.length > 0) this._persist();
    }

    // ── Cluster health ────────────────────────────────────────────────────────

    async _evaluateHealth() {
        if (!this.started) return;

        const evaluation = this._health.evaluate(this._registry.getNodes(), getCurrentUnixTime());
        let targetState = evaluation.targetState;

        // INCIDENT is a big claim from one observer — before declaring it, ask
        // the reachable fleet whether it agrees it is unhealthy. If a quorum
        // affirms NODE_HEALTHY, the registry view is skewed: hold at DEGRADED.
        if (
            targetState === ClusterStates.INCIDENT &&
            this._health.state !== ClusterStates.INCIDENT &&
            this.config.confirmIncidentViaConsensus
        ) {
            try {
                const vote = await this.proposeConsensus(ConsensusTopics.NODE_HEALTHY, {}, this.config.consensus);
                evaluation.consensus = { decided: vote.decided, accepted: vote.accepted, ratio: vote.ratio };
                if (vote.decided && vote.accepted) {
                    targetState = ClusterStates.DEGRADED;
                }
                // Undecided (fleet unreachable) counts FOR the incident — silence
                // is exactly what a real incident looks like.
            } catch (err) {
                logger.warn(`OrionOrchestrator: incident-confirmation vote failed (${err.message}) — proceeding on registry evidence`);
            }
        }

        const previous = this._health.transitionTo(targetState);
        if (previous === null) return;

        const severity = targetState === ClusterStates.INCIDENT ? 'critical'
            : targetState === ClusterStates.DEGRADED ? 'warning' : 'info';

        await this._escalations.raise({
            type: ClusterAlerts.CLUSTER_STATE_CHANGED,
            severity,
            message: `Cluster health: ${previous} → ${targetState} (${evaluation.unhealthy.length}/${evaluation.total} nodes unhealthy)`,
            details: evaluation
        });

        this._invokeHooks('clusterState', targetState, previous, evaluation);

        // Keep the fleet in the loop — every node learns the cluster state
        try {
            await this.rsync.broadcast(
                ClusterEvents.CLUSTER_STATE,
                buildClusterState(targetState, previous, {
                    total: evaluation.total,
                    unhealthy: evaluation.unhealthy.length,
                    ratio: evaluation.ratio
                })
            );
        } catch (err) {
            logger.warn(`OrionOrchestrator: cluster-state broadcast failed — ${err.message}`);
        }
    }

    /** Manual override — force INCIDENT (e.g. operator knows something the fleet doesn't). */
    async declareIncident(reason = 'manual') {
        const previous = this._health.transitionTo(ClusterStates.INCIDENT);
        if (previous !== null) {
            await this._escalations.raise({
                type: ClusterAlerts.CLUSTER_STATE_CHANGED,
                severity: 'critical',
                message: `Cluster INCIDENT declared manually: ${reason}`,
                details: { reason, previous }
            });
            this._invokeHooks('clusterState', ClusterStates.INCIDENT, previous, { manual: true, reason });
            try {
                await this.rsync.broadcast(ClusterEvents.CLUSTER_STATE, buildClusterState(ClusterStates.INCIDENT, previous, { manual: true, reason }));
            } catch (err) {
                logger.warn(`OrionOrchestrator: cluster-state broadcast failed — ${err.message}`);
            }
        }
        return this._health.getSnapshot();
    }

    /** Manual override — clear a manual/stuck INCIDENT; next evaluation recomputes honestly. */
    async resolveIncident(reason = 'manual') {
        if (this._health.state !== ClusterStates.INCIDENT) return this._health.getSnapshot();
        await this._evaluateHealthAfterManualResolve(reason);
        return this._health.getSnapshot();
    }

    async _evaluateHealthAfterManualResolve(reason) {
        const evaluation = this._health.evaluate(this._registry.getNodes(), getCurrentUnixTime());
        // Manual resolve never lands back on INCIDENT — cap at DEGRADED and let
        // the periodic evaluation re-escalate if the fleet is truly still down.
        const target = evaluation.targetState === ClusterStates.INCIDENT ? ClusterStates.DEGRADED : evaluation.targetState;
        const previous = this._health.transitionTo(target);
        if (previous !== null) {
            await this._escalations.raise({
                type: ClusterAlerts.CLUSTER_STATE_CHANGED,
                severity: 'info',
                message: `Cluster INCIDENT resolved manually: ${reason} (now ${target})`,
                details: { reason, evaluation }
            });
            this._invokeHooks('clusterState', target, previous, evaluation);
            try {
                await this.rsync.broadcast(ClusterEvents.CLUSTER_STATE, buildClusterState(target, previous, { manual: true, reason }));
            } catch (err) {
                logger.warn(`OrionOrchestrator: cluster-state broadcast failed — ${err.message}`);
            }
        }
    }

    // ── Hooks ─────────────────────────────────────────────────────────────────

    onNodeHello(cb) { this._addHook('hello', cb); return this; }
    onNodeStatus(cb) { this._addHook('status', cb); return this; }
    onNodeAlert(cb) { this._addHook('alert', cb); return this; }
    onNodeGoodbye(cb) { this._addHook('goodbye', cb); return this; }
    /** Any node event that is not part of the cluster protocol */
    onNodeEvent(cb) { this._addHook('event', cb); return this; }
    /** Cluster health transitions — (state, previousState, evaluation) */
    onClusterStateChange(cb) { this._addHook('clusterState', cb); return this; }

    _addHook(kind, cb) {
        if (typeof cb !== 'function') {
            throw new Error(`OrionOrchestrator: "${kind}" hook must be a function`);
        }
        this._hooks[kind].push(cb);
    }

    /** Register an additional escalation channel (Slack, PagerDuty, ...) */
    addEscalationChannel(name, handler) {
        this._escalations.addChannel(name, handler);
        return this;
    }

    // ── Command & control ─────────────────────────────────────────────────────

    /**
     * Executes a remote command on one node and awaits its result.
     * Every execution (success or failure) lands in the command audit log.
     * @returns {Promise<{workerId, commandId, action, ok, result?, error?}>}
     */
    async command(workerId, action, args = {}, timeoutMs = this.config.commandTimeoutMs) {
        this._assertStarted();

        try {
            const outcome = await this._dispatcher.execute(workerId, action, args, timeoutMs);
            this._logCommand({ workerId, action, ok: outcome.ok === true, commandId: outcome.commandId || null });
            return outcome;
        } catch (err) {
            this._logCommand({ workerId, action, ok: false, error: err.message });
            throw err;
        }
    }

    _logCommand(entry) {
        this._commandLog.push({ ...entry, at: getCurrentUnixTime() });
        if (this._commandLog.length > COMMAND_LOG_LIMIT) {
            this._commandLog.splice(0, this._commandLog.length - COMMAND_LOG_LIMIT);
        }
    }

    /**
     * Executes a remote command on every ACTIVE node in parallel.
     * Never rejects — per-node failures are reported in the result array.
     * @returns {Promise<Array<{workerId, ok, ...}>>}
     */
    async commandAll(action, args = {}, timeoutMs = this.config.commandTimeoutMs) {
        this._assertStarted();

        const workers = (await getAllWorkers()).filter(isActiveWorker);
        const settled = await Promise.allSettled(
            workers.map(w => this.command(w.id, action, args, timeoutMs))
        );

        return settled.map((res, i) => res.status === 'fulfilled'
            ? res.value
            : { workerId: workers[i].id, ok: false, error: { message: res.reason?.message || 'Command failed' } }
        );
    }

    /** Runs a fleet consensus vote — see ConsensusEngine.propose */
    async proposeConsensus(topic, params = {}, options = {}) {
        this._assertStarted();
        return this._consensus.propose(topic, params, { ...this.config.consensus, ...options });
    }

    /** Raw event passthroughs for application-defined traffic */
    async sendEvent(workerId, eventName, data = {}) {
        this._assertStarted();
        return this.rsync.sendTo(workerId, eventName, data);
    }

    async broadcastEvent(eventName, data = {}) {
        this._assertStarted();
        return this.rsync.broadcast(eventName, data);
    }

    // ── Convenience wrappers over common commands ─────────────────────────────

    pingNode(workerId) { return this.command(workerId, ClusterCommands.PING); }
    getNodeStatus(workerId) { return this.command(workerId, ClusterCommands.GET_STATUS); }
    lockNode(workerId) { return this.command(workerId, ClusterCommands.LOCK_SERVER); }
    unlockNode(workerId) { return this.command(workerId, ClusterCommands.UNLOCK_SERVER); }
    lockCluster() { return this.commandAll(ClusterCommands.LOCK_SERVER); }
    unlockCluster() { return this.commandAll(ClusterCommands.UNLOCK_SERVER); }
    clearNodeEtsLockdown(workerId) { return this.command(workerId, ClusterCommands.CLEAR_ETS_LOCKDOWN); }
    /** Push additional allowed client URLs to every node that permits runtime updates */
    addClientUrls(clientUrls) { return this.commandAll(ClusterCommands.ADD_CLIENT_URLS, { clientUrls }); }

    // ── Observability ─────────────────────────────────────────────────────────

    getNode(workerId) {
        return this._registry.getNode(workerId);
    }

    getNodes() {
        return this._registry.getNodes();
    }

    getClusterHealth() {
        return this._health.getSnapshot();
    }

    getEscalations(limit = 50) {
        return this._escalations.getHistory(limit);
    }

    getConsensusHistory(limit = 10) {
        return this._consensus.getHistory(limit);
    }

    getPolicyOutcomes(limit = 20) {
        return this._policies.getOutcomes(limit);
    }

    getPolicyRules() {
        return this._policies.getRules();
    }

    getCommandLog(limit = 50) {
        return this._commandLog.slice(-limit);
    }

    /**
     * Merged cluster view: R_Sync transport records (heartbeats, addresses)
     * joined with the Orion application registry (identity, status, alerts),
     * plus health, escalation, and command-plane summaries.
     */
    async getClusterStatus() {
        this._assertStarted();

        const transportWorkers = await getAllWorkers();
        const transportById = new Map(transportWorkers.map(w => [w.id, w]));
        const registryNodes = this._registry.getNodes();
        const registryById = new Map(registryNodes.map(n => [n.workerId, n]));

        const allIds = new Set([...transportById.keys(), ...registryById.keys()]);

        const nodes = [...allIds].map(id => {
            const transport = transportById.get(id) || null;
            const app = registryById.get(id) || null;

            return {
                workerId: id,
                online: app?.online ?? isActiveWorker(transport),
                offlineReason: app?.offlineReason || null,
                unhealthyReason: app ? this._health.isNodeUnhealthy(app, getCurrentUnixTime()) : null,
                transport: transport ? {
                    status: transport.status,
                    ip: transport.ip,
                    port: transport.port,
                    registeredAt: transport.registeredAt,
                    lastHeartbeat: transport.lastHeartbeat
                } : null,
                identity: app?.hello || null,
                lastStatus: app?.lastStatus || null,
                lastStatusAt: app?.lastStatusAt || null,
                lastSeen: app?.lastSeen || null,
                recentAlerts: app?.alerts?.slice(-5) || []
            };
        });

        return {
            cluster: this.cluster,
            orchestratorId: this.rsync?.orchestratorId || null,
            protocolVersion: PROTOCOL_VERSION,
            generatedAt: getCurrentUnixTime(),
            health: this._health.getSnapshot(),
            summary: {
                total: nodes.length,
                online: nodes.filter(n => n.online).length,
                offline: nodes.filter(n => !n.online).length,
                unhealthy: nodes.filter(n => n.unhealthyReason).length,
                pendingCommands: this._dispatcher?.pendingCount || 0,
                escalations: this._escalations.getCounts()
            },
            nodes
        };
    }

    async getTransportWorker(workerId) {
        return getWorkerById(workerId);
    }

    _assertStarted() {
        if (!this.started) {
            throw new Error('OrionOrchestrator not started. Call start() first');
        }
    }
}

export { OrionOrchestrator };
