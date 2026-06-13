import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';

const NAME_SPACE = globalAccessPoint.nameSpace();

/**
 * Central Rate-Limit Policy Configuration
 * =========================================
 * 
 * Single source of truth for all endpoint rate-limit behavior.
 * 
 * - `defaults`: Global token bucket parameters applied when no route-specific override exists.
 * - `actors`:   Per-actor-type bucket sizing. Each actor (ip, fp, account) gets ONE canonical
 *               bucket in Redis/memory — route policy only changes the *cost* deducted from it.
 * - `routes`:   Endpoint-specific cost overrides keyed by "METHOD /normalized/path".
 *               Higher cost = more expensive to call = stronger throttling from shared bucket.
 * - `fallback`: Policy applied to any request whose route doesn't match an explicit entry.
 *               Must never be zero-cost to prevent accidental unlimited access.
 */
const rateLimitPolicy = {

    // ── Global defaults ──────────────────────────────────────────────────
    defaults: {
        cost: 1,          // Standard request cost (most endpoints)
        ttl: 300,         // Bucket key TTL in seconds
        refillRate: 10,   // Tokens restored per second (global default)
        maxTokens: 100    // Bucket capacity (global default)
    },

    // ── Actor-class bucket definitions ───────────────────────────────────
    // Each actor type gets its own multiplier relative to defaults.
    // Redis key = "rl:<type>:<hash>" — NO route suffix ever appended.
    actors: {
        ip: {
            maxTokens: 100,
            refillRate: 10
        },
        fp: {
            maxTokens: 50,
            refillRate: 5
        },
        account: {
            maxTokens: 150,
            refillRate: 15
        }
    },

    // ── Route-specific cost overrides ────────────────────────────────────
    // Key format: "METHOD /namespace/api/version/segment/endpoint"
    // Only endpoints that deviate from defaults.cost need an entry here.
    //
    // Cost tiers:
    //   1  = standard (implicit default, no entry needed)
    //   2  = moderate (slightly expensive ops)
    //   3  = heavy    (crypto, DB writes, external calls)
    //   5  = critical (auth attempts, abuse-prone surfaces)
    //  10  = extreme  (bulk exports, uploads, search)
    routes: {
        // ── Auth: abuse-prone, high cost ─────────────────────────────────
        [`POST /${NAME_SPACE}/api/v1/action/sign-up-user`]:                          { cost: 5 },
        [`POST /${NAME_SPACE}/api/v1/action/sign-in-user`]:                          { cost: 5 },
        [`POST /${NAME_SPACE}/api/v1/action/sign-in-with-passkey-authentication`]:   { cost: 5 },
        [`POST /${NAME_SPACE}/api/v1/action/complete-passkey-sign-up`]:              { cost: 5 },

        // ── Token generation: moderate cost ──────────────────────────────
        [`POST /${NAME_SPACE}/api/v1/action/generate-no-auth-token-transaction`]:    { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/generate-no-auth-token`]:                { cost: 3 },

        // ── Passkey ceremony: crypto-heavy ───────────────────────────────
        [`POST /${NAME_SPACE}/api/v1/action/generate-passkey-registration-options`]: { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/complete-passkey-registration`]:         { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/generate-passkey-authentication-options`]: { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/generate-passkey-sign-up-options`]:      { cost: 3 },

        // ── OAuth: external calls ────────────────────────────────────────
        [`POST /${NAME_SPACE}/api/v1/action/get-o-auth-redirect-url`]:               { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/authorize-me`]:                          { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/handle-o-auth-callback`]:                { cost: 3 },

        // ── 2FA / device auth: moderate ──────────────────────────────────
        [`POST /${NAME_SPACE}/api/v1/action/send-device-authorization-email`]:       { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/authorize-device-with-passkey`]:         { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/authorize-device-with-totp`]:            { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/generate-totp-secret`]:                  { cost: 3 },
        [`POST /${NAME_SPACE}/api/v1/action/verify-and-enable-totp`]:                { cost: 3 },

        // ── Session management ───────────────────────────────────────────
        [`POST /${NAME_SPACE}/api/v1/action/sign-out-user`]:                         { cost: 1 },
        [`POST /${NAME_SPACE}/api/v1/action/configure-dip`]:                         { cost: 2 },

        // ── Read-only / lightweight ──────────────────────────────────────
        [`POST /${NAME_SPACE}/api/v1/request/have-no-auth-token`]:                   { cost: 1 },
        [`POST /${NAME_SPACE}/api/v1/request/encryption-request-key`]:               { cost: 1 },
        [`POST /${NAME_SPACE}/api/v1/request/available-2fa-methods`]:                { cost: 1 }
    },

    // ── Fallback for unmatched routes ────────────────────────────────────
    // Never zero — every request must cost something to prevent unlimited access.
    fallback: {
        cost: 1,
        ttl: 300
    }
};

// ── Deep-freeze the policy at module evaluation time ─────────────────────────
// Prevents accidental runtime mutation from silently altering limiter behavior.
Object.freeze(rateLimitPolicy.defaults);
Object.freeze(rateLimitPolicy.actors.ip);
Object.freeze(rateLimitPolicy.actors.fp);
Object.freeze(rateLimitPolicy.actors.account);
Object.freeze(rateLimitPolicy.actors);
Object.freeze(rateLimitPolicy.fallback);
Object.freeze(rateLimitPolicy);

/**
 * Validates the policy table at boot time.
 * Ensures every route entry has a sane cost value and the fallback is non-zero.
 * Call once at server startup before the limiter middleware is mounted.
 * 
 * @param {typeof rateLimitPolicy} policy
 * @throws {Error} on invalid cost values or missing fallback
 */
function validateRateLimitPolicy(policy) {
    const VALID_COSTS = [1, 2, 3, 5, 10];
    for (const [key, entry] of Object.entries(policy.routes)) {
        if (!VALID_COSTS.includes(entry.cost)) {
            throw new Error(
                `RateLimitPolicy: invalid cost ${entry.cost} on route "${key}". ` +
                `Must be one of ${VALID_COSTS.join(', ')}.`
            );
        }
    }
    if (!policy.fallback || policy.fallback.cost <= 0) {
        throw new Error('RateLimitPolicy: fallback.cost must be > 0.');
    }
    if (!policy.defaults || policy.defaults.cost <= 0) {
        throw new Error('RateLimitPolicy: defaults.cost must be > 0.');
    }
}

/**
 * Normalizes a raw URL path by replacing dynamic segments with `:id` tokens.
 * Matches UUID-v4 and pure numeric IDs only — intentionally excludes short hex
 * strings to avoid collapsing semantic route segments that happen to be all-hex.
 * 
 * Example: "/alpine/api/v1/products/9dc5b7f5-e2a8-43d1-a243-588ed7f422fa"
 *       -> "/alpine/api/v1/products/:id"
 */
const DYNAMIC_SEGMENT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|^\d+$/i;

function normalizeRoutePath(rawPath) {
    if (!rawPath) return '/';
    // Strip query string and trailing slash
    const clean = rawPath.split('?')[0].replace(/\/+$/, '') || '/';
    return clean
        .split('/')
        .map(seg => DYNAMIC_SEGMENT_PATTERN.test(seg) ? ':id' : seg)
        .join('/');
}

/**
 * Resolves the effective rate-limit policy for a given request.
 * 
 * Resolution order:
 *   1. Exact match:  "METHOD /normalized/path"
 *   2. Wildcard method: "* /normalized/path"
 *   3. Fallback default
 * 
 * Returns a frozen policy object: { cost, ttl }
 */
function resolveEndpointPolicy(method, rawPath) {
    const normalizedPath = normalizeRoutePath(rawPath);
    const upperMethod = (method || 'GET').toUpperCase();

    // 1. Exact match — route entry wins over defaults, fallback is NOT merged
    const exactKey = `${upperMethod} ${normalizedPath}`;
    if (rateLimitPolicy.routes[exactKey]) {
        return Object.freeze({
            ...rateLimitPolicy.defaults,
            ...rateLimitPolicy.routes[exactKey],
            _debug: { matchedKey: exactKey, matchType: 'exact' }
        });
    }

    // 2. Wildcard method — same precedence rules as exact match
    const wildcardKey = `* ${normalizedPath}`;
    if (rateLimitPolicy.routes[wildcardKey]) {
        return Object.freeze({
            ...rateLimitPolicy.defaults,
            ...rateLimitPolicy.routes[wildcardKey],
            _debug: { matchedKey: wildcardKey, matchType: 'wildcard' }
        });
    }

    // 3. Fallback — only branch where fallback values are used
    return Object.freeze({
        ...rateLimitPolicy.defaults,
        ...rateLimitPolicy.fallback,
        _debug: { matchedKey: null, matchType: 'fallback' }
    });
}

export { rateLimitPolicy, normalizeRoutePath, resolveEndpointPolicy, validateRateLimitPolicy };