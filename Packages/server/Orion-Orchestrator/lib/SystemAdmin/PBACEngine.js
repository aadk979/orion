/**
 * PBACEngine — policy-based access control for the system-admin plane.
 *
 * Policies are JSON documents:
 *
 *   {
 *     "version": 1,
 *     "statements": [
 *       { "sid": "reads", "effect": "allow", "actions": ["cluster:read:*"], "resources": ["*"] },
 *       { "sid": "no-prod", "effect": "deny", "actions": ["cluster:command:*"], "resources": ["node:WKR_prod*"] }
 *     ]
 *   }
 *
 * Evaluation semantics (deliberately IAM-like — small, predictable, auditable):
 *   1. DEFAULT DENY — an action nobody allowed is denied.
 *   2. DENY OVERRIDES — any matching deny statement wins over every allow.
 *   3. An admin's effective policy set is the union of policies attached to
 *      them directly and via their groups; statement order never matters.
 *
 * Pattern matching is segment-based on ':' — '*' matches exactly one segment,
 * a trailing '*' matches the entire remainder, and a lone '*' matches
 * anything. There is no regex and no eval: patterns are compared segment by
 * segment.
 */

const VALID_EFFECTS = new Set(['allow', 'deny']);

/** '*' | 'a:b:*' | 'a:*:c' — segment-wise glob over ':'-separated names. */
const matchesPattern = (pattern, value) => {
    if (typeof pattern !== 'string' || typeof value !== 'string' || pattern === '' || value === '') return false;
    if (pattern === '*') return true;

    const p = pattern.split(':');
    const v = value.split(':');

    for (let i = 0; i < p.length; i++) {
        const seg = p[i];
        if (seg === '*' && i === p.length - 1) {
            // Trailing wildcard swallows the rest (at least one segment).
            return v.length > i;
        }
        if (v[i] === undefined) return false;
        if (seg === '*') continue;
        if (seg !== v[i]) return false;
    }

    return p.length === v.length;
};

const statementMatches = (statement, action, resource) => {
    const actions = Array.isArray(statement.actions) ? statement.actions : [];
    const resources = Array.isArray(statement.resources) ? statement.resources : [];

    return actions.some(a => matchesPattern(a, action)) &&
        resources.some(r => matchesPattern(r, resource));
};

/**
 * Validates a policy document shape. Returns { valid, errors: [] }.
 * Used before persisting a policy so a typo can never silently grant nothing
 * (or worse, be interpreted differently later).
 */
const validatePolicyDocument = (document) => {
    const errors = [];

    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        return { valid: false, errors: ['policy document must be an object'] };
    }
    if (document.version !== 1) {
        errors.push('policy document "version" must be 1');
    }
    if (!Array.isArray(document.statements) || document.statements.length === 0) {
        errors.push('policy document must contain a non-empty "statements" array');
        return { valid: false, errors };
    }

    document.statements.forEach((s, i) => {
        const where = `statements[${i}]`;
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
            errors.push(`${where} must be an object`);
            return;
        }
        if (!VALID_EFFECTS.has(s.effect)) {
            errors.push(`${where}.effect must be "allow" or "deny"`);
        }
        if (!Array.isArray(s.actions) || s.actions.length === 0 || !s.actions.every(a => typeof a === 'string' && a.length > 0)) {
            errors.push(`${where}.actions must be a non-empty array of strings`);
        }
        if (!Array.isArray(s.resources) || s.resources.length === 0 || !s.resources.every(r => typeof r === 'string' && r.length > 0)) {
            errors.push(`${where}.resources must be a non-empty array of strings`);
        }
        if (s.sid !== undefined && typeof s.sid !== 'string') {
            errors.push(`${where}.sid must be a string when present`);
        }
    });

    return { valid: errors.length === 0, errors };
};

/**
 * Evaluates an action/resource pair against a set of policy documents.
 * @param {Array<object>} documents - effective policy documents (direct + group)
 * @param {string} action - e.g. 'cluster:command:server:lock'
 * @param {string} resource - e.g. 'node:WKR_abc' or 'cluster'
 * @returns {{ allowed: boolean, reason: string, matchedSid: string|null }}
 */
const evaluate = (documents, action, resource = 'cluster') => {
    let allowedBy = null;

    for (const doc of Array.isArray(documents) ? documents : []) {
        const statements = Array.isArray(doc?.statements) ? doc.statements : [];
        for (const statement of statements) {
            if (!VALID_EFFECTS.has(statement?.effect)) continue;
            if (!statementMatches(statement, action, resource)) continue;

            if (statement.effect === 'deny') {
                // Deny overrides — stop immediately.
                return { allowed: false, reason: 'explicit-deny', matchedSid: statement.sid || null };
            }
            allowedBy = statement.sid || 'unnamed-allow';
        }
    }

    return allowedBy !== null
        ? { allowed: true, reason: 'allow', matchedSid: allowedBy }
        : { allowed: false, reason: 'default-deny', matchedSid: null };
};

export { evaluate, matchesPattern, validatePolicyDocument };
