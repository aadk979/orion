// logger MUST be imported before GlobalAccessPoint: the two modules are
// circular, and the cycle only resolves cleanly when logger's chain loads
// first (matters when this file is the module-graph entry, e.g. in tests).
import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { getCurrentUnixTime } from '../Date&Time.js';
import { validateClientUrls } from '../Validator.js';
import { __Version__ } from '../../orion.meta.js';

/**
 * ClusterLinkSystem — Orion-core's connection to the Orion-Orchestrator
 * control plane.
 *
 * When enabled, the node embeds an R_Sync WORKER, registers with the cluster's
 * orchestrator over an encrypted tunnel, and from then on:
 *
 *   - announces itself (NODE_HELLO) with service identity metadata
 *   - pushes periodic OrionSystemsControl.getSystemStatus() snapshots (NODE_STATUS)
 *   - watches operational flags on a FAST interval and raises edge-triggered
 *     NODE_ALERTs the moment they flip (ETS lockdown, event-loop degradation,
 *     server lock, memory pressure) — alert latency is the watch interval,
 *     not the status-report interval
 *   - executes allowlisted remote commands (orion:command) against
 *     OrionSystemsControl and answers with orion:command:result
 *   - casts consensus ballots (consensus:vote) evaluated against its LOCAL view
 *   - answers identify requests so the orchestrator can rebuild its registry
 *     after a restart
 *   - tracks the orchestrator's CLUSTER_STATE broadcasts in the GAP
 *     (`clusterState`) so the host application always knows fleet health
 *   - self-heals a desynced tunnel: after N consecutive delivery failures it
 *     re-registers from scratch (same persistent identity key) and raises a
 *     TUNNEL_RESYNCED alert
 *
 * Both `r-sync` and the `orion-orch` protocol module are imported dynamically
 * inside start(), so deployments that never enable clustering pay no cost and
 * need no cluster dependencies at boot.
 *
 * Remote control is DOUBLE-gated: the link must be configured with
 * `allowRemoteControl: true`, and OrionSystemsControl safe mode still applies
 * to every mutating action — a safe-mode refusal reports `{ applied: false }`
 * back to the orchestrator instead of performing the change.
 */

const RETRY_BASE_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 300_000;

const defaultConfig = Object.freeze({
    enabled: false,
    cluster: null,
    orchestratorIp: '127.0.0.1',
    orchestratorPort: 55321,
    publicIp: '127.0.0.1',
    port: 55322,
    encryptionAlg: 'ECC_256',
    heartbeatIntervalMs: 30_000,
    statusReportIntervalMs: 60_000,
    /** Operational-flag watch cadence (alert latency ceiling). 0 disables the fast watcher. */
    flagWatchIntervalMs: 2_000,
    /** System memory usage (%) at which this node reports memory pressure */
    memoryPressureThresholdPercent: 80,
    /** Consecutive delivery failures before the tunnel is considered desynced and re-registered */
    reRegisterAfterFailures: 3,
    allowRemoteControl: true,
    /** When true, an unreachable orchestrator FAILS the Orion boot */
    requireOrchestrator: false
});

class ClusterLinkSystem {

