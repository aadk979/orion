/**
 * Replay Guard
 *
 * A small in-memory nonce/id cache with TTL, used to reject replayed requests
 * and messages. Each guard sweeps expired entries on an interval so the map
 * does not grow unbounded. The sweep timer is unref'd so it never keeps the
 * process alive on its own.
 *
 * In a multi-process / horizontally-scaled deployment this should be backed by
 * a shared store (e.g. Redis). For the single-orchestrator model it is
 * sufficient in-process.
 */

import { getCurrentUnixTime } from './Date&Time.js';

/**
 * @param {{ retentionSec?: number, sweepIntervalMs?: number }} [options]
 */
function createReplayGuard({ retentionSec = 90, sweepIntervalMs = 60000 } = {}) {
    const seen = new Map(); // key -> expiry (unix seconds)

    const timer = setInterval(() => {
        const now = getCurrentUnixTime();
        for (const [key, expiry] of seen.entries()) {
            if (now > expiry) seen.delete(key);
        }
    }, sweepIntervalMs);
    if (typeof timer.unref === 'function') timer.unref();

    return {
        /** Has this key been recorded (and not yet expired)? */
        has(key) {
            return seen.has(key);
        },
        /** Record a key as used. */
        record(key, ttlSec = retentionSec) {
            seen.set(key, getCurrentUnixTime() + ttlSec);
        },
        /** Convenience: true if the key is fresh (not seen before). */
        isFresh(key) {
            return !seen.has(key);
        },
        _size() {
            return seen.size;
        }
    };
}

export { createReplayGuard };
