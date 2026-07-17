/**
 * Orion Cluster Protocol
 *
 * Single source of truth for the application-level contract spoken between the
 * Orion-Orchestrator (R_Sync ORCHESTRATOR role) and Orion-core nodes
 * (R_Sync WORKER role). R_Sync provides the encrypted, authenticated transport;
 * this module defines WHAT travels over it.
 *
 * Orion-core imports this file via the `orion-orch/protocol` export so both
 * sides of the wire always agree on event names, command actions, and envelope
 * shapes. Bump PROTOCOL_VERSION on any breaking change to an envelope.
 */

const PROTOCOL_VERSION = 2;

// ── Event names ────────────────────────────────────────────────────────────────
// Worker → Orchestrator: NODE_HELLO, NODE_STATUS, NODE_ALERT, NODE_GOODBYE, COMMAND_RESULT
// Orchestrator → Worker: COMMAND, CLUSTER_STATE
const ClusterEvents = Object.freeze({
    /** Sent by a node right after it registers (and on re-identify) — identity metadata */
    NODE_HELLO: 'orion:node:hello',
    /** Periodic full system-status snapshot (OrionSystemsControl.getSystemStatus()) */
    NODE_STATUS: 'orion:node:status',
    /** Edge-triggered operational alerts (lockdown engaged, event loop degraded, ...) */
    NODE_ALERT: 'orion:node:alert',
    /** Best-effort notification that a node is shutting down gracefully */
    NODE_GOODBYE: 'orion:node:goodbye',
    /** Orchestrator-issued remote command envelope */
    COMMAND: 'orion:command',
    /** Node's reply to a COMMAND, correlated via commandId */
    COMMAND_RESULT: 'orion:command:result',
    /** Orchestrator → all nodes: cluster health state broadcast (nodes stay in the loop) */
    CLUSTER_STATE: 'orion:cluster:state'
});

// ── Remote command actions ─────────────────────────────────────────────────────
// Every action maps 1:1 onto a node capability. Nodes execute ONLY actions in
// this list (allowlist semantics) and only when their cluster link is configured
// with `allowRemoteControl: true`. Safe-mode still applies on the node: a
// command that safe mode refuses reports `{ applied: false }` rather than failing.
const ClusterCommands = Object.freeze({
    /** Liveness probe at the application layer (transport heartbeat is separate) */
    PING: 'node:ping',
    /** Re-request the node's hello identity payload (registry rehydration after orch restart) */
    IDENTIFY: 'node:identify',
    /** Returns the node's full OrionSystemsControl.getSystemStatus() snapshot */
    GET_STATUS: 'status:get',
    /** Cast a vote on a consensus topic — args: { topic, params? } */
    CONSENSUS_VOTE: 'consensus:vote',
    /** Reject all incoming API traffic on the node (server lock) */
    LOCK_SERVER: 'server:lock',
    /** Resume accepting API traffic */
    UNLOCK_SERVER: 'server:unlock',
    /** Lift an Error Tracker System lockdown (blocked by safe mode) */
    CLEAR_ETS_LOCKDOWN: 'ets:clear-lockdown',
    /** Disable a named security system — args: { system } (blocked by safe mode) */
    DEACTIVATE_SECURITY: 'security:deactivate',
    /** Re-enable a named security system — args: { system } (blocked by safe mode) */
    REACTIVATE_SECURITY: 'security:reactivate',
    /** Pause audit trail persistence (blocked by safe mode) */
    PAUSE_AUDIT_TRAIL: 'audit:pause',
    /** Resume audit trail persistence (blocked by safe mode) */
    RESUME_AUDIT_TRAIL: 'audit:resume',
    /** Force-open a circuit breaker — args: { dependency } */
    OPEN_CIRCUIT: 'circuit:open',
    /** Force-close (reset) a circuit breaker — args: { dependency } (blocked by safe mode) */
    RESET_CIRCUIT: 'circuit:reset',
    /** Change the load shedder's in-flight ceiling — args: { limit } (blocked by safe mode) */
    SET_MAX_IN_FLIGHT: 'load:set-max-in-flight',
    /** Unblock an abuse-detection actor — args: { actorId } (blocked by safe mode) */
    UNBLOCK_ACTOR: 'abuse:unblock-actor',
    /**
     * Merge additional allowed client URLs at runtime — args: { clientUrls: [] }.
     * Only honored when the node booted with clientUrls.runTimeUpdateAllowed.
     */
    ADD_CLIENT_URLS: 'config:client-urls:add',
    /** Start the memory monitoring system */
    START_MEMORY_MONITOR: 'memory-monitor:start',
    /** Stop the memory monitoring system */
    STOP_MEMORY_MONITOR: 'memory-monitor:stop',
    /** Start the event loop monitor */
    START_EVENT_LOOP_MONITOR: 'event-loop-monitor:start',
    /** Stop the event loop monitor */
    STOP_EVENT_LOOP_MONITOR: 'event-loop-monitor:stop'
});

