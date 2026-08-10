/**
 * Security Event Tokens — RFC 8417.
 *
 * A SET is a JWT that reports something that HAPPENED, as opposed to an access
 * token, which asserts something a bearer MAY DO. That distinction drives every
 * rule below and is the usual source of bugs when a codebase already has JWT
 * plumbing lying around and reaches for it here:
 *
 *   - `typ` MUST be `secevent+jwt` (§2.3). A receiver uses it to refuse a SET
 *     presented as an access token, and an access token presented as a SET.
 *     Explicit typing is the defence against exactly that confusion, so it is
 *     verified, not merely set.
 *   - A SET carries NO `exp` (§4.1.4). It is a statement about the past; there
 *     is no window during which it stops being true. Freshness is handled by
 *     `iat` plus `jti` replay tracking, which is what the receiver here does.
 *   - `sub` at the top level is discouraged (§2.2); the subject belongs inside
 *     each event, expressed as an RFC 9493 Subject Identifier.
 *
 * Signing reuses the framework's existing key-pair manager, so SETs rotate with
 * the same machinery as everything else and receivers can resolve the signing
 * key by `kid` through the JWKS endpoint.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { generateId } from '../../valueGenerator.js';
import { logger } from '../../logger.js';

/** RFC 8417 §2.3 — explicit typing, the anti-confusion control. */
const SET_TYP = 'secevent+jwt';

/** Reject a SET whose `iat` is this far from now, in seconds. */
const MAX_IAT_SKEW_SECONDS = 300;

/**
 * Subject Identifiers — RFC 9493.
 *
 * Every identifier is an object carrying a `format` discriminator, which is
 * what lets a receiver know how to interpret the rest without guessing. Bare
 * strings are not acceptable subjects.
 */
const SubjectFormats = {
    ISS_SUB: 'iss_sub',
    OPAQUE: 'opaque',
    EMAIL: 'email',
    URI: 'uri'
};

/**
 * The canonical subject for an Orion user: the issuer that owns the identity
 * plus its local id. Portable across receivers in a way a bare uid is not,
 * because the uid is only meaningful relative to the issuer that minted it.
 */
/**
 * Note the null-guards. `String(null)` is the string `"null"`, which would sail
 * through validation and produce an event naming a subject that does not exist
 * — a revocation aimed at nobody, indistinguishable from one that worked.
 * Absent input must stay absent so `isValidSubject` can reject it.
 */
const coerce = value => (value === null || value === undefined ? value : String(value));

const issSubSubject = (iss, uid) => ({ format: SubjectFormats.ISS_SUB, iss, sub: coerce(uid) });

/** A single session rather than a whole account — used for targeted revocation. */
const opaqueSubject = id => ({ format: SubjectFormats.OPAQUE, id: coerce(id) });

const emailSubject = email => ({ format: SubjectFormats.EMAIL, email: coerce(email) });

/**
 * Validates a subject identifier well enough that a receiver can act on it.
 * Deliberately strict: an event whose subject cannot be resolved is worse than
 * no event, because it looks like coverage without providing any.
 */
const isValidSubject = subject => {
    if (!subject || typeof subject !== 'object' || typeof subject.format !== 'string') return false;

    switch (subject.format) {
        case SubjectFormats.ISS_SUB:
            return typeof subject.iss === 'string' && subject.iss.length > 0 && typeof subject.sub === 'string' && subject.sub.length > 0;
        case SubjectFormats.OPAQUE:
            return typeof subject.id === 'string' && subject.id.length > 0;
        case SubjectFormats.EMAIL:
            return typeof subject.email === 'string' && subject.email.includes('@');
        case SubjectFormats.URI:
            return typeof subject.uri === 'string' && subject.uri.length > 0;
        default:
            // Unknown formats are refused rather than passed through: a receiver
            // that cannot identify the subject cannot apply the event.
            return false;
    }
};

/**
 * Builds an unsigned SET claim set.
 *
 * @param {object} params
 * @param {string} params.issuer          transmitter identifier (`iss`)
 * @param {string|string[]} params.audience receiver identifier(s) (`aud`)
 * @param {object} params.events          map of event URI → event payload
 * @param {string} [params.txn]           correlates several SETs from one action
 * @returns {object} the claim set
 */
const buildSetClaims = ({ issuer, audience, events, txn = null }) => {
    if (!issuer) throw new Error('SET: issuer is required');
    if (!audience) throw new Error('SET: audience is required');
    if (!events || typeof events !== 'object' || Object.keys(events).length === 0) {
        throw new Error('SET: at least one event is required');
    }

    return {
        iss: issuer,
        aud: audience,
        jti: generateId('SET', 24),
        iat: Math.floor(Date.now() / 1000),
        ...(txn ? { txn } : {}),
        events
        // Deliberately no `exp` and no top-level `sub` — see the header note.
    };
};

