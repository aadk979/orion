import { DEFAULT_MAX_PER_GROUP } from './GroupPlanner.js';

/**
 * Defaults for the orchestrator half of the batch mailing plane, overridable
 * from `mailing` in the orchestrator config.
 *
 * The three timescales in here are the whole recovery story, and they are
 * deliberately far apart:
 *
 *   dispatchIntervalMs        seconds  — hand out work
 *   groupStallSeconds         minutes  — a node that is online but wedged
 *   groupSilentTimeoutSeconds a day    — the specification's backstop
 */
const defaultConfig = Object.freeze({
    enabled: true,
    /** Hard ceiling on one group, whatever the node count works out to */
    maxPerGroup: DEFAULT_MAX_PER_GROUP,
    /** Quiet period after a job finishes, before the next one may start */
    cooldownSeconds: 60 * 60,
    /** How often the dispatch loop looks for work to hand out */
    dispatchIntervalMs: 15_000,
    /** How often the watchdog looks for silent assignments */
    watchdogIntervalMs: 5 * 60 * 1000,
    /** No progress for this long → probe the node, then reclaim the group */
    groupStallSeconds: 30 * 60,
    /** The specification's backstop: total silence for this long → full recovery sweep */
    groupSilentTimeoutSeconds: 24 * 60 * 60,
    /** How long delivery records are kept before the janitor may remove them */
    archiveTtlDays: 90,
    /** Passed to the node with each assignment — its send budget */
    nodeRateLimit: { perWindow: 15, windowMs: 2 * 60 * 1000 },
    /** Per-recipient attempts before a row is dead-lettered */
    maxAttempts: 3,
    /** Mail the submitting admin a summary when their job finishes */
    emailSubmitterOnCompletion: true,
    /** Ceiling on how long a node may take to acknowledge an assignment */
    assignTimeoutMs: 15_000
});

/** How often expired delivery records and notifications are reaped. */
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Applies operator overrides, keeping the one nested block from being clobbered wholesale. */
const resolveConfig = (config = {}) => ({
    ...defaultConfig,
    ...config,
    nodeRateLimit: { ...defaultConfig.nodeRateLimit, ...(config.nodeRateLimit || {}) }
});

export { defaultConfig, PURGE_INTERVAL_MS, resolveConfig };
