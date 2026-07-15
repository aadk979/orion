import { globalAccessPoint } from '../GlobalAccessPoint.js';
import { InMemoryDB } from '../Databases/EphemeralDatabases/localMemoryDB.js';
import { logger } from '../logger.js';
import { respondWithError } from '../../Server/Response/response.js';
import { rateLimitPolicy, resolveEndpointPolicy } from '../../General/index.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const redisInstanceModule = new SafeModuleHandler('RedisInstance', 'redisInstance', 'DynamicGlobalRateLimiter.js');


/**
 * DynamicGlobalRateLimiter — Centralized, Policy-Driven Rate Limiter
 * ====================================================================
 * 
 * Architecture:
 *   ONE global middleware instance → ONE central policy config → ONE canonical bucket per actor.
 * 
 * Key design principles:
 *   - Redis keys represent ACTORS (ip, fingerprint, account), never routes.
 *   - Endpoint differentiation is achieved through variable request COST, not separate buckets.
 *   - Policy is resolved at request time from a central config map, not baked into constructor args.
 *   - The Lua script receives dynamic cost/capacity/refill as arguments for atomic evaluation.
 * 
 * This eliminates key cardinality explosion that occurs when each route-level limiter
 * creates its own Redis state for the same actor identity.
 */

class DynamicGlobalRateLimiter {
    constructor({ defaultTTL = 300 } = {}) {
        this.defaultTTL = defaultTTL;

        // Actor bucket definitions — loaded once from central policy
        this.actorConfig = rateLimitPolicy.actors;
        this.policyDefaults = rateLimitPolicy.defaults;

        // Setup local memory db for fallback or strictly in-memory mode
        this.localDb = new InMemoryDB('rate-limiter');

        // Cached cluster mode flag — resolved lazily on first request, immutable at runtime
        this._isCluster = null;

        // Redis EVALSHA script caching — avoid sending full script text on every request
        this._scriptSha = null;

        // Redis Lua Script for atomic token bucket check + deduct (single-pass optimized)
        // Uses redis.call('TIME') for microsecond precision instead of relying on caller timestamps
        this.LUA_SCRIPT = `
            local now_parts = redis.call('TIME')
            local now = tonumber(now_parts[1]) + tonumber(now_parts[2]) / 1000000
            local num_keys = #KEYS
            
            -- Single pass: compute all token states into a local table
            local buckets = {}
            for i = 1, num_keys do
                local key = KEYS[i]
                local max_tokens = tonumber(ARGV[(i-1)*4 + 1])
                local refill_rate = tonumber(ARGV[(i-1)*4 + 2])
                local cost = tonumber(ARGV[(i-1)*4 + 3])
                local ttl = tonumber(ARGV[(i-1)*4 + 4])
                
                local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
                local tokens = tonumber(bucket[1])
                local last_refill = tonumber(bucket[2])
                
                if not tokens or not last_refill then
                    tokens = max_tokens
                else
                    local elapsed = math.max(0, now - last_refill)
                    tokens = math.min(max_tokens, tokens + elapsed * refill_rate)
                end
                
                if tokens < cost then
                    local deficit = cost - tokens
                    local wait_time = math.ceil(deficit / refill_rate)
                    return { 0, i, math.floor(tokens), wait_time }
                end
                
                buckets[i] = { tokens = tokens, cost = cost, ttl = ttl }
            end
            
            -- Deduct from cached values (no second HMGET round-trip)
            for i = 1, num_keys do
                local b = buckets[i]
                local final_tokens = b.tokens - b.cost
                redis.call('HMSET', KEYS[i], 'tokens', final_tokens, 'last_refill', now)
                redis.call('EXPIRE', KEYS[i], b.ttl)
            end
            
            return { 1 }
        `;
    }

