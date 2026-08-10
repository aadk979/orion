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

const PROTOCOL_VERSION = 3;

// ── Event names ────────────────────────────────────────────────────────────────
// Worker → Orchestrator: NODE_HELLO, NODE_STATUS, NODE_ALERT, NODE_GOODBYE,
//                        COMMAND_RESULT, MAILING_PROGRESS, MAILING_GROUP_DONE
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
    CLUSTER_STATE: 'orion:cluster:state',
    /**
     * Batch mailing heartbeat while a group is being sent — counts only, on a
     * timer, NOT one message per mail. Per-mail completion is written straight
     * to the shared database by the sending node; this event exists so the
     * orchestrator can tell "working" from "wedged" without polling.
     */
    MAILING_PROGRESS: 'orion:mailing:progress',
    /**
     * A node has finished (or given up on) the group it was assigned. This is
     * the message the orchestrator waits for before handing that node its next
     * group — and the one whose 24h absence trips the watchdog.
     */
    MAILING_GROUP_DONE: 'orion:mailing:group-done'
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
    /**
     * Inventory of the node's secrets managers: active (non-expired) signing
     * kids it owns and verification kids it trusts — kids and expiries only,
     * never key material.
     */
    SECRETS_LIST_KIDS: 'secrets:list-kids',
    /**
     * Immediate revocation broadcast — args: { kids: [] }. Every node
     * self-discovers what each kid means to it: a kid in its SIGNING pool is
     * decommissioned and replaced with a fresh pair; a kid in its VERIFICATION
     * pool is wiped so its signatures stop verifying; either way the kid is
     * deleted from the shared Redis fan-out.
     */
    SECRETS_REVOKE_KIDS: 'secrets:revoke-kids',
    /**
     * Decommission ALL of this node's signing keys immediately and regenerate
     * fresh pools — args: { kind?, domain? } to narrow to one manager family.
     */
    SECRETS_FORCE_ROTATE: 'secrets:force-rotate',
    /**
     * Field-encryption status: which key vault this node resolved, whether its
     * wrap/unwrap round trip passes, the data-encryption-key ledger, and a
     * per-field count of sealed vs. stale rows. Never returns key material.
     */
    KEYVAULT_STATUS: 'keyvault:status',
    /**
     * Rotate the key encryption key inside the vault and re-wrap the data
     * encryption key under it. Stored field data is untouched, so this is fast
     * and safe to run routinely.
     */
    KEYVAULT_ROTATE_KEK: 'keyvault:rotate-kek',
    /**
     * Rotate the data encryption key and re-encrypt every registered encrypted
     * column under it — args: { batchSize?, reencrypt? }. Retired DEKs are kept
     * so nothing is stranded by a partial run. Run on ONE node: the work is
     * against shared database state, not node-local state.
     */
    KEYVAULT_ROTATE_DEK: 'keyvault:rotate-dek',
    /**
     * DESTRUCTIVE. Clear encrypted field data that can no longer be decrypted —
     * args: { fields?, confirmation }. The recovery path when a KEK is lost:
     * every affected user re-enrolls. Gated at the orchestrator by root role,
     * a typed confirmation phrase, and a fleet-wide consensus vote.
     */
    KEYVAULT_WIPE_ENCRYPTED: 'keyvault:wipe-encrypted',
    /**
     * Assign one batch-mailing group to this node — args:
     * { jobId, jobName, groupNumber, recipientCount, rateLimit?, maxAttempts? }.
     *
     * Returns as soon as the node has accepted the group; the sending itself
     * runs in the background and can take hours. The recipients are NOT carried
     * in this envelope — the node reads them from the shared database, which is
     * also where it retires each one. Completion arrives later as
     * MAILING_GROUP_DONE.
     */
    MAILING_ASSIGN: 'mailing:assign',
    /**
     * What is this node doing about mailing right now — args: { jobId? }.
     * The direct probe the watchdog uses after 24h of silence, before it
     * concludes the group was orphaned and reassigns it.
     */
    MAILING_STATUS: 'mailing:status',
    /**
     * Stop sending — args: { jobId, groupNumber? }. Graceful: the mail already
     * handed to the transport is allowed to finish so it cannot be sent without
     * its row being retired, then the node stops and reports back.
     */
    MAILING_CANCEL: 'mailing:cancel',
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
    ABUSE_HIGH: 'abuse-high',
    /**
     * true = this node CANNOT read its encrypted fields (no vault, unreachable
     * vault, or a key that no longer unwraps).
     *
     * This is the vote that gates the destructive wipe. A wipe is only ever the
     * right answer when the whole fleet agrees the data is unrecoverable — if
     * even one node can still decrypt, the correct action is to fix the others,
     * not to destroy every user's second factor. Requiring unanimity here turns
     * "I think the key is gone" into a fact established by the cluster.
     */
    ENCRYPTION_UNAVAILABLE: 'encryption-unavailable'
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
    issuedBy:
        issuedBy && typeof issuedBy === 'object'
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

/**
 * Node → orchestrator batch-mailing progress heartbeat.
 *
 * Counts, not recipients: the authoritative per-recipient record is already in
 * the shared database by the time this is sent. `remaining` is the node's own
 * count of rows left in its group, which is what makes a stalled group visible
 * as "progress timestamp moving but remaining unchanged".
 */
const buildMailingProgress = (jobId, groupNumber, { sent = 0, failed = 0, remaining = null } = {}) => ({
    protocolVersion: PROTOCOL_VERSION,
    jobId,
    groupNumber,
    sent,
    failed,
    remaining,
    at: Math.floor(Date.now() / 1000)
});

/**
 * Node → orchestrator: this group is finished.
 *
 * `outcome` is 'completed' when the node drained the group (every recipient
 * either sent or dead-lettered), 'failed' when it gave up — a dead transport,
 * not a bad address — and 'cancelled' when it stopped on request. Only
 * 'completed' means the group needs no further attention.
 */
const buildMailingGroupDone = (jobId, groupNumber, outcome, { sent = 0, failed = 0, remaining = 0, error = null } = {}) => ({
    protocolVersion: PROTOCOL_VERSION,
    jobId,
    groupNumber,
    outcome: ['completed', 'failed', 'cancelled'].includes(outcome) ? outcome : 'failed',
    sent,
    failed,
    remaining,
    error,
    at: Math.floor(Date.now() / 1000)
});

/** Orchestrator → nodes cluster state broadcast payload */
const buildClusterState = (state, previousState, summary = {}) => ({
    protocolVersion: PROTOCOL_VERSION,
    state,
    previousState,
    summary,
    changedAt: Math.floor(Date.now() / 1000)
});

const isKnownCommand = action => Object.values(ClusterCommands).includes(action);
const isKnownTopic = topic => Object.values(ConsensusTopics).includes(topic);

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
    buildMailingProgress,
    buildMailingGroupDone,
    isKnownCommand,
    isKnownTopic
};
