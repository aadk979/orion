/**
 * Short-lived denylist of revoked token ids.
 *
 * Revocation for stateful tiers works by deleting the token row, which stateless
 * tier-1 tokens do not have — so at tier 1 "sign out this one device" had nothing
 * to act on and every targeted revocation entry point refused outright.
 *
 * A tier-1 token now carries a `jti`, and revoking one records that id here.
 * Entries only need to outlive the token, and access tokens are minutes long, so
 * the set stays small. This is the same trade every stateless-token system
 * eventually makes: a tiny amount of state buys real logout.
 *
 * Backed by Redis when the ephemeral store is available so a revocation
 * propagates across cluster nodes; falls back to an in-process map otherwise,
 * which is correct for a single node and degrades to per-node on a cluster.
 */
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { logger } from '../../../logger.js';

const KEY_PREFIX = 'orion:jti-revoked:';

// Fallback store: jti -> expiry (unix ms)
const localDenylist = new Map();

let sweepTimer = null;

const ensureSweep = () => {
    if (sweepTimer) return;

    sweepTimer = setInterval(() => {
        const now = Date.now();
        for (const [jti, expiry] of localDenylist) {
            if (expiry <= now) localDenylist.delete(jti);
        }
    }, 60_000);

    sweepTimer.unref?.();
};

const redis = () => {
    try {
        return globalAccessPoint.redisInstance() || null;
    } catch {
        return null;
    }
};

/**
 * Marks a token id revoked until its natural expiry.
 *
 * @param {string} jti
 * @param {number} ttlSeconds  remaining token lifetime; entries past this are useless
 */
const revokeJti = async (jti, ttlSeconds) => {
    if (!jti || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;

    const store = redis();

    if (store) {
        try {
            // RedisService exposes addData/getData, NOT set/get, and its ttl
            // argument is an ABSOLUTE unix timestamp rather than a duration.
            // Calling the node-redis shape here threw a TypeError on every
            // revocation, was swallowed by the catch, and silently degraded to
            // the local map — so on a cluster a revocation never left the node
            // that performed it, and isJtiRevoked() on every other node
            // answered "not revoked". A tier-1 sign-out looked like it worked
            // and did nothing.
            const expiresAt = Math.floor(Date.now() / 1000) + Math.ceil(ttlSeconds);
            const result = await store.addData(`${KEY_PREFIX}${jti}`, 1, expiresAt);

            if (!result?.error) return;

            logger.warn('jtiDenylist: Redis write reported an error, falling back to local store');
        } catch (e) {
            logger.warn(`jtiDenylist: Redis write failed, falling back to local store — ${e.message}`);
        }
    }

    ensureSweep();
    localDenylist.set(jti, Date.now() + ttlSeconds * 1000);
};

/**
 * @param {string} jti
 * @returns {Promise<boolean>} true when this token has been revoked
 */
const isJtiRevoked = async jti => {
    if (!jti) return false;

    const store = redis();

    if (store) {
        try {
            // See the note in revokeJti: getData, not get, and it returns a
            // result envelope rather than the raw value.
            const result = await store.getData(`${KEY_PREFIX}${jti}`);

            if (!result?.error) return result?.data !== undefined;

            logger.warn('jtiDenylist: Redis read reported an error, treating as not revoked');
            return false;
        } catch (e) {
            // Fail OPEN on a cache outage: a Redis failure must not lock every
            // user out. The window is bounded by the access-token lifetime, and
            // the sessions_valid_from watermark still covers bulk revocation,
            // which is the case that matters during an incident.
            logger.warn(`jtiDenylist: Redis read failed, treating as not revoked — ${e.message}`);
            return false;
        }
    }

    const expiry = localDenylist.get(jti);
    if (expiry === undefined) return false;

    if (expiry <= Date.now()) {
        localDenylist.delete(jti);
        return false;
    }

    return true;
};

/** Test seam. */
const _clearForTests = () => localDenylist.clear();

export { revokeJti, isJtiRevoked, _clearForTests };
