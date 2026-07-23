/**
 * In-memory nonce cache with TTL, for DPoP proof `jti` values.
 *
 * Mirrors the guard R_sync uses for worker requests — same shape, same sweep,
 * same unref'd timer so it never holds the process open.
 *
 * Single-node scope. On a cluster each node keeps its own set, so a proof could
 * in principle be replayed once per node. That is a much smaller window than no
 * guard at all, and the proof's own 60-second freshness bound caps it; back it
 * with Redis if cross-node proof replay is in scope for your deployment.
 */
const createReplayGuard = ({ retentionSec = 120, sweepIntervalMs = 60_000 } = {}) => {
    const seen = new Map(); // key -> expiry (unix ms)

    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, expiry] of seen) {
            if (expiry <= now) seen.delete(key);
        }
    }, sweepIntervalMs);

    timer.unref?.();

    return {
        isFresh(key) {
            const expiry = seen.get(key);
            if (expiry === undefined) return true;

            if (expiry <= Date.now()) {
                seen.delete(key);
                return true;
            }

            return false;
        },

        record(key, ttlSec = retentionSec) {
            seen.set(key, Date.now() + ttlSec * 1000);
        },

        _size() {
            return seen.size;
        }
    };
};

export { createReplayGuard };