// ── Alert types ────────────────────────────────────────────────────────────────
// Emitted by nodes as NODE_ALERT events when an operational flag flips state.
// NODE_STALE / NODE_RECOVERED / CLUSTER_* are synthesized by the ORCHESTRATOR.
const ClusterAlerts = Object.freeze({
    ETS_LOCKDOWN_ENGAGED: 'ets:lockdown-engaged',
    ETS_LOCKDOWN_LIFTED: 'ets:lockdown-lifted',
    EVENT_LOOP_DEGRADED: 'elm:degraded',
    EVENT_LOOP_RECOVERED: 'elm:recovered',
    SERVER_LOCKED: 'server:locked',
    SERVER_UNLOCKED: 'server:unlocked',
    MEMORY_PRESSURE: 'memory:pressure',
    MEMORY_RECOVERED: 'memory:recovered',
    /** Node's tunnel desynced (repeated auth failures) and it re-registered itself */
    TUNNEL_RESYNCED: 'tunnel:resynced',
    /** Synthesized by the ORCHESTRATOR when a node stops reporting */
    NODE_STALE: 'node:stale',
    /** Synthesized by the ORCHESTRATOR when a stale/offline node comes back */
    NODE_RECOVERED: 'node:recovered',
    /** Synthesized by the ORCHESTRATOR on cluster health state transitions */
    CLUSTER_STATE_CHANGED: 'cluster:state-changed'
});

const ALERT_SEVERITIES = Object.freeze(['info', 'warning', 'critical']);

// ── Consensus topics ───────────────────────────────────────────────────────────
// A vote asks every node to evaluate a predicate against its LOCAL view. The
// orchestrator's ConsensusEngine tallies the votes against a quorum. Nodes
// answer { topic, vote: boolean, details } — a node votes true when the
// condition HOLDS on that node.
const ConsensusTopics = Object.freeze({
    /** true = this node is healthy (no lockdown, no ELM degradation, not memory-pressured, unlocked) */
    NODE_HEALTHY: 'node-healthy',
    /** true = this node is currently in ETS lockdown */
    ETS_LOCKDOWN: 'ets-lockdown',
    /** true = this node's event loop is degraded */
    ELM_DEGRADED: 'elm-degraded',
    /** true = this node is under memory pressure (params: { thresholdPercent }) */
    MEMORY_PRESSURE: 'memory-pressure',
    /** true = this node's abuse detection is tracking at least params.minBlocked blocked actors */
    ABUSE_HIGH: 'abuse-high'
});

// ── Cluster health states ──────────────────────────────────────────────────────
// Computed by the orchestrator's ClusterHealth state machine and broadcast to
// every node via CLUSTER_STATE so the whole fleet shares one view.
const ClusterStates = Object.freeze({
    /** Not enough data yet (orchestrator just started / no nodes) */
    FORMING: 'FORMING',
    HEALTHY: 'HEALTHY',
    /** Some nodes unhealthy/offline but below the incident threshold */
    DEGRADED: 'DEGRADED',
    /** Quorum-confirmed (when enabled) widespread failure */
    INCIDENT: 'INCIDENT'
});

// ── Envelope builders ─────────────────────────────────────────────────────────

/**
 * Orchestrator → node command envelope.
 *
 * `issuedBy` identifies the principal the orchestrator executed the command
 * for: `{ type: 'system' }` for orchestrator-internal automation (policies,
 * health, consensus) or `{ type: 'admin', id, email }` for a system admin
 * acting through the orch panel/CLI. Nodes feed it into their local audit
 * trail so every remote action is attributable end-to-end. Additive since
 * protocol v2 — nodes that predate it simply ignore the field.
 */
const buildCommandEnvelope = (commandId, action, args = {}, issuedBy = null) => ({
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    action,
    args,
    issuedBy: issuedBy && typeof issuedBy === 'object'
        ? {
            type: issuedBy.type === 'admin' ? 'admin' : 'system',
            id: issuedBy.id || null,
            email: issuedBy.email || null
        }
        : { type: 'system', id: null, email: null }
});

/** Node → orchestrator command result envelope */
const buildCommandResult = (commandId, action, ok, payload = {}) => ({
    protocolVersion: PROTOCOL_VERSION,
    commandId,
    action,
    ok,
    ...(ok ? { result: payload } : { error: payload })
});

/** Node → orchestrator alert envelope */
const buildAlert = (type, severity, details = {}) => ({
    protocolVersion: PROTOCOL_VERSION,
    type,
    severity: ALERT_SEVERITIES.includes(severity) ? severity : 'info',
    details
});

/** Node → orchestrator consensus ballot (returned as a CONSENSUS_VOTE result) */
const buildVote = (topic, vote, details = {}) => ({
    protocolVersion: PROTOCOL_VERSION,
    topic,
    vote: vote === true,
    details
});

/** Orchestrator → nodes cluster state broadcast payload */
const buildClusterState = (state, previousState, summary = {}) => ({
    protocolVersion: PROTOCOL_VERSION,
    state,
    previousState,
    summary,
    changedAt: Math.floor(Date.now() / 1000)
});

const isKnownCommand = (action) => Object.values(ClusterCommands).includes(action);
const isKnownTopic = (topic) => Object.values(ConsensusTopics).includes(topic);

export {
    PROTOCOL_VERSION,
    ClusterEvents,
    ClusterCommands,
    ClusterAlerts,
    ALERT_SEVERITIES,
    ConsensusTopics,
    ClusterStates,
    buildCommandEnvelope,
    buildCommandResult,
    buildAlert,
    buildVote,
    buildClusterState,
    isKnownCommand,
    isKnownTopic
};
