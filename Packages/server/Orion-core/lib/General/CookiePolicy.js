import { parseDuration } from '../Utils/Date&Time.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';

/**
 * Central Cookie Policy Configuration
 * ====================================
 *
 * Single source of truth for every cookie the server sets or clears. When a
 * cookie is set through the managed helpers (setManagedCookie / clearManagedCookie
 * in Utils/CookieUtils.js) the config here is FINAL — those helpers take no
 * options argument, so a caller going through them cannot override any attribute
 * (httpOnly / secure / sameSite / path / maxAge). It names the cookie and gives
 * the value; everything else is decided here.
 *
 * This is a safeguard, not a jail. Calling `response.cookie(...)` directly is
 * still possible and remains a valid escape hatch — it's just discouraged,
 * because that's the path that historically drifted (some passkey clean-up paths
 * used `secure: false`, some clears forgot `path` so the browser never dropped
 * the cookie, etc). Route new cookies through the managed helpers so they inherit
 * this policy by default.
 *
 * - `base`:    Security attributes applied to EVERY cookie. A per-cookie entry
 *              may tighten/override them, but a controller never can.
 * - `cookies`: Per-cookie config keyed by the exact cookie name. Each entry
 *              declares its lifespan via exactly one of:
 *                • `maxAge`     — a duration string ('5h','15m','30s','1d') or
 *                                 a number of milliseconds.
 *                • `maxAgeFrom` — a dot-path into `systemConfig` whose value is a
 *                                 duration string, resolved at request time
 *                                 (used for token cookies whose TTL is
 *                                 operator-configured, not hard-coded).
 *              An entry may also override any `base` attribute (e.g. a scoped
 *              `path`) — but that override lives HERE, in config, not in a call.
 *
 * To change how any endpoint's cookie behaves, edit its entry below. There is
 * intentionally no runtime knob to bypass it.
 */
const cookiePolicy = {
    // ── Base security attributes (applied to all cookies) ────────────────
    base: {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        path: '/'
    },

    // ── Per-cookie config, grouped by owning controller ──────────────────
    cookies: {
        // ── Session tokens (SignIn / OAuth callback / passkey sign-in /
        //    authentication middleware refresh) ────────────────────────────
        // Lifespan is operator-configured in systemConfig.tokens.lifespans.*
        ACCESS_TOKEN: { maxAgeFrom: 'tokens.lifespans.accessTokens' },
        REFRESH_TOKEN: { maxAgeFrom: 'tokens.lifespans.refreshTokens' },

        // ── No-auth token (NoAuthToken) ──────────────────────────────────
        NO_AUTH_TOKEN: { maxAge: '1d' },

        // ── OAuth redirect flow (GenerateRedirectURL / HandleOAuthCallback)
        oAuthFlowSecret: { maxAge: '2m' },

        // ── Step-up auth (StepUpAuth / authentication middleware) ─────────
        STEP_UP_TOKEN: { maxAge: '5h' },
        stepUpEmailReqId: { maxAge: '10m' },
        stepUpFlowSecret: { maxAge: '10m' },
        stepUpContext: { maxAge: '10m' },

        // ── Device authorization (DeviceAuthorization / deviceScanner) ────
        deviceAuthorizationRequestId: { maxAge: '15m' },
        deviceAuthEmailOffset: { maxAge: '15m' },
        deviceAuthFlowSecret: { maxAge: '15m' },
        authorizedDeviceId: { maxAge: '7d' },
        authorizedDeviceCode: { maxAge: '7d' },

        // ── Password reset (PasswordReset) ───────────────────────────────
        passwordResetRequestId: { maxAge: '15m' },

        // ── 2FA method removal (Remove2FAMethod) ─────────────────────────
        twoFARemovalRequestId: { maxAge: '15m' },

        // ── Passkey ceremony scratch cookies (generate*Options /
        //    SignUpWithPasskey / completeRegistration) ─────────────────────
        'PASSKEY-REGISTRATION-INFO-STEP-1': { maxAge: '30s' },
        'PASSKEY-AUTHENTICATION-INFO-STEP-1': { maxAge: '30s' },
        'PASSKEY-SIGN-UP-INFO-STEP-1': { maxAge: '60s' }
    }
};

// ── Deep-freeze so runtime code can never mutate the policy ──────────────────
Object.freeze(cookiePolicy.base);
for (const entry of Object.values(cookiePolicy.cookies)) {
    Object.freeze(entry);
}
Object.freeze(cookiePolicy.cookies);
Object.freeze(cookiePolicy);

