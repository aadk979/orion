/**
 * Abuse detection — auth-failure and fingerprint-churn blocking.
 *
 * WHAT CHANGED AND WHY
 *
 * This system used to keep everything in per-process Maps. Two consequences,
 * both load-bearing:
 *
 *   1. State was not shared. Behind a load balancer with N nodes an attacker
 *      got N times the configured threshold, because each node counted only
 *      the failures it happened to receive, and a block established on one
 *      node did not exist on the others. The threshold was effectively
 *      advisory.
 *
 *   2. State was never reclaimed. `_ipBlocks`/`_fpBlocks` dropped an entry
 *      only if something happened to read it after expiry, and the churn map
 *      was never deleted from at all — so every distinct source address
 *      allocated permanently. A single attacker with a routed IPv6 /64 has
 *      2^64 source addresses available, which turns an anti-abuse control into
 *      a memory-exhaustion primitive against the process it protects.
 *
 * Both are fixed here. Cluster deployments evaluate against the same Redis the
 * rate limiter uses, so counters and blocks are global. Single-node
 * deployments keep the in-memory path, but it now sweeps expired entries and
 * enforces a hard ceiling with oldest-first eviction, so its footprint is
 * bounded no matter what arrives.
 *
 * Redis failures degrade to the local path rather than failing the request —
 * matching DynamicGlobalRateLimiter, and on the principle that losing abuse
 * counting is much better than losing the service.
 */
import crypto from 'crypto';
import { logger } from '../logger.js';
import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const redisInstanceModule = new SafeModuleHandler('RedisInstance', 'redisInstance', 'AbuseDetectionSystem.js');

const THRESHOLDS = {
    authFailureWindowMs: 60_000,
    authFailureSoftBlock: 5,
    authFailureHardBlock: 10,
    blockDurationMs: 15 * 60_000,
    fpChurnWindowMs: 60_000,
    fpChurnThreshold: 10
};

/**
 * Ceiling on distinct actors tracked in memory, per map. Reached only under
 * attack — a real deployment tracks far fewer — at which point the oldest
 * entries are evicted. Eviction can lose a partial failure count, which is an
 * acceptable trade against unbounded growth: the attacker who caused it has to
 * keep spending addresses to stay ahead of their own eviction.
 */
const MAX_TRACKED_ACTORS = 50_000;

/** How often the lazy sweep is allowed to walk the maps. */
const SWEEP_INTERVAL_MS = 30_000;

const KEY_PREFIX = 'orion:abuse';

/**
 * Actors are hashed into keys rather than used raw: it bounds key length,
 * normalises IPv6 forms, and keeps client IPs and device fingerprints out of
 * Redis in plaintext, where they would otherwise sit for the whole block
 * duration on shared infrastructure.
 */
const hashActor = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

/**
 * Records a failure and decides whether it trips a block, in one round trip.
 *
 * Doing this in Lua rather than as INCR/EXPIRE/SADD/SCARD from Node is what
 * makes the threshold real under concurrency: several nodes charging the same
 * actor at once would otherwise interleave read-modify-write and undercount.
 *
 * KEYS: 1=failure counter, 2=churn set, 3=ip block, 4=fp block
 * ARGV: 1=windowSec, 2=hardBlock, 3=churnThreshold, 4=blockSec, 5=fingerprint
 * Returns: { failureCount, uniqueFingerprints, blocked }
 */
const RECORD_SCRIPT = `
local failures = redis.call('INCR', KEYS[1])
if failures == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end

local unique = 0
if ARGV[5] ~= '' then
    redis.call('SADD', KEYS[2], ARGV[5])
    if redis.call('TTL', KEYS[2]) < 0 then
        redis.call('EXPIRE', KEYS[2], ARGV[1])
    end
    unique = redis.call('SCARD', KEYS[2])
end

local blocked = 0
if failures >= tonumber(ARGV[2]) or unique >= tonumber(ARGV[3]) then
    redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[4]))
    blocked = 1
end

return { failures, unique, blocked }
`;

/** PTTL on both block keys in one round trip. -2 means no key. */
const CHECK_SCRIPT = `
return { redis.call('PTTL', KEYS[1]), redis.call('PTTL', KEYS[2]) }
`;

class AbuseDetectionSystem {
    constructor() {
        // ip → [{ timestamp }]
        this._authFailuresByIp = new Map();
        // ip → [{ fingerprint, timestamp }]
        this._fpChurnByIp = new Map();
        // ip → { blockedUntil }
        this._ipBlocks = new Map();
        // fingerprint → { blockedUntil }
        this._fpBlocks = new Map();

        this._lastSweep = Date.now();

        // Resolved lazily and cached; clusterMode is immutable at runtime.
        this._isCluster = null;
        this._recordSha = null;
        this._checkSha = null;
    }

