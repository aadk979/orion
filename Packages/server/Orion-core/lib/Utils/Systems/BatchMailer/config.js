/**
 * Defaults for this node's half of the batch mailing plane.
 *
 * Everything here can be overridden from `utilities.batchMailer` in the app
 * config, and a few of them (the rate budget, the attempt ceiling, the archive
 * TTL) are overridden again per assignment by the orchestrator — it knows the
 * fleet size and the provider's limits, this node only knows itself.
 *
 * `mail` is deliberately separate from `systemConfig.mail`: bulk mail and
 * password-reset mail should never share a reputation, a quota, or a throttle.
 */
const defaultConfig = Object.freeze({
    enabled: false,
    /** Dedicated bulk transport — { service | host, port, secure, email, password, from } */
    mail: {},
    /** Sliding send budget */
    ratePerWindow: 15,
    rateWindowMs: 2 * 60 * 1000,
    /** Per-recipient delivery attempts before it is dead-lettered */
    maxAttempts: 3,
    /** Exponential backoff between attempts: base * 2^(attempt - 1) */
    backoffBaseMs: 5_000,
    backoffMaxMs: 5 * 60 * 1000,
    /** How often counts are reported upstream while a group is in flight */
    progressIntervalMs: 30_000,
    /** Rows read from the queue per database round trip */
    fetchBatchSize: 50,
    /** How long delivery records are retained before the janitor may remove them */
    archiveTtlDays: 90,
    /**
     * Consecutive dead-letters that mean "the transport is broken, not the
     * addresses". Deliberately larger than one bad address but far smaller than
     * a whole group.
     */
    consecutiveFailureAbort: 10
});

export { defaultConfig };