    /**
     * Fast non-cryptographic hash for cache key generation.
     * FNV-1a 32-bit — ~20x faster than SHA-256, perfectly suited for hash-map keying.
     * 
     * Keys are ACTOR-ONLY: "rl:<type>:<hash>" — no route suffix is ever appended.
     */
    _hashIdentifier(type, value) {
        if (!value) return null;
        const str = String(value);
        let h = 0x811c9dc5; // FNV offset basis
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = (h * 0x01000193) >>> 0; // FNV prime, keep unsigned 32-bit
        }
        return `rl:${type}:${h.toString(16)}`;
    }

    /**
     * Resolves the effective rate-limit policy for the current request.
     * Uses the central policy map from General/index.js — no constructor-fixed cost.
     * 
     * @param {string} method  - HTTP method (GET, POST, etc.)
     * @param {string} path    - Raw request path (will be normalized internally)
     * @returns {{ cost: number, ttl: number, _matchedKey: string|null, _matchType: string }}
     */
    _resolvePolicy(method, path) {
        return resolveEndpointPolicy(method, path);
    }

    /**
     * Builds the actor identifier list for a request.
     * Each actor maps to ONE canonical bucket — cost is applied uniformly from the resolved policy.
     *
     * Scope selects which actor buckets participate, because the limiter mounts at two
     * points in the pipeline. The 'edge' scope runs before authentication, where only
     * transport-level identity exists. The 'account' scope runs after authentication,
     * once `req.user` has been populated. Splitting them keeps throttling ahead of the
     * expensive auth path without double-deducting from any single bucket.
     *
     * @param {Object} req      - Express request object
     * @param {Object} metadata - Request context metadata
     * @param {Object} policy   - Resolved endpoint policy ({ cost, ttl })
     * @param {'edge'|'account'} scope - Which actor buckets to collect
     * @returns {Array<{ type: string, value: string, maxTokens: number, refillRate: number, cost: number, ttl: number }>}
     */
    _collectIdentifiers(req, metadata, policy, scope = 'edge') {
        const identifiers = [];
        const cost = policy.cost;
        const ttl = policy.ttl || this.defaultTTL;

        if (scope === 'edge') {
            // IP actor bucket
            const reqIp = metadata?.ip || req.ip;
            if (reqIp) {
                const ipConfig = this.actorConfig.ip;
                identifiers.push({
                    type: 'ip',
                    value: reqIp,
                    maxTokens: ipConfig.maxTokens,
                    refillRate: ipConfig.refillRate,
                    cost,
                    ttl
                });
            }

            // Fingerprint actor bucket (stricter capacity)
            const reqFp = metadata?.fingerprint || req.headers['orion-fingerprint'];
            if (reqFp) {
                const fpConfig = this.actorConfig.fp;
                identifiers.push({
                    type: 'fp',
                    value: reqFp,
                    maxTokens: fpConfig.maxTokens,
                    refillRate: fpConfig.refillRate,
                    cost,
                    ttl
                });
            }

            return identifiers;
        }

        // Account actor bucket (post-auth only — user identity must be present).
        // metadata is frozen before the auth middleware runs, so `req.user` is the
        // only source that reflects a completed authentication.
        const user = req.user || metadata?.user || {};
        const identity = user.uid || user.email;
        if (identity) {
            const accountConfig = this.actorConfig.account;
            identifiers.push({
                type: 'account',
                value: identity,
                maxTokens: accountConfig.maxTokens,
                refillRate: accountConfig.refillRate,
                cost,
                ttl
            });
        }

        return identifiers;
    }

    /**
     * Reports remaining tokens without letting a later, more generous bucket mask an
     * earlier constrained one — the header should always reflect the tightest bucket seen.
     */
    _applyRemainingHeader(res, remaining) {
        if (typeof remaining !== 'number') return;

        const current = res.getHeader('X-RateLimit-Remaining');
        if (typeof current === 'number' && current <= remaining) return;

        res.setHeader('X-RateLimit-Remaining', remaining);
    }

    /**
     * Builds a scoped limiter middleware. Both mount points share one policy resolution
     * path and one bucket engine — only the participating actor set differs.
     */
    _buildMiddleware(scope) {
        return async (req, res, next) => {
            try {
                // ── 1. Gather request context ────────────────────────────────
                const metadata = req.requestContext ? req.requestContext.getStore() : {};

                // ── 2. Resolve endpoint policy from central config ───────────
                const policy = this._resolvePolicy(req.method, req.path);

                // ── 3. Collect actor identifiers with policy-driven cost ─────
                const identifiers = this._collectIdentifiers(req, metadata, policy, scope);

                // Nothing to charge — unauthenticated requests skip the account pass
                // entirely rather than paying for a round-trip that deducts nothing.
                if (identifiers.length === 0) return next();

                // ── 4. Evaluate rate limit against shared actor buckets ──────
                const limitResponse = await this._checkLimit(identifiers);

                if (limitResponse.passed === false) {
                    // Over-limit — set standard rate-limit response headers
                    res.setHeader('Retry-After', limitResponse.retryAfter);
                    res.setHeader('X-RateLimit-Remaining', limitResponse.remaining);
                    res.setHeader('X-RateLimit-Reset', limitResponse.resetTimestamp);

                    return respondWithError(res, 'GENERAL::RATE-LIMIT-EXCEEDED::A::p');
                }

                // ── 5. Attach rate-limit metadata for downstream observation ─
                this._applyRemainingHeader(res, limitResponse.remaining);

                return next();

            } catch (err) {
                logger.error('RateLimiter Middleware exception:', err);
                // System failure fallback to next safely so we don't break infrastructure during a cache outage natively
                return next();
            }
        };
    }

    /**
     * Edge pass — charges the IP and fingerprint buckets. Mount immediately after
     * request metadata resolution so throttling precedes the expensive auth path.
     */
    get middleware() {
        return this._buildMiddleware('edge');
    }

    /**
     * Account pass — charges the account bucket. Mount after the authentication
     * middleware, which is the first point where `req.user` is populated.
     */
    get accountMiddleware() {
        return this._buildMiddleware('account');
    }

    /**
     * Engine layer resolving local memory checks vs regional redis grid execution autonomously.
     */
    async _checkLimit(identifiers = []) {
        if (!identifiers || identifiers.length === 0) {
            return { passed: true };
        }

        // Avoid .filter() allocation in the common case where all identifiers are valid
        let allValid = true;
        for (let i = 0; i < identifiers.length; i++) {
            if (!identifiers[i] || !identifiers[i].value) { allValid = false; break; }
        }
        const validIdentifiers = allValid ? identifiers : identifiers.filter(id => id && id.value);
        if (validIdentifiers.length === 0) return { passed: true };

        // Cache clusterMode on first invocation — it's immutable at runtime.
        // clusterMode is a locked GAP key, so getValue throws when boot never set it.
        // That throw would surface in the middleware catch and fail the request open,
        // so an unresolved flag degrades to single-node evaluation instead.
        if (this._isCluster === null) {
            try {
                this._isCluster = !!globalAccessPoint.clusterMode();
            } catch (err) {
                logger.warn('RateLimiter: clusterMode unresolved, evaluating against local memory:', err.message);
                this._isCluster = false;
            }
        }
        
        if (this._isCluster) {
            return await this._evaluateRedis(validIdentifiers);
        } else {
            return this._evaluateLocal(validIdentifiers);
        }
    }

    /**
     * EVALSHA-based Redis evaluation with automatic script caching.
     * Sends only the 40-char SHA1 hash instead of the full ~800-byte Lua source per request.
     * On NOSCRIPT miss, reloads the script and retries exactly once.
     */
    async _evalRedisScript(redisClient, keys, args) {
        // Load script on first use
        if (!this._scriptSha) {
            try {
                const sha = await redisClient.sendCommand(['SCRIPT', 'LOAD', this.LUA_SCRIPT]);
                this._scriptSha = sha;
            } catch (loadErr) {
                // Script load failed — fall through to full EVAL as last resort
                logger.warn('RateLimiter: SCRIPT LOAD failed, falling back to EVAL:', loadErr.message);
                const result = await redisClient.sendCommand(
                    ['EVAL', this.LUA_SCRIPT, keys.length.toString(), ...keys, ...args.map(String)]
                );
                return { error: false, data: result };
            }
        }

        try {
            const result = await redisClient.sendCommand(
                ['EVALSHA', this._scriptSha, keys.length.toString(), ...keys, ...args.map(String)]
            );
            return { error: false, data: result };
        } catch (err) {
            if (err.message && err.message.includes('NOSCRIPT')) {
                // Script was evicted from Redis cache — reload once and retry
                this._scriptSha = null;
                return this._evalRedisScript(redisClient, keys, args);
            }
            return { error: true, errorMessage: err.message };
        }
    }

    async _evaluateRedis(identifiers) {
        const redisInstance = redisInstanceModule.probeModule();
        if (!redisInstance || !redisInstance.client) {
            logger.warn('RateLimiter: Cluster mode is enabled but Redis is missing. Falling back to local memory limit.');
            return this._evaluateLocal(identifiers);
        }

        const keys = [];
        const args = [];
        
        for (let i = 0; i < identifiers.length; i++) {
            const id = identifiers[i];
            keys.push(this._hashIdentifier(id.type, id.value));
            args.push(
                id.maxTokens || this.policyDefaults.maxTokens,
                id.refillRate || this.policyDefaults.refillRate,
                id.cost || this.policyDefaults.cost,
                id.ttl || this.defaultTTL
            );
        }

        const result = await this._evalRedisScript(redisInstance.client, keys, args);

        if (result.error) {
            logger.error('RateLimiter Redis Error:', result.errorMessage);
            // Graceful degradation fallback
            return this._evaluateLocal(identifiers);
        }

        const resArr = result.data;
        if (resArr && resArr[0] === 0) {
            // Limited
            const failedIndex = resArr[1] - 1; // Lua arrays are 1-indexed
            const remainingTokens = resArr[2];
            const waitTime = resArr[3] || 1; 
            const failedId = identifiers[failedIndex];
            const nowSec = Math.floor(Date.now() / 1000);

            return {
                passed: false,
                reason: failedId.type,
                retryAfter: waitTime,
                remaining: remainingTokens,
                resetTimestamp: nowSec + waitTime
            };
        }

        return { passed: true };
    }

    /**
     * Local in-memory evaluation with millisecond-precision timestamps.
     * Routes to an optimized single-bucket fast path for the most common case (IP-only, pre-auth).
     */
    _evaluateLocal(identifiers) {
        if (identifiers.length === 1) return this._evaluateLocalSingle(identifiers[0]);
        return this._evaluateLocalMulti(identifiers);
    }

    /**
     * Optimized fast path for single-identifier requests (most common: IP-only pre-auth).
     * No array allocation, no loop, no intermediate state collection.
     */
    _evaluateLocalSingle(id) {
        const now = Date.now(); // ms precision
        const key = this._hashIdentifier(id.type, id.value);
        const { maxTokens = 100, refillRate = 10, cost = 1, ttl = this.defaultTTL } = id;

        const bucketRes = this.localDb.getData(key);
        let tokens;

        if (!bucketRes.exist || bucketRes.expired) {
            tokens = maxTokens;
        } else {
            tokens = bucketRes.data.tokens;
            const lastRefill = bucketRes.data.last_refill;
            const elapsedSec = Math.max(0, (now - lastRefill) / 1000);
            tokens = Math.min(maxTokens, tokens + elapsedSec * refillRate);
        }

        if (tokens < cost) {
            const deficit = cost - tokens;
            const waitTime = Math.ceil(deficit / refillRate) || 1;
            return {
                passed: false,
                reason: id.type,
                retryAfter: waitTime,
                remaining: Math.floor(tokens),
                resetTimestamp: Math.floor(now / 1000) + waitTime
            };
        }

        tokens -= cost;
        this.localDb.addData(key, { tokens, last_refill: now }, Math.floor(now / 1000) + ttl);

        return { passed: true, remaining: Math.floor(tokens) };
    }

    /**
     * Multi-identifier evaluation — single-pass collect + commit.
     * Reads each bucket from InMemoryDB exactly once (avoids double structuredClone).
     */
    _evaluateLocalMulti(identifiers) {
        const now = Date.now(); // ms precision
        const states = new Array(identifiers.length);
        let lowestRemaining = Infinity;
        
        // Single pass: compute all token states with one read per bucket
        for (let i = 0; i < identifiers.length; i++) {
            const id = identifiers[i];
            const key = this._hashIdentifier(id.type, id.value);
            const { maxTokens = 100, refillRate = 10, cost = 1, ttl = this.defaultTTL } = id;

            const bucketRes = this.localDb.getData(key);
            let tokens;

            if (!bucketRes.exist || bucketRes.expired) {
                tokens = maxTokens;
            } else {
                tokens = bucketRes.data.tokens;
                const lastRefill = bucketRes.data.last_refill;
                const elapsedSec = Math.max(0, (now - lastRefill) / 1000);
                tokens = Math.min(maxTokens, tokens + elapsedSec * refillRate);
            }

            if (tokens < cost) {
                const deficit = cost - tokens;
                const waitTime = Math.ceil(deficit / refillRate) || 1;
                return {
                    passed: false,
                    reason: id.type,
                    retryAfter: waitTime,
                    remaining: Math.floor(tokens),
                    resetTimestamp: Math.floor(now / 1000) + waitTime
                };
            }

            states[i] = { key, tokens, cost, ttl };
            const remaining = tokens - cost;
            if (remaining < lowestRemaining) lowestRemaining = remaining;
        }

        // Commit: write all buckets using cached computed state (no second read)
        const nowSec = Math.floor(now / 1000);
        for (let i = 0; i < states.length; i++) {
            const s = states[i];
            this.localDb.addData(s.key, { tokens: s.tokens - s.cost, last_refill: now }, nowSec + s.ttl);
        }

        return { passed: true, remaining: Math.floor(lowestRemaining) };
    }
}

export { DynamicGlobalRateLimiter };