    constructor(config = {}) {
        this.config = { ...defaultConfig, ...config };
        this.enabled = this.config.enabled === true;

        this.rsync = null;
        this.rsyncModule = null;
        this.protocol = null;
        this.connected = false;
        this.stopping = false;

        this._statusTimer = null;
        this._flagWatchTimer = null;
        this._retryTimer = null;
        this._retryAttempt = 0;

        this._handlerRegistered = false;
        this._reRegistering = false;
        this._consecutiveEmitFailures = 0;

        // Previous operational flags for edge-triggered alerting (shared by the
        // fast watcher and the status reporter so an edge is alerted exactly once)
        this._lastFlags = null;

        // Counters surfaced via getStats()
        this._stats = {
            statusReportsSent: 0,
            statusReportFailures: 0,
            commandsExecuted: 0,
            commandsRejected: 0,
            alertsSent: 0,
            votesCast: 0,
            tunnelResyncs: 0
        };

        // Application-defined handlers for non-command orchestrator events
        this._customHandlers = [];

        if (this.enabled && !this.config.cluster) {
            throw new Error('Configuration error: clusterLink.enabled requires clusterLink.cluster');
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async start() {
        if (!this.enabled) {
            return false;
        }

        // Both packages resolve from Orion-core's own dependencies; loading them
        // lazily keeps non-clustered deployments free of the requirement.
        const [rsyncModule, protocolModule] = await Promise.all([
            import('r-sync'),
            import('orion-orch/protocol')
        ]);

        this.rsyncModule = rsyncModule;
        this.protocol = protocolModule;

        this._createTransport();

        try {
            await this._connect();
        } catch (err) {
            if (this.config.requireOrchestrator) {
                throw new Error(`ClusterLink: required orchestrator unreachable — ${err.message}`);
            }
            logger.warn(`ClusterLink: orchestrator unreachable at boot (${err.message}) — retrying in background`);
            this._scheduleRetry();
        }

        return true;
    }

    _createTransport() {
        this.rsync = new this.rsyncModule.R_Sync({
            role: 'WORKER',
            cluster: this.config.cluster,
            publicIp: this.config.publicIp,
            port: this.config.port,
            orchestratorIp: this.config.orchestratorIp,
            orchestratorPort: this.config.orchestratorPort,
            encryptionAlg: this.config.encryptionAlg,
            heartbeatIntervalMs: this.config.heartbeatIntervalMs,
            // Embedded semantics: registration failures must never kill the
            // auth server — we retry in the background instead.
            exitOnBootFailure: false
        });

        // R_Sync keeps event handlers in module-level state that survives
        // transport re-creation — register exactly once or every re-registration
        // would add a duplicate handler.
        if (!this._handlerRegistered) {
            this.rsync.onEvent((event) => this._handleOrchestratorEvent(event));
            this._handlerRegistered = true;
        }
    }

    async _connect() {
        await this.rsync.startWorker();
        this.connected = true;
        this._retryAttempt = 0;
        this._consecutiveEmitFailures = 0;

        logger.info(`ClusterLink: joined cluster "${this.config.cluster}" as ${this.rsync.workerId}`);

        await this._sendHello();
        this._startStatusReporting();
        this._startFlagWatcher();
    }

    _scheduleRetry() {
        if (this.stopping || this._retryTimer) return;

        const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** this._retryAttempt, RETRY_MAX_DELAY_MS);
        this._retryAttempt += 1;

        this._retryTimer = setTimeout(async () => {
            this._retryTimer = null;
            if (this.stopping) return;

            try {
                await this._connect();
            } catch (err) {
                logger.warn(`ClusterLink: reconnect attempt ${this._retryAttempt} failed (${err.message})`);
                this._scheduleRetry();
            }
        }, delay);

        logger.info(`ClusterLink: next registration attempt in ${Math.round(delay / 1000)}s`);
    }

    /**
     * Full tunnel re-registration for a desynced session (e.g. the orchestrator
     * lost its key store and now rejects our signatures). The persistent
     * identity key survives, so the orchestrator re-admits us under the same
     * workerId; only the session keys rotate.
     */
    async _reRegisterTransport(cause) {
        if (this._reRegistering || this.stopping) return;
        this._reRegistering = true;
        this.connected = false;

        logger.warn(`ClusterLink: tunnel desync suspected (${cause}) — re-registering with orchestrator`);

        try {
            try {
                await this.rsync.stop();
            } catch (err) {
                logger.warn(`ClusterLink: old transport stop error — ${err.message}`);
            }

            this._createTransport();
            await this._connect();

            this._stats.tunnelResyncs += 1;

            try {
                await this.rsync.emitToOrchestrator(
                    this.protocol.ClusterEvents.NODE_ALERT,
                    this.protocol.buildAlert(this.protocol.ClusterAlerts.TUNNEL_RESYNCED, 'warning', { cause })
                );
                this._stats.alertsSent += 1;
            } catch (err) {
                logger.warn(`ClusterLink: resync alert not delivered — ${err.message}`);
            }
        } catch (err) {
            logger.error(`ClusterLink: re-registration failed (${err.message}) — falling back to retry loop`);
            this._scheduleRetry();
        } finally {
            this._reRegistering = false;
        }
    }

    _trackEmitFailure() {
        this._consecutiveEmitFailures += 1;
        if (
            this.config.reRegisterAfterFailures > 0 &&
            this._consecutiveEmitFailures >= this.config.reRegisterAfterFailures &&
            this.connected && !this._reRegistering
        ) {
            this._consecutiveEmitFailures = 0;
            // Fire-and-forget: re-registration must not block the caller's cycle
            this._reRegisterTransport(`${this.config.reRegisterAfterFailures} consecutive delivery failures`)
                .catch(err => logger.error(`ClusterLink: re-registration error — ${err.message}`));
        }
    }

    _trackEmitSuccess() {
        this._consecutiveEmitFailures = 0;
    }

    async stop(reason = 'graceful-shutdown') {
        this.stopping = true;

        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
        if (this._statusTimer) {
            clearInterval(this._statusTimer);
            this._statusTimer = null;
        }
        if (this._flagWatchTimer) {
            clearInterval(this._flagWatchTimer);
            this._flagWatchTimer = null;
        }

        if (this.connected && this.rsync) {
            // Best-effort goodbye so the orchestrator marks us offline instantly
            // instead of waiting for the stale sweep.
            try {
                await this.rsync.emitToOrchestrator(this.protocol.ClusterEvents.NODE_GOODBYE, { reason });
            } catch (err) {
                logger.warn(`ClusterLink: goodbye not delivered — ${err.message}`);
            }
        }

        if (this.rsync) {
            try {
                await this.rsync.stop();
            } catch (err) {
                logger.warn(`ClusterLink: transport stop error — ${err.message}`);
            }
            this.rsync = null;
        }

        this.connected = false;
        logger.info('ClusterLink: stopped');
    }

    // ── Outbound reporting ────────────────────────────────────────────────────

    _buildHello() {
        const systemConfig = globalAccessPoint.systemConfig();

        return {
            serviceID: systemConfig?.app?.serviceID || null,
            appName: systemConfig?.app?.appName || 'Unnamed',
            apiPort: systemConfig?.app?.port || null,
            orionVersion: __Version__,
            nodeVersion: process.version,
            pid: process.pid,
            startedAt: globalAccessPoint.timeOfLife() || null,
            clusterMode: !!globalAccessPoint.clusterMode(),
            allowRemoteControl: this.config.allowRemoteControl === true
        };
    }

    async _sendHello() {
        try {
            await this.rsync.emitToOrchestrator(this.protocol.ClusterEvents.NODE_HELLO, this._buildHello());
            this._trackEmitSuccess();
        } catch (err) {
            logger.warn(`ClusterLink: hello not delivered — ${err.message}`);
            this._trackEmitFailure();
        }
    }

    _startStatusReporting() {
        if (this._statusTimer) clearInterval(this._statusTimer);

        this._statusTimer = setInterval(() => {
            this._reportStatus().catch(err => {
                logger.warn(`ClusterLink: status report cycle error — ${err.message}`);
            });
        }, this.config.statusReportIntervalMs);

        // First snapshot immediately so the orchestrator isn't blind for a full interval
        this._reportStatus().catch(err => {
            logger.warn(`ClusterLink: initial status report error — ${err.message}`);
        });
    }

    _startFlagWatcher() {
        if (this._flagWatchTimer) clearInterval(this._flagWatchTimer);
        if (!this.config.flagWatchIntervalMs || this.config.flagWatchIntervalMs <= 0) return;

        this._flagWatchTimer = setInterval(() => {
            this._watchFlags().catch(err => {
                logger.warn(`ClusterLink: flag watch cycle error — ${err.message}`);
            });
        }, this.config.flagWatchIntervalMs);
    }

    async _watchFlags() {
        if (!this.connected || this.stopping) return;

        const systemsControl = globalAccessPoint.getValue('orionSystemsControl');
        if (!systemsControl) return;

        await this._detectAndSendAlerts(systemsControl.getSystemStatus());
    }

    async _reportStatus() {
        if (!this.connected || this.stopping) return;

        const systemsControl = globalAccessPoint.getValue('orionSystemsControl');
        if (!systemsControl) return;

        const status = systemsControl.getSystemStatus();

        // Edge-triggered alerts ride on the same snapshot the report uses
        await this._detectAndSendAlerts(status);

        const report = {
            unixTime: getCurrentUnixTime(),
            uptimeSec: Math.floor(process.uptime()),
            process: this._processTelemetry(),
            status
        };

        try {
            await this.rsync.emitToOrchestrator(this.protocol.ClusterEvents.NODE_STATUS, report);
            this._stats.statusReportsSent += 1;
            this._trackEmitSuccess();
        } catch (err) {
            this._stats.statusReportFailures += 1;
            logger.warn(`ClusterLink: status report not delivered — ${err.message}`);
            this._trackEmitFailure();
        }
    }

    _processTelemetry() {
        const mem = process.memoryUsage();
        return {
            rssBytes: mem.rss,
            heapUsedBytes: mem.heapUsed,
            heapTotalBytes: mem.heapTotal,
            externalBytes: mem.external
        };
    }

    _extractFlags(status) {
        const memUsage = status?.memoryMonitor?.usagePercent;
        return {
            etsLockdown: !!status.etsLockdown,
            elmDegraded: !!status.elmDegraded,
            serverLocked: !!status.serverLocked,
            memoryPressure: typeof memUsage === 'number'
                ? memUsage >= this.config.memoryPressureThresholdPercent
                : false
        };
    }

    async _detectAndSendAlerts(status) {
        const flags = this._extractFlags(status);

        const previous = this._lastFlags;
        this._lastFlags = flags;
        if (!previous) return; // first snapshot — establish the baseline only

        const { ClusterAlerts, buildAlert } = this.protocol;
        const transitions = [
            ['etsLockdown', ClusterAlerts.ETS_LOCKDOWN_ENGAGED, ClusterAlerts.ETS_LOCKDOWN_LIFTED, 'critical'],
            ['elmDegraded', ClusterAlerts.EVENT_LOOP_DEGRADED, ClusterAlerts.EVENT_LOOP_RECOVERED, 'warning'],
            ['serverLocked', ClusterAlerts.SERVER_LOCKED, ClusterAlerts.SERVER_UNLOCKED, 'warning'],
            ['memoryPressure', ClusterAlerts.MEMORY_PRESSURE, ClusterAlerts.MEMORY_RECOVERED, 'warning']
        ];

        for (const [flag, engagedAlert, liftedAlert, severity] of transitions) {
            if (previous[flag] === flags[flag]) continue;

            const type = flags[flag] ? engagedAlert : liftedAlert;
            const alertSeverity = flags[flag] ? severity : 'info';

            try {
                await this.rsync.emitToOrchestrator(
                    this.protocol.ClusterEvents.NODE_ALERT,
                    buildAlert(type, alertSeverity, { flag, value: flags[flag] })
                );
                this._stats.alertsSent += 1;
                this._trackEmitSuccess();
            } catch (err) {
                logger.warn(`ClusterLink: alert "${type}" not delivered — ${err.message}`);
                this._trackEmitFailure();
            }
        }
    }

    // ── Inbound events ────────────────────────────────────────────────────────

    async _handleOrchestratorEvent(event) {
        const { ClusterEvents } = this.protocol;

        if (event.name === ClusterEvents.COMMAND) {
            await this._handleCommand(event.data || {});
            return;
        }

        if (event.name === ClusterEvents.CLUSTER_STATE) {
            // Keep the fleet-wide health view available to the whole node
            globalAccessPoint.setValue('clusterState', event.data || null);
            logger.info(`ClusterLink: cluster state is now ${event.data?.state || 'unknown'} (was ${event.data?.previousState || 'unknown'})`);
            // Also surface to custom handlers so host apps can react (e.g. shed load)
        }

        // Anything else (and cluster-state) is surfaced to the host service
        for (const handler of this._customHandlers) {
            try {
                await handler(event);
            } catch (err) {
                logger.error(`ClusterLink: custom event handler error — ${err.message}`);
            }
        }
    }

    /** Register a handler for non-command events sent by the orchestrator */
    onClusterEvent(handler) {
        if (typeof handler !== 'function') {
            throw new Error('ClusterLink: event handler must be a function');
        }
        this._customHandlers.push(handler);
        return this;
    }

    /** Passthrough for the host service to emit application events upstream */
    async emitToOrchestrator(eventName, data = {}) {
        if (!this.connected) {
            throw new Error('ClusterLink: not connected to orchestrator');
        }
        return this.rsync.emitToOrchestrator(eventName, data);
    }

    /** Latest CLUSTER_STATE broadcast received from the orchestrator (or null) */
    getClusterState() {
        return globalAccessPoint.getValue('clusterState') || null;
    }

    // ── Remote command execution ──────────────────────────────────────────────

    async _handleCommand(envelope) {
        const { ClusterEvents, buildCommandResult, isKnownCommand } = this.protocol;
        const { commandId, action, args } = envelope;

        if (!commandId || !action) {
            logger.warn('ClusterLink: malformed command envelope dropped');
            return;
        }

        let result;

        if (this.config.allowRemoteControl !== true) {
            this._stats.commandsRejected += 1;
            result = buildCommandResult(commandId, action, false, {
                code: 'REMOTE_CONTROL_DISABLED',
                message: 'This node does not accept remote control commands'
            });
        } else if (!isKnownCommand(action)) {
            this._stats.commandsRejected += 1;
            result = buildCommandResult(commandId, action, false, {
                code: 'UNKNOWN_COMMAND',
                message: `Action "${action}" is not in the cluster command allowlist`
            });
        } else {
            try {
                const payload = await this.executeCommand(action, args || {});
                this._stats.commandsExecuted += 1;
                result = buildCommandResult(commandId, action, true, payload);
            } catch (err) {
                this._stats.commandsRejected += 1;
                result = buildCommandResult(commandId, action, false, {
                    code: 'EXECUTION_ERROR',
                    message: err.message
                });
            }
        }

        this._auditIncomingCommand(envelope, result);

        try {
            await this.rsync.emitToOrchestrator(ClusterEvents.COMMAND_RESULT, result);
            this._trackEmitSuccess();
        } catch (err) {
            logger.error(`ClusterLink: command result for ${commandId} not delivered — ${err.message}`);
            this._trackEmitFailure();
        }
    }

    /**
     * Every command arriving from the orchestrator lands in this node's
     * immutable audit trail, scoped to the principal the orchestrator executed
     * it for (`envelope.issuedBy` — a system admin from the orch panel/CLI, or
     * the orchestrator's own automation). Auditing is best-effort by design:
     * a node without an audit system still executes commands.
     */
    _auditIncomingCommand(envelope, result) {
        try {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
            if (!auditTrail?.record) return;

            const issuedBy = envelope.issuedBy && typeof envelope.issuedBy === 'object'
                ? envelope.issuedBy
                : { type: 'system', id: null, email: null };

            auditTrail.record({
                user: {
                    uid: issuedBy.id || (issuedBy.type === 'admin' ? 'unknown-admin' : 'orchestrator'),
                    email: issuedBy.email || null
                },
                action: 'CLUSTER_COMMAND_RECEIVED',
                status: result?.ok === true ? 'SUCCESS' : 'FAILED',
                source: 'ClusterLinkSystem.js',
                functionName: '_handleCommand',
                impact: 'cluster-remote-control',
                metadata: {
                    commandId: envelope.commandId,
                    commandAction: envelope.action,
                    args: envelope.args || {},
                    issuedByType: issuedBy.type || 'system',
                    cluster: this.config.cluster,
                    workerId: this.rsync?.workerId || null,
                    errorCode: result?.ok === true ? null : (result?.error?.code || null)
                }
            });
        } catch (err) {
            logger.warn(`ClusterLink: incoming-command audit failed — ${err.message}`);
        }
    }

    /**
     * Executes a single allowlisted action against OrionSystemsControl.
     * Mutating SystemsControl methods return `false` when safe mode (or the
     * system itself) refuses the change — reported as `{ applied: false }`.
     */
    async executeCommand(action, args = {}) {
        const { ClusterCommands } = this.protocol;
        const systemsControl = globalAccessPoint.getValue('orionSystemsControl');

        const noControlNeeded = [ClusterCommands.PING, ClusterCommands.IDENTIFY, ClusterCommands.ADD_CLIENT_URLS];
        if (!systemsControl && !noControlNeeded.includes(action)) {
            throw new Error('OrionSystemsControl unavailable on this node');
        }

        switch (action) {
            case ClusterCommands.PING:
                return { pong: true, unixTime: getCurrentUnixTime(), workerId: this.rsync?.workerId || null };

            case ClusterCommands.IDENTIFY:
                return this._buildHello();

            case ClusterCommands.GET_STATUS:
                return systemsControl.getSystemStatus();

            case ClusterCommands.CONSENSUS_VOTE:
                return this._castVote(args, systemsControl);

            case ClusterCommands.LOCK_SERVER:
                return { applied: systemsControl.lockServer() === true };

            case ClusterCommands.UNLOCK_SERVER:
                return { applied: systemsControl.unlockServer() === true };

            case ClusterCommands.CLEAR_ETS_LOCKDOWN:
                return { applied: systemsControl.clearEtsLockdown() === true };

            case ClusterCommands.DEACTIVATE_SECURITY:
                this._requireArg(args, 'system');
                return { applied: systemsControl.deactivateSystemSecurity(args.system) === true };

            case ClusterCommands.REACTIVATE_SECURITY:
                this._requireArg(args, 'system');
                return { applied: systemsControl.reactivateSystemSecurity(args.system) === true };

            case ClusterCommands.PAUSE_AUDIT_TRAIL:
                return { applied: systemsControl.pauseAuditTrail() === true };

            case ClusterCommands.RESUME_AUDIT_TRAIL:
                return { applied: systemsControl.resumeAuditTrail() === true };

            case ClusterCommands.OPEN_CIRCUIT:
                this._requireArg(args, 'dependency');
                return { applied: systemsControl.openCircuitBreaker(args.dependency) === true };

            case ClusterCommands.RESET_CIRCUIT:
                this._requireArg(args, 'dependency');
                return { applied: systemsControl.resetCircuitBreaker(args.dependency) === true };

            case ClusterCommands.SET_MAX_IN_FLIGHT:
                if (typeof args.limit !== 'number' || args.limit <= 0) {
                    throw new Error('Command argument "limit" must be a positive number');
                }
                return { applied: systemsControl.setMaxInFlight(args.limit) === true };

            case ClusterCommands.UNBLOCK_ACTOR:
                this._requireArg(args, 'actorId');
                return { applied: systemsControl.unblockActor(args.actorId) === true };

            case ClusterCommands.ADD_CLIENT_URLS:
                return this._addClientUrls(args);

            case ClusterCommands.START_MEMORY_MONITOR:
                systemsControl.reactivateMemoryMonitoring();
                return { applied: true };

            case ClusterCommands.STOP_MEMORY_MONITOR:
                systemsControl.deactivateMemoryMonitoring();
                return { applied: true };

            case ClusterCommands.START_EVENT_LOOP_MONITOR:
                systemsControl.reactivateEventLoopMonitor();
                return { applied: true };

            case ClusterCommands.STOP_EVENT_LOOP_MONITOR:
                systemsControl.deactivateEventLoopMonitor();
                return { applied: true };

            default:
                // isKnownCommand() gates before this point; a mismatch means the
                // protocol module and this table have drifted apart.
                throw new Error(`Action "${action}" is allowlisted but has no executor`);
        }
    }

    /**
     * Evaluates a consensus topic against this node's LOCAL view and returns a
     * ballot. A node votes `true` when the topic's condition HOLDS locally.
     */
    _castVote(args, systemsControl) {
        const { ConsensusTopics, isKnownTopic, buildVote } = this.protocol;
        this._requireArg(args, 'topic');

        if (!isKnownTopic(args.topic)) {
            throw new Error(`Unknown consensus topic "${args.topic}"`);
        }

        const params = args.params || {};
        const status = systemsControl.getSystemStatus();
        const flags = this._extractFlags(status);

        let vote;
        let details = {};

        switch (args.topic) {
            case ConsensusTopics.NODE_HEALTHY:
                vote = !flags.etsLockdown && !flags.elmDegraded && !flags.memoryPressure && !flags.serverLocked;
                details = flags;
                break;

            case ConsensusTopics.ETS_LOCKDOWN:
                vote = flags.etsLockdown;
                break;

            case ConsensusTopics.ELM_DEGRADED:
                vote = flags.elmDegraded;
                break;

            case ConsensusTopics.MEMORY_PRESSURE: {
                const threshold = typeof params.thresholdPercent === 'number'
                    ? params.thresholdPercent
                    : this.config.memoryPressureThresholdPercent;
                const usage = status?.memoryMonitor?.usagePercent;
                vote = typeof usage === 'number' ? usage >= threshold : false;
                details = { usagePercent: usage ?? null, threshold };
                break;
            }

            case ConsensusTopics.ABUSE_HIGH: {
                const minBlocked = typeof params.minBlocked === 'number' ? params.minBlocked : 1;
                const stats = status?.abuseDetection || {};
                const blocked = Number(
                    stats.blockedActors ?? stats.currentlyBlocked ?? stats.blocked ?? 0
                );
                vote = blocked >= minBlocked;
                details = { blocked, minBlocked };
                break;
            }

            default:
                throw new Error(`Topic "${args.topic}" is known but has no evaluator`);
        }

        this._stats.votesCast += 1;
        return buildVote(args.topic, vote, details);
    }

    /**
     * Runtime client-URL propagation. Only honored when the node booted with
     * clientUrls.runTimeUpdateAllowed — the same gate the rest of Orion uses.
     */
    _addClientUrls(args) {
        this._requireArg(args, 'clientUrls');
        if (!Array.isArray(args.clientUrls)) {
            throw new Error('Command argument "clientUrls" must be an array');
        }

        if (globalAccessPoint.getValue('clientUrlsRunTimeUpdateAllowed') !== true) {
            return { applied: false, reason: 'RUNTIME_CLIENT_URL_UPDATES_DISABLED' };
        }

        const current = globalAccessPoint.allowedClientUrls() || [];
        const merged = [...validateClientUrls([...current, ...args.clientUrls])];
        globalAccessPoint.setValue('allowedClientUrls', merged);

        return { applied: true, added: merged.length - current.length, total: merged.length };
    }

    _requireArg(args, name) {
        if (args?.[name] === undefined || args?.[name] === null || args?.[name] === '') {
            throw new Error(`Command argument "${name}" is required`);
        }
    }

    // ── Observability ─────────────────────────────────────────────────────────

    getStats() {
        return {
            enabled: this.enabled,
            connected: this.connected,
            cluster: this.config.cluster,
            workerId: this.rsync?.workerId || null,
            allowRemoteControl: this.config.allowRemoteControl === true,
            retryAttempt: this._retryAttempt,
            consecutiveEmitFailures: this._consecutiveEmitFailures,
            clusterState: this.getClusterState()?.state || null,
            ...this._stats
        };
    }
}

export { ClusterLinkSystem };