/**
 * Reads a dot-path (e.g. "tokens.lifespans.accessTokens") out of an object.
 * @returns {*} the value at the path, or undefined if any segment is missing
 */
function readPath(source, dotPath) {
    return dotPath.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

/**
 * Resolves a policy entry's lifespan into a millisecond number.
 * `maxAge` is used directly (duration string or number); `maxAgeFrom` is pulled
 * from live systemConfig at call time. This is the ONLY place a cookie's maxAge
 * is decided — callers cannot supply one.
 */
function resolveMaxAge(name, entry) {
    if ('maxAge' in entry) {
        return typeof entry.maxAge === 'number' ? entry.maxAge : parseDuration(entry.maxAge);
    }

    // maxAgeFrom → live systemConfig
    const systemConfig = globalAccessPoint.systemConfig();
    const raw = readPath(systemConfig, entry.maxAgeFrom);
    if (raw == null) {
        throw new Error(`CookiePolicy: cookie "${name}" maxAgeFrom "${entry.maxAgeFrom}" is not set in systemConfig.`);
    }
    return typeof raw === 'number' ? raw : parseDuration(raw);
}

/**
 * Resolves the full, final Express cookie-options object for a named cookie.
 * The returned object is authoritative — there is no override channel.
 *
 * @param {string} name  Exact cookie name (a key in `cookiePolicy.cookies`)
 * @returns {object} Frozen options for `response.cookie(name, value, options)`
 * @throws {Error} for an unregistered cookie name
 */
function resolveCookieOptions(name) {
    const entry = cookiePolicy.cookies[name];
    if (!entry) {
        throw new Error(`CookiePolicy: no policy registered for cookie "${name}". Add it to General/CookiePolicy.js.`);
    }

    // Strip the lifespan descriptors; everything else on the entry is a genuine
    // Express attribute override (e.g. a scoped path) and is config-owned.
    const { maxAge: _m, maxAgeFrom: _mf, ...attributeOverrides } = entry;

    return Object.freeze({
        ...cookiePolicy.base,
        ...attributeOverrides,
        maxAge: resolveMaxAge(name, entry)
    });
}

/**
 * Resolves the FINAL options used to CLEAR a named cookie.
 *
 * A cookie is only dropped by the browser when the clearing attributes
 * (path / sameSite / secure / httpOnly) match those it was set with — so this
 * reuses the exact same policy attributes and only forces `maxAge: 0`.
 *
 * @param {string} name  Exact cookie name
 * @returns {object} Frozen clear-options object
 * @throws {Error} for an unregistered cookie name
 */
function resolveClearOptions(name) {
    const entry = cookiePolicy.cookies[name];
    if (!entry) {
        throw new Error(`CookiePolicy: no policy registered for cookie "${name}". Add it to General/CookiePolicy.js.`);
    }

    const { maxAge: _m, maxAgeFrom: _mf, ...attributeOverrides } = entry;

    return Object.freeze({
        ...cookiePolicy.base,
        ...attributeOverrides,
        maxAge: 0
    });
}

/**
 * Validates the policy table at boot time. Ensures every cookie declares exactly
 * one lifespan source and never weakens the sameSite=None ⇒ secure guarantee.
 * Call once at server startup.
 *
 * @param {typeof cookiePolicy} policy
 * @throws {Error} on an invalid entry
 */
function validateCookiePolicy(policy = cookiePolicy) {
    for (const [name, entry] of Object.entries(policy.cookies)) {
        const hasStatic = 'maxAge' in entry;
        const hasDynamic = 'maxAgeFrom' in entry;

        if (hasStatic === hasDynamic) {
            throw new Error(`CookiePolicy: cookie "${name}" must declare exactly one of maxAge / maxAgeFrom.`);
        }
        if (hasStatic) {
            const ok = typeof entry.maxAge === 'number' || (typeof entry.maxAge === 'string' && parseDuration(entry.maxAge) > 0);
            if (!ok) {
                throw new Error(`CookiePolicy: cookie "${name}" has an invalid maxAge "${String(entry.maxAge)}".`);
            }
        }
        const secure = 'secure' in entry ? entry.secure : policy.base.secure;
        const sameSite = 'sameSite' in entry ? entry.sameSite : policy.base.sameSite;
        if (sameSite === 'None' && secure === false) {
            throw new Error(`CookiePolicy: cookie "${name}" uses sameSite=None with secure=false — browsers reject this.`);
        }
    }
}

export { cookiePolicy, resolveCookieOptions, resolveClearOptions, validateCookiePolicy };
