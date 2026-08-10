/**
 * Boot-time validation of `utilities.dataEncryption`.
 *
 * The distinction this file exists to draw:
 *
 *   STRUCTURAL errors are the operator's, they are deterministic, and they will
 *   never fix themselves — a misspelled key, an unknown provider, a missing
 *   required value, an inline key in a cluster. These THROW and stop the boot,
 *   because a node that starts anyway silently runs without the protection its
 *   config says it has.
 *
 *   RUNTIME errors belong to the environment and may resolve on their own — an
 *   unreachable vault, rejected credentials, a failed round trip. Those degrade
 *   (see KeyVaultManager): TOTP deactivates, enrolled users fall back to the
 *   emailed one-time code, and nobody is locked out.
 *
 * Collapsing the two is what let a typo like `dataEncryption.secret` sail past
 * as "encryption unavailable" instead of "you spelled it wrong".
 *
 * The per-provider schemas live on the provider classes themselves, next to the
 * `_require()` calls that consume them, so the two cannot drift.
 */

import { PROVIDER_REGISTRY, ALLOWED_PROVIDERS } from './KeyVaultManager.js';

/**
 * Keys valid for every provider, independent of which one is selected.
 *
 * `key` is here rather than only on INLINE_KEY because a deployment migrating
 * to a vault legitimately keeps it around to read pre-vault `enc.v1.` rows —
 * handleDataEncryptionSetup falls back to it when `legacyKey` is absent.
 */
const COMMON_KEYS = Object.freeze(['provider', 'key', 'explicitAllow', 'timeoutMs', 'legacyKey', 'required']);

/** Levenshtein distance, capped — only used to suggest a correction. */
const editDistance = (a, b) => {
    if (a === b) return 0;

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

    for (let i = 1; i <= a.length; i++) {
        const current = [i];

        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }

        previous = current;
    }

    return previous[b.length];
};

/**
 * The closest legal key to a typo, if one is close enough to be worth naming.
 * Case-insensitive first (so `keyid` finds `keyId`), then edit distance.
 */