/**
 * Signs a SET.
 *
 * @param {object} claims        from buildSetClaims
 * @param {object} signingPair   a TokenSecretsManager key pair
 * @returns {string} compact JWS
 */
const signSet = (claims, signingPair) => {
    if (!signingPair?._nodePrivateKey) {
        throw new Error('SET: no usable signing key');
    }

    return jwt.sign(claims, signingPair._nodePrivateKey, {
        algorithm: signingPair.generationConfig.algorithm,
        keyid: signingPair.keyPairId,
        header: { typ: SET_TYP }
        // `expiresIn` is deliberately absent — RFC 8417 §4.1.4.
    });
};

/** kid from a SET header, so a receiver can resolve the verification key. */
const setKeyId = token => {
    try {
        return jwt.decode(token, { complete: true })?.header?.kid || null;
    } catch {
        return null;
    }
};

/**
 * Verifies a received SET.
 *
 * @param {object} params
 * @param {string} params.token
 * @param {object} params.verificationPair  key pair resolved from the SET's kid
 * @param {string} params.expectedIssuer
 * @param {string} params.expectedAudience
 * @param {object} [params.replayGuard]     { isFresh(jti), record(jti) }
 * @returns {{valid: boolean, claims?: object, reason?: string}}
 */
const verifySet = ({ token, verificationPair, expectedIssuer, expectedAudience, replayGuard = null }) => {
    if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'MISSING_TOKEN' };
    }

    let header;
    try {
        header = jwt.decode(token, { complete: true })?.header;
    } catch {
        return { valid: false, reason: 'MALFORMED' };
    }

    // Explicit typing, checked before anything else. This is what stops an
    // access token being replayed into the event pipeline and vice versa.
    if (!header || header.typ !== SET_TYP) {
        return { valid: false, reason: 'WRONG_TYP' };
    }

    if (!verificationPair?._nodePublicKey) {
        return { valid: false, reason: 'UNKNOWN_KEY' };
    }

    let claims;
    try {
        claims = jwt.verify(token, verificationPair._nodePublicKey, {
            algorithms: [verificationPair.generationConfig.algorithm],
            issuer: expectedIssuer,
            audience: expectedAudience
        });
    } catch (e) {
        if (e.name === 'JsonWebTokenError' && /audience/i.test(e.message)) {
            return { valid: false, reason: 'AUDIENCE_MISMATCH' };
        }
        if (e.name === 'JsonWebTokenError' && /issuer/i.test(e.message)) {
            return { valid: false, reason: 'ISSUER_MISMATCH' };
        }
        return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    if (typeof claims.iat !== 'number' || Math.abs(Math.floor(Date.now() / 1000) - claims.iat) > MAX_IAT_SKEW_SECONDS) {
        return { valid: false, reason: 'STALE_IAT' };
    }

    if (!claims.jti || typeof claims.jti !== 'string') {
        return { valid: false, reason: 'MISSING_JTI' };
    }

    if (!claims.events || typeof claims.events !== 'object' || Object.keys(claims.events).length === 0) {
        return { valid: false, reason: 'NO_EVENTS' };
    }

    // Replay is checked last so a malformed SET cannot burn a jti a legitimate
    // redelivery would reuse — the same ordering the DPoP proof guard uses.
    if (replayGuard && !replayGuard.isFresh(claims.jti)) {
        return { valid: false, reason: 'REPLAYED' };
    }

    if (replayGuard) replayGuard.record(claims.jti);

    return { valid: true, claims };
};

/**
 * Public JWK for a key pair, for the JWKS a receiver fetches to verify SETs.
 * Private material is never reachable from here — the export is taken from the
 * public half only.
 */
const toPublicJwk = pair => {
    try {
        const keyObject = crypto.createPublicKey(pair._nodePublicKey);
        const jwk = keyObject.export({ format: 'jwk' });

        return {
            ...jwk,
            kid: pair.keyPairId,
            use: 'sig',
            alg: pair.generationConfig?.algorithm
        };
    } catch (e) {
        logger.warn(`SET: could not export public JWK for ${pair?.keyPairId} — ${e.message}`);
        return null;
    }
};

export {
    buildSetClaims,
    signSet,
    verifySet,
    setKeyId,
    toPublicJwk,
    issSubSubject,
    opaqueSubject,
    emailSubject,
    isValidSubject,
    SubjectFormats,
    SET_TYP,
    MAX_IAT_SKEW_SECONDS
};
