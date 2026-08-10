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

    // ── Field encryption / key vault ─────────────────────────────────────────
    // Split from the cluster:command:* vocabulary because the blast radii are
    // wildly different: reading vault status is as safe as any other status
    // read, KEK rotation is routine hygiene, DEK rotation rewrites every
    // encrypted row, and the wipe destroys user enrollments outright. A policy
    // must be able to grant the first without implying the last.
    // Named KEYVAULT_* rather than READ_*/OPS_* because those key prefixes mean
    // "in the cluster: namespace" throughout this vocabulary and its contract test.
    KEYVAULT_READ_STATUS: 'keyvault:read:status',
    KEYVAULT_ROTATE_KEK: 'keyvault:ops:rotate-kek',
    KEYVAULT_ROTATE_DEK: 'keyvault:ops:rotate-dek',
    /**
     * Root-only in addition to this action — see AdminServer. PBAC alone is
     * never sufficient to authorize destroying every user's second factor.
     */
    KEYVAULT_WIPE: 'keyvault:ops:wipe-encrypted',

    // ── Batch mailing ────────────────────────────────────────────────────────
    // Its own namespace for the same reason keyvault:* is: the capabilities are
    // graded and a cluster grant should not imply any of them. Reading which
    // blasts ran is an observability concern; submitting one sends mail from
    // the organisation's own domain to an arbitrary list, which is closer to a
    // publishing right than an operational one — so it is separately grantable,
    // and separately deniable.
    MAILING_READ_JOBS: 'mailing:read:jobs',
    MAILING_READ_QUEUE: 'mailing:read:queue',
    MAILING_SUBMIT: 'mailing:ops:submit',
    MAILING_CANCEL: 'mailing:ops:cancel',

    // ── Orchestrator notifications ───────────────────────────────────────────
    NOTIFICATIONS_READ: 'notifications:read',

    // ── Audit ────────────────────────────────────────────────────────────────
    READ_AUDIT: 'audit:read',

    // ── Governance (root-only, role-enforced) ────────────────────────────────
    MANAGE_ADMINS: 'governance:admins',
    MANAGE_POLICIES: 'governance:policies',
    MANAGE_GROUPS: 'governance:groups'
});

/** PBAC action name for executing a specific node command. */
const commandAction = nodeAction => `${AdminActions.COMMAND_PREFIX}:${nodeAction}`;

/** PBAC resource name for a specific node. */
const nodeResource = workerId => `node:${workerId}`;

/**
 * PBAC resource name for a specific mailing job, so a policy can scope a grant
 * to one blast (`job:<id>`) rather than to mailing as a whole.
 */
const mailingJobResource = jobId => `job:${jobId}`;

const CLUSTER_RESOURCE = 'cluster';
const MAILING_RESOURCE = 'mailing';
const NOTIFICATIONS_RESOURCE = 'notifications';

export { AdminActions, commandAction, nodeResource, mailingJobResource, CLUSTER_RESOURCE, MAILING_RESOURCE, NOTIFICATIONS_RESOURCE };