    // ── Cluster detection ────────────────────────────────────────────────────

    /**
     * `clusterMode` is a locked GAP key, so reading it before boot sets it
     * throws. That throw would propagate into a response path, so an
     * unresolved flag degrades to local evaluation — same handling the rate
     * limiter uses.
     */
    _resolveCluster() {
        if (this._isCluster !== null) return this._isCluster;

        try {
            this._isCluster = !!globalAccessPoint.clusterMode();
        } catch (err) {
            logger.warn(`AbuseDetection: clusterMode unresolved, evaluating against local memory — ${err.message}`);
            this._isCluster = false;
        }

        return this._isCluster;
    }

    _redisClient() {
        if (!this._resolveCluster()) return null;

        const instance = redisInstanceModule.probeModule();

        if (!instance || !instance.client) {
            logger.warn('AbuseDetection: cluster mode is enabled but Redis is missing. Falling back to local memory.');
            return null;
        }

        return instance.client;
    }

    /** EVALSHA with load-on-first-use and one retry on NOSCRIPT eviction. */
    async _evalScript(client, which, keys, args) {
        const source = which === 'record' ? RECORD_SCRIPT : CHECK_SCRIPT;
        const shaField = which === 'record' ? '_recordSha' : '_checkSha';

        if (!this[shaField]) {
            try {
                this[shaField] = await client.sendCommand(['SCRIPT', 'LOAD', source]);
            } catch (err) {
                logger.warn(`AbuseDetection: SCRIPT LOAD failed, falling back to EVAL — ${err.message}`);
                return client.sendCommand(['EVAL', source, String(keys.length), ...keys, ...args.map(String)]);
            }
        }

        try {
            return await client.sendCommand(['EVALSHA', this[shaField], String(keys.length), ...keys, ...args.map(String)]);
        } catch (err) {
            if (err.message && err.message.includes('NOSCRIPT')) {
                this[shaField] = null;
                return this._evalScript(client, which, keys, args);
            }
            throw err;
        }
    }

    // ── Local-memory hygiene ─────────────────────────────────────────────────

    _pruneOldEntries(arr, windowMs) {
        const cutoff = Date.now() - windowMs;
        let i = 0;
        while (i < arr.length && arr[i].timestamp < cutoff) i++;
        if (i > 0) arr.splice(0, i);
    }

    /**
     * Walks the maps dropping expired blocks and emptied windows. Lazy — driven
     * by writes rather than a timer, so an idle process does no work and holds
     * no handle open.
     */
    _maybeSweep() {
        const now = Date.now();
        if (now - this._lastSweep < SWEEP_INTERVAL_MS) return;

        this._lastSweep = now;

        for (const [key, entry] of this._ipBlocks) {
            if (now >= entry.blockedUntil) this._ipBlocks.delete(key);
        }

        for (const [key, entry] of this._fpBlocks) {
            if (now >= entry.blockedUntil) this._fpBlocks.delete(key);
        }

        for (const [key, list] of this._authFailuresByIp) {
            this._pruneOldEntries(list, THRESHOLDS.authFailureWindowMs);
            if (list.length === 0) this._authFailuresByIp.delete(key);
        }

        for (const [key, list] of this._fpChurnByIp) {
            this._pruneOldEntries(list, THRESHOLDS.fpChurnWindowMs);
            if (list.length === 0) this._fpChurnByIp.delete(key);
        }
    }

    /**
     * Hard ceiling. Map iteration order is insertion order, so the first keys
     * are the oldest — deleting from the front evicts least-recently-added.
     */
    _enforceCap(map) {
        if (map.size <= MAX_TRACKED_ACTORS) return;

        const excess = map.size - MAX_TRACKED_ACTORS;
        let removed = 0;

        for (const key of map.keys()) {
            map.delete(key);
            if (++removed >= excess) break;
        }

        logger.warn(`AbuseDetection: tracking cap reached, evicted ${removed} oldest entries`);
    }

    // ── Recording ────────────────────────────────────────────────────────────

