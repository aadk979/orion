/**
 * Nonce cache with TTL, for DPoP proof `jti` values.
 *
 * Backed by Redis when the ephemeral store is available, so a proof captured on
 * one cluster node cannot be replayed against another. Falls back to an
 * in-process map otherwise, which is correct for a single node and degrades to
 * per-node on a cluster — the same shape jtiDenylist uses.
 *
 * `record` is the AUTHORITATIVE claim, not a bookkeeping call: it is an atomic
 * SET NX, so two concurrent requests presenting the same proof cannot both win
 * it. `isFresh` is only a cheap pre-check that avoids the write on an obvious
 * replay. Callers MUST treat a `false` from `record` as a replay — checking
 * `isFresh` alone is a time-of-check/time-of-use race.
 *
 * A Redis failure degrades to the local map rather than refusing the proof: an
 * unreachable cache must not lock every bound session out, and the proof's own
 * 60-second freshness bound caps the exposure.
 */
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { logger } from '../../../logger.js';

const KEY_PREFIX = 'orion:dpop-jti:';

const redisStore = () => {
    try {
        return globalAccessPoint.redisInstance() || null;
    } catch {
        return null;
    }
};

const createReplayGuard = ({ retentionSec = 120, sweepIntervalMs = 60_000 } = {}) => {
    const seen = new Map(); // key -> expiry (unix ms)

    const timer = setInterval(() => {
        const now = Date.now();
        for (const [key, expiry] of seen) {
            if (expiry <= now) seen.delete(key);
        }
    }, sweepIntervalMs);

    timer.unref?.();

    const localIsFresh = key => {
        const expiry = seen.get(key);
        if (expiry === undefined) return true;

        if (expiry <= Date.now()) {
            seen.delete(key);
            return true;
        }

        return false;
    };

    const localRecord = (key, ttlSec) => {
        if (!localIsFresh(key)) return false;

        seen.set(key, Date.now() + ttlSec * 1000);
        return true;
    };

    return {
        /**
         * Cheap pre-check. A `true` here is not a guarantee — only `record`
         * settles it.
         * @returns {Promise<boolean>}
         */
        async isFresh(key) {
            const store = redisStore();

            if (store) {
                try {
                    const result = await store.getData(`${KEY_PREFIX}${key}`);
                    if (!result?.error) return result?.data === undefined;
                } catch (e) {
                    logger.warn(`proofReplayGuard: Redis read failed, falling back to local store — ${e.message}`);
                }
            }

            return localIsFresh(key);
        },

        /**
         * Atomically claims this jti.
         * @returns {Promise<boolean>} true when THIS caller claimed it; false
         *   means it was already claimed, i.e. the proof is a replay.
         */
        async record(key, ttlSec = retentionSec) {
            const store = redisStore();

            if (store) {
                try {
                    const expiresAt = Math.floor(Date.now() / 1000) + Math.ceil(ttlSec);
                    const result = await store.setIfAbsent(`${KEY_PREFIX}${key}`, 1, expiresAt);
                    if (!result?.error) return result?.data === true;
                } catch (e) {
                    logger.warn(`proofReplayGuard: Redis write failed, falling back to local store — ${e.message}`);
                }
            }

            return localRecord(key, ttlSec);
        },

        _size() {
            return seen.size;
        }
    };
};

export { createReplayGuard };
