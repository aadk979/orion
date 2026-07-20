import { rateLimit } from 'express-rate-limit';

import { respondWithError } from '../Response/response.js';
import { logger } from '../../Utils/logger.js';

/**
 * Global Flood Guard — Coarse, Pre-Parse Request Breaker
 * ========================================================
 *
 * This is a deliberately dumb, cheap first line of defense mounted at the very
 * TOP of the middleware pipeline — ahead of body parsing (`express.json`),
 * CORS, helmet, and every custom middleware.
 *
 * Why it exists (defense-in-depth):
 *   The nuanced per-actor limiter (DynamicGlobalRateLimiter) mounts deeper in
 *   the chain, after `express.json({ limit: '10mb' })` and eight other
 *   middlewares. That means a flood of malformed requests — e.g. ones missing
 *   the `orion-*` headers that later get rejected by headerParser — still pays
 *   the full cost of body parsing and eight middleware hops before any throttle
 *   applies. This guard rejects egregious floods by raw IP BEFORE a single byte
 *   of the body is parsed, protecting the parser itself.
 *
 * It intentionally does NOT replace DynamicGlobalRateLimiter — that limiter
 * still owns fine-grained, policy-driven, per-actor (ip/fingerprint/account)
 * throttling. This one only trips on gross volume.
 *
 * `trust proxy` is set at server init, so express-rate-limit resolves the real
 * client IP from X-Forwarded-For.
 */

const FLOOD_GUARD_DEFAULTS = Object.freeze({
    enabled: true,
    windowMs: 60_000, // 1 minute
    max: 1000 // permissive safety net — only trips on egregious floods
});

/**
 * Builds the global flood-guard middleware from config.
 *
 * @param {Object} config - utilities.rateLimiter.floodGuard config block
 * @param {boolean} [config.enabled=true] - master switch
 * @param {number}  [config.windowMs=60000] - rolling window length in ms
 * @param {number}  [config.max=1000] - max requests per IP per window
 * @returns {Function} an Express middleware (pass-through no-op when disabled)
 */
const buildGlobalFloodGuard = (config = {}) => {
    const settings = { ...FLOOD_GUARD_DEFAULTS, ...config };

    // Disabled → hand back a transparent pass-through so the pipeline shape is
    // unchanged and callers don't need to conditionally include it.
    if (settings.enabled === false) {
        return (req, res, next) => next();
    }

    logger.info(`Global flood guard active: max ${settings.max} req / ${settings.windowMs}ms per IP`);

    return rateLimit({
        windowMs: settings.windowMs,
        limit: settings.max, // express-rate-limit v8 option name (`max` is the legacy alias)
        standardHeaders: true, // RateLimit-* headers (draft standard)
        legacyHeaders: false, // no X-RateLimit-* legacy headers
        // Route the 429 through Orion's error envelope so the flood response is
        // shaped identically to every other Orion error (and to the deeper
        // per-actor limiter's over-limit response).
        handler: (req, res /*, next, options */) => {
            return respondWithError(res, 'GENERAL::RATE-LIMIT-EXCEEDED::A::p');
        }
    });
};

export { buildGlobalFloodGuard, FLOOD_GUARD_DEFAULTS };