    /**
     * Charges an authentication failure to an actor.
     *
     * Async, and deliberately never rejects: the caller is `respondWithError`,
     * where a rejected promise would become an unhandled rejection on an error
     * path that is already returning a response.
     *
     * @param {string} ip
     * @param {string} [fingerprint]
     * @returns {Promise<void>}
     */
    async recordAuthFailure(ip, fingerprint) {
        if (!ip) return;

        try {
            const client = this._redisClient();

            if (client) {
                await this._recordRedis(client, ip, fingerprint);
                return;
            }

            this._recordLocal(ip, fingerprint);
        } catch (err) {
            logger.warn(`AbuseDetection: failed to record auth failure — ${err.message}`);
            // Redis path failed mid-flight; keep the signal on this node at least.
            try {
                this._recordLocal(ip, fingerprint);
            } catch {}
        }
    }

    async _recordRedis(client, ip, fingerprint) {
        const ipHash = hashActor(ip);
        const windowSec = Math.ceil(THRESHOLDS.authFailureWindowMs / 1000);
        const blockSec = Math.ceil(THRESHOLDS.blockDurationMs / 1000);

        const result = await this._evalScript(
            client,
            'record',
            [`${KEY_PREFIX}:fail:${ipHash}`, `${KEY_PREFIX}:churn:${ipHash}`, `${KEY_PREFIX}:block:ip:${ipHash}`, `${KEY_PREFIX}:block:fp:${ipHash}`],
            [windowSec, THRESHOLDS.authFailureHardBlock, THRESHOLDS.fpChurnThreshold, blockSec, fingerprint ? hashActor(fingerprint) : '']
        );

        const failures = Number(result?.[0] || 0);
        const unique = Number(result?.[1] || 0);
        const blocked = Number(result?.[2] || 0) === 1;

        if (blocked) {
            logger.warn(`AbuseDetection: IP ${ip} blocked — ${failures} auth failures, ${unique} unique fingerprints in window`);
        } else if (failures >= THRESHOLDS.authFailureSoftBlock) {
            logger.warn(`AbuseDetection: IP ${ip} soft threshold hit — ${failures} auth failures`);
        }
    }

    _recordLocal(ip, fingerprint) {
        const now = Date.now();

        this._maybeSweep();

        if (!this._authFailuresByIp.has(ip)) this._authFailuresByIp.set(ip, []);
        const failures = this._authFailuresByIp.get(ip);
        failures.push({ timestamp: now });
        this._pruneOldEntries(failures, THRESHOLDS.authFailureWindowMs);

        if (failures.length >= THRESHOLDS.authFailureHardBlock) {
            this._ipBlocks.set(ip, { blockedUntil: now + THRESHOLDS.blockDurationMs });
            logger.warn(`AbuseDetection: IP ${ip} blocked — ${failures.length} auth failures in window`);
        } else if (failures.length >= THRESHOLDS.authFailureSoftBlock) {
            logger.warn(`AbuseDetection: IP ${ip} soft threshold hit — ${failures.length} auth failures`);
        }

        if (fingerprint) {
            if (!this._fpChurnByIp.has(ip)) this._fpChurnByIp.set(ip, []);
            const churnList = this._fpChurnByIp.get(ip);
            churnList.push({ fingerprint, timestamp: now });
            this._pruneOldEntries(churnList, THRESHOLDS.fpChurnWindowMs);

            const uniqueFps = new Set(churnList.map(e => e.fingerprint)).size;
            if (uniqueFps >= THRESHOLDS.fpChurnThreshold) {
                this._ipBlocks.set(ip, { blockedUntil: now + THRESHOLDS.blockDurationMs });
                logger.warn(`AbuseDetection: IP ${ip} blocked — fingerprint churn (${uniqueFps} unique fps)`);
            }
        }

        this._enforceCap(this._authFailuresByIp);
        this._enforceCap(this._fpChurnByIp);
        this._enforceCap(this._ipBlocks);
        this._enforceCap(this._fpBlocks);
    }

    /**
     * Blocks a device fingerprint outright.
     *
     * @param {string} fingerprint
     * @returns {Promise<void>}
     */
    async recordFpBlock(fingerprint) {
        if (!fingerprint) return;

        try {
            const client = this._redisClient();

            if (client) {
                const blockSec = Math.ceil(THRESHOLDS.blockDurationMs / 1000);
                await client.sendCommand(['SET', `${KEY_PREFIX}:block:fp:${hashActor(fingerprint)}`, '1', 'EX', String(blockSec)]);
            } else {
                this._fpBlocks.set(fingerprint, { blockedUntil: Date.now() + THRESHOLDS.blockDurationMs });
                this._enforceCap(this._fpBlocks);
            }

            logger.warn(`AbuseDetection: Fingerprint ${fingerprint.slice(0, 8)}... blocked`);
        } catch (err) {
            logger.warn(`AbuseDetection: failed to block fingerprint — ${err.message}`);
        }
    }

    // ── Checking ─────────────────────────────────────────────────────────────

    /**
     * @param {string} ip
     * @param {string} [fingerprint]
     * @returns {Promise<{blocked: boolean, reason?: string, unblockAt?: number}>}
     */
    async isBlocked(ip, fingerprint) {
        try {
            const client = this._redisClient();

            if (client) {
                return await this._isBlockedRedis(client, ip, fingerprint);
            }
        } catch (err) {
            logger.warn(`AbuseDetection: block check failed, falling back to local state — ${err.message}`);
        }

        return this._isBlockedLocal(ip, fingerprint);
    }

    async _isBlockedRedis(client, ip, fingerprint) {
        const result = await this._evalScript(
            client,
            'check',
            [`${KEY_PREFIX}:block:ip:${ip ? hashActor(ip) : 'none'}`, `${KEY_PREFIX}:block:fp:${fingerprint ? hashActor(fingerprint) : 'none'}`],
            []
        );

        const ipTtl = Number(result?.[0] ?? -2);
        const fpTtl = Number(result?.[1] ?? -2);

        if (ip && ipTtl > 0) {
            return { blocked: true, reason: 'ip', unblockAt: Date.now() + ipTtl };
        }

        if (fingerprint && fpTtl > 0) {
            return { blocked: true, reason: 'fingerprint', unblockAt: Date.now() + fpTtl };
        }

        return { blocked: false };
    }

    _isBlockedLocal(ip, fingerprint) {
        const now = Date.now();

        if (ip) {
            const ipBlock = this._ipBlocks.get(ip);
            if (ipBlock) {
                if (now < ipBlock.blockedUntil) {
                    return { blocked: true, reason: 'ip', unblockAt: ipBlock.blockedUntil };
                }
                this._ipBlocks.delete(ip);
            }
        }

        if (fingerprint) {
            const fpBlock = this._fpBlocks.get(fingerprint);
            if (fpBlock) {
                if (now < fpBlock.blockedUntil) {
                    return { blocked: true, reason: 'fingerprint', unblockAt: fpBlock.blockedUntil };
                }
                this._fpBlocks.delete(fingerprint);
            }
        }

        return { blocked: false };
    }

    // ── Administration ───────────────────────────────────────────────────────

    /**
     * Lifts a block on an actor, which may be either an IP or a fingerprint —
     * the caller does not know which, so both are cleared.
     *
     * @param {string} actorId
     * @returns {Promise<boolean>} true once the unblock has been applied
     */
    async unblock(actorId) {
        if (!actorId) return false;

        this._ipBlocks.delete(actorId);
        this._fpBlocks.delete(actorId);
        this._authFailuresByIp.delete(actorId);
        this._fpChurnByIp.delete(actorId);

        try {
            const client = this._redisClient();

            if (client) {
                const hash = hashActor(actorId);
                await client.sendCommand([
                    'DEL',
                    `${KEY_PREFIX}:block:ip:${hash}`,
                    `${KEY_PREFIX}:block:fp:${hash}`,
                    `${KEY_PREFIX}:fail:${hash}`,
                    `${KEY_PREFIX}:churn:${hash}`
                ]);
            }
        } catch (err) {
            logger.warn(`AbuseDetection: failed to clear Redis state for ${actorId} — ${err.message}`);
            return false;
        }

        logger.info(`AbuseDetection: ${actorId} unblocked`);
        return true;
    }

    /**
     * Counters for this node.
     *
     * Deliberately synchronous and deliberately local: the status endpoints
     * that read this are synchronous, and a cluster-wide figure would need a
     * SCAN across the keyspace on every status poll. In cluster mode the
     * numbers describe local fallback state only, which is why they are
     * labelled as such rather than presented as a global total.
     */
    getStats() {
        const now = Date.now();
        const activeIpBlocks = [...this._ipBlocks.values()].filter(v => now < v.blockedUntil).length;
        const activeFpBlocks = [...this._fpBlocks.values()].filter(v => now < v.blockedUntil).length;

        return {
            activeIpBlocks,
            activeFpBlocks,
            scope: this._isCluster ? 'local-node-fallback' : 'local-node',
            trackedIps: this._authFailuresByIp.size,
            trackedChurnIps: this._fpChurnByIp.size
        };
    }
}

const abuseDetectionSystem = new AbuseDetectionSystem();

export { abuseDetectionSystem, AbuseDetectionSystem, THRESHOLDS, MAX_TRACKED_ACTORS };