const suggest = (unknown, candidates) => {
    const lower = String(unknown).toLowerCase();

    const caseMatch = candidates.find(candidate => candidate.toLowerCase() === lower);
    if (caseMatch) return caseMatch;

    // A third of the word may differ before a suggestion becomes noise.
    const threshold = Math.max(2, Math.floor(unknown.length / 3));
    let best = null;
    let bestDistance = Infinity;

    for (const candidate of candidates) {
        const distance = editDistance(lower, candidate.toLowerCase());
        if (distance < bestDistance && distance <= threshold) {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best;
};

const isPresent = value => value !== undefined && value !== null && String(value).trim() !== '';

/**
 * Every key a given provider recognizes, including the common ones.
 * De-duplicated: a key may legitimately appear in more than one bucket (INLINE_KEY
 * requires `key`, which is also a shared key), and listing it twice in an error
 * message reads like a bug in the validator.
 */
const knownKeysFor = schema => [
    ...new Set([
        ...COMMON_KEYS,
        ...(schema.required || []),
        ...(schema.optional || []),
        ...Object.keys(schema.envFallbacks || {}),
        ...(schema.oneOf || []).flatMap(group => group.keys)
    ])
];

/**
 * Validates the shape of `utilities.dataEncryption`.
 *
 * Pure and non-throwing so it is testable and reusable; the caller decides that
 * a structural failure is fatal.
 *
 * @returns {{ valid: boolean, errors: string[], warnings: string[], providerId: string|null }}
 */
const validateDataEncryptionConfig = (config, { clusterMode = false } = {}) => {
    const errors = [];
    const warnings = [];

    if (config === undefined || config === null) {
        return { valid: true, errors, warnings, providerId: null };
    }

    if (typeof config !== 'object' || Array.isArray(config)) {
        return { valid: false, errors: ['utilities.dataEncryption must be an object'], warnings, providerId: null };
    }

    // ── Provider selection ───────────────────────────────────────────────────
    const rawProvider = config.provider;
    const providerId = rawProvider ? String(rawProvider).toUpperCase().trim() : config.key ? 'INLINE_KEY' : null;

    if (rawProvider !== undefined && typeof rawProvider !== 'string') {
        return { valid: false, errors: [`utilities.dataEncryption.provider must be a string (received ${typeof rawProvider})`], warnings, providerId: null };
    }

    if (!providerId) {
        // Nothing configured at all. Not an error here — the caller decides
        // whether an absent block is acceptable — but a typo'd `provider` key
        // (e.g. `providor`) would otherwise vanish, so check for one.
        const stray = Object.keys(config).find(key => suggest(key, COMMON_KEYS) === 'provider');

        if (stray) {
            errors.push(`utilities.dataEncryption.${stray} is not a recognized key — did you mean "provider"?`);
        }

        return { valid: errors.length === 0, errors, warnings, providerId: null };
    }

    const ProviderClass = PROVIDER_REGISTRY[providerId];

    if (!ProviderClass) {
        const hint = suggest(providerId, Object.keys(PROVIDER_REGISTRY));

        errors.push(
            `utilities.dataEncryption.provider "${rawProvider}" is not a supported provider${hint ? ` — did you mean "${hint}"?` : '.'} ` +
                `Supported: ${Object.keys(PROVIDER_REGISTRY).join(', ')}.`
        );

        return { valid: false, errors, warnings, providerId: null };
    }

    const schema = ProviderClass.configSchema || {};
    const label = ProviderClass.displayName;

    // ── Deployment-shape and allowlist gates ─────────────────────────────────
    // Both are operator decisions, not environmental conditions, so both are
    // fatal here rather than degrading at runtime.
    if (providerId === 'INLINE_KEY' && clusterMode) {
        errors.push(
            'utilities.dataEncryption is set to INLINE_KEY, which is refused in cluster mode: a symmetric key copied into every node ' +
                'cannot be revoked, rotated or audited. Configure a key vault provider, or run single-instance (utilities.ephemeralDB.provider: "LOCAL_DB").'
        );
    }

    if (!ALLOWED_PROVIDERS.includes(providerId) && config.explicitAllow !== true) {
        errors.push(
            `The "${providerId}" key vault integration is disabled in this release as it has not been fully tested against a live account. ` +
                'Set `explicitAllow: true` in utilities.dataEncryption to override.'
        );
    }

    // ── Unknown keys — the typo catcher ──────────────────────────────────────
    const known = knownKeysFor(schema);

    for (const key of Object.keys(config)) {
        if (known.includes(key)) continue;

        const hint = suggest(key, known);

        errors.push(
            `utilities.dataEncryption.${key} is not a recognized key for ${label}` +
                `${hint ? ` — did you mean "${hint}"?` : `. Recognized: ${known.sort().join(', ')}.`}`
        );
    }

    // ── Required keys ────────────────────────────────────────────────────────
    const satisfied = key => isPresent(config[key]) || (schema.envFallbacks?.[key] || []).some(name => isPresent(process.env[name]));

    for (const key of schema.required || []) {
        if (satisfied(key)) continue;

        const envNames = schema.envFallbacks?.[key] || [];

        errors.push(
            `utilities.dataEncryption.${key} is required by ${label}` +
                `${envNames.length ? ` (or set ${envNames.join(' / ')} in the environment)` : ''}.`
        );
    }

    // ── Either/or groups ─────────────────────────────────────────────────────
    for (const group of schema.oneOf || []) {
        if (group.keys.every(satisfied)) continue;

        // A partially-filled group is a much more specific mistake than an
        // empty one, so it gets its own message naming what is missing.
        const partial = group.keys.filter(satisfied);

        if (partial.length > 0) {
            const missing = group.keys.filter(key => !satisfied(key));
            errors.push(`${label}: utilities.dataEncryption.${partial.join(' / ')} is set but ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} missing.`);
        }
    }

    const groupsSatisfied = (schema.oneOf || []).filter(group => group.keys.every(satisfied));

    if ((schema.oneOf || []).length > 0 && groupsSatisfied.length === 0) {
        const options = schema.oneOf.map(group => `${group.label} (${group.keys.join(' + ')})`).join(', or ');
        errors.push(`${label} needs one of: ${options}.`);
    }

    // ── Type sanity on the shared keys ───────────────────────────────────────
    if (config.timeoutMs !== undefined && (!Number.isFinite(Number(config.timeoutMs)) || Number(config.timeoutMs) <= 0)) {
        errors.push(`utilities.dataEncryption.timeoutMs must be a positive number (received ${JSON.stringify(config.timeoutMs)}).`);
    }

    if (config.explicitAllow !== undefined && typeof config.explicitAllow !== 'boolean') {
        errors.push(`utilities.dataEncryption.explicitAllow must be a boolean (received ${typeof config.explicitAllow}).`);
    }

    if (config.required !== undefined && typeof config.required !== 'boolean') {
        errors.push(`utilities.dataEncryption.required must be a boolean (received ${typeof config.required}).`);
    }

    // ── Advisory ─────────────────────────────────────────────────────────────
    if (providerId !== 'INLINE_KEY' && isPresent(config.key) && !isPresent(config.legacyKey)) {
        warnings.push(
            'utilities.dataEncryption.key is set alongside a key vault provider. It is being used only to read pre-vault `enc.v1.` rows; ' +
                'rename it to `legacyKey` to make that explicit, and remove it once a DEK rotation reports 0 stale rows.'
        );
    }

    return { valid: errors.length === 0, errors, warnings, providerId };
};

export { validateDataEncryptionConfig, COMMON_KEYS, knownKeysFor };
