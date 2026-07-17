/**
 * The PBAC action vocabulary of the system-admin plane.
 *
 * Every admin API route (and every CLI command, since the CLI talks to the
 * same API) maps to exactly one action name below; policies allow or deny
 * these names. Node-command execution is finer-grained: the action is
 * 'cluster:command:<node action>' (e.g. 'cluster:command:server:lock'), so a
 * policy can grant status reads but not lockdown clears.
 *
 * Root-only actions (admin/policy/group governance) are listed for audit
 * labeling and completeness — they are enforced by ROLE, not by policy: a
 * non-root admin is refused regardless of what a policy says, and root
 * bypasses PBAC entirely.
 */

const AdminActions = Object.freeze({
    // ── Cluster observability (safe reads) ──────────────────────────────────
    READ_STATUS: 'cluster:read:status',
    READ_NODES: 'cluster:read:nodes',
    READ_HEALTH: 'cluster:read:health',
    READ_ESCALATIONS: 'cluster:read:escalations',
    READ_CONSENSUS: 'cluster:read:consensus',
    READ_POLICY_RULES: 'cluster:read:policy-rules',
    READ_POLICY_OUTCOMES: 'cluster:read:policy-outcomes',
    READ_COMMAND_LOG: 'cluster:read:command-log',

    // ── Cluster operations (mutating) ────────────────────────────────────────
    OPS_LOCK_CLUSTER: 'cluster:ops:lock',
    OPS_UNLOCK_CLUSTER: 'cluster:ops:unlock',
    OPS_DECLARE_INCIDENT: 'cluster:ops:incident-declare',
    OPS_RESOLVE_INCIDENT: 'cluster:ops:incident-resolve',
    OPS_PROPOSE_CONSENSUS: 'cluster:ops:consensus-propose',
    OPS_ADD_CLIENT_URLS: 'cluster:ops:client-urls-add',

    // ── Node commands — dynamic tail: cluster:command:<node action> ─────────
    COMMAND_PREFIX: 'cluster:command',

    // ── Audit ────────────────────────────────────────────────────────────────
    READ_AUDIT: 'audit:read',

    // ── Governance (root-only, role-enforced) ────────────────────────────────
    MANAGE_ADMINS: 'governance:admins',
    MANAGE_POLICIES: 'governance:policies',
    MANAGE_GROUPS: 'governance:groups'
});

/** PBAC action name for executing a specific node command. */
const commandAction = (nodeAction) => `${AdminActions.COMMAND_PREFIX}:${nodeAction}`;

/** PBAC resource name for a specific node. */
const nodeResource = (workerId) => `node:${workerId}`;

const CLUSTER_RESOURCE = 'cluster';

export { AdminActions, commandAction, nodeResource, CLUSTER_RESOURCE };
