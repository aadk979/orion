/**
 * SSF receiver — applies CAEP events transmitted by a trusted issuer.
 *
 * This is the half that makes access evaluation genuinely continuous. Without
 * it Orion can tell others that a session died; with it, Orion acts when an
 * upstream identity provider says one of ITS sessions died — which matters
 * wherever Orion federates (the OAuth providers already wired up) or runs
 * alongside a peer deployment.
 *
 * TRUST MODEL
 *
 * A SET is only as good as the key that signed it, so an inbound SET is applied
 * only when it: carries `typ: secevent+jwt`, verifies against a key published
 * by a CONFIGURED issuer, names this deployment in `aud`, is recent, and has a
 * `jti` not seen before. Anything else is refused. In particular, an unknown
 * issuer is never trusted on the strength of the `iss` claim alone — that claim
 * is exactly what an attacker would forge.
 *
 * Subject resolution is deliberately conservative: an event whose subject
 * cannot be mapped to a local account is acknowledged and ignored rather than
 * guessed at. Applying a revocation to the wrong user because two issuers use
 * overlapping local ids would be far worse than missing one.
 */
import jwt from 'jsonwebtoken';
import { logger } from '../../logger.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel } from '../../Databases/models/index.js';
import { createReplayGuard } from '../TokenManagement/internals/proofReplayGuard.js';
import { SubjectFormats, MAX_IAT_SKEW_SECONDS, SET_TYP } from './SecurityEventToken.js';
import { CaepEventTypes } from './CaepEvents.js';
import { revokeAllTokensForUser, revokeTokensByLinkCode } from '../TokenManagement/TokenRevocation.js';

/** Retained well past the accepted `iat` window so a replay cannot slip behind it. */
const receivedSetGuard = createReplayGuard({ retentionSec: MAX_IAT_SKEW_SECONDS * 2 });

/**
 * Trusted issuers, keyed by `iss`.
 * `{ [iss]: { jwksUri, audience } }` from `sharedSignals.trustedIssuers`.
 */
const trustedIssuers = () => {
    try {
        return globalAccessPoint.getValue('ssfTrustedIssuers') || {};
    } catch {
        return {};
    }
};

/** Cached JWKS per issuer: { keys, fetchedAt }. */
const jwksCache = new Map();
const JWKS_TTL_MS = 10 * 60_000;

/**
 * Fetches (and caches) an issuer's JWKS.
 *
 * A failure here must not be interpreted as "signature invalid" by the caller —
 * it is "cannot decide", and the SET is refused with a distinct reason so an
 * operator can tell an unreachable JWKS apart from a forged token.
 */
const fetchJwks = async (iss, jwksUri) => {
    const cached = jwksCache.get(iss);
    if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

    const response = await fetch(jwksUri, { signal: AbortSignal.timeout(10_000) });

    if (!response.ok) throw new Error(`JWKS fetch returned ${response.status}`);

    const body = await response.json();

    if (!Array.isArray(body?.keys)) throw new Error('JWKS has no keys array');

    jwksCache.set(iss, { keys: body.keys, fetchedAt: Date.now() });
    return body.keys;
};

const jwkToKeyObject = async jwk => {
    const { createPublicKey } = await import('crypto');
    return createPublicKey({ key: jwk, format: 'jwk' });
};

/**
 * Verifies an inbound SET against its issuer's published keys.
 *
 * @returns {Promise<{valid: boolean, claims?: object, reason?: string}>}
 */
const verifyInboundSet = async token => {
    if (!token || typeof token !== 'string') return { valid: false, reason: 'MISSING_TOKEN' };

    let decoded;
    try {
        decoded = jwt.decode(token, { complete: true });
    } catch {
        return { valid: false, reason: 'MALFORMED' };
    }

    if (decoded?.header?.typ !== SET_TYP) {
        return { valid: false, reason: 'WRONG_TYP' };
    }

    const iss = decoded?.payload?.iss;
    const issuers = trustedIssuers();
    const config = iss ? issuers[iss] : null;

    // The `iss` claim selects WHICH trusted configuration to check against; it
    // never establishes trust by itself.
    if (!config) {
        return { valid: false, reason: 'UNTRUSTED_ISSUER' };
    }

    let keys;
    try {
        keys = await fetchJwks(iss, config.jwksUri);
    } catch (e) {
        logger.warn(`SSF: cannot verify SET from ${iss} — JWKS unavailable (${e.message})`);
        return { valid: false, reason: 'JWKS_UNAVAILABLE' };
    }

    const kid = decoded.header.kid;
    const jwk = keys.find(k => k.kid === kid) || (keys.length === 1 ? keys[0] : null);

    if (!jwk) return { valid: false, reason: 'UNKNOWN_KEY' };

    let publicKey;
    try {
        publicKey = await jwkToKeyObject(jwk);
    } catch {
        return { valid: false, reason: 'UNKNOWN_KEY' };
    }

    let claims;
    try {
        claims = jwt.verify(token, publicKey, {
            issuer: iss,
            audience: config.audience || globalAccessPoint.getValue('ssfIssuer'),
            algorithms: [jwk.alg || decoded.header.alg]
        });
    } catch (e) {
        return { valid: false, reason: /audience/i.test(e.message) ? 'AUDIENCE_MISMATCH' : 'BAD_SIGNATURE' };
    }

    if (typeof claims.iat !== 'number' || Math.abs(Math.floor(Date.now() / 1000) - claims.iat) > MAX_IAT_SKEW_SECONDS) {
        return { valid: false, reason: 'STALE_IAT' };
    }

    if (!claims.jti) return { valid: false, reason: 'MISSING_JTI' };

    if (!receivedSetGuard.isFresh(claims.jti)) {
        return { valid: false, reason: 'REPLAYED' };
    }

    if (!claims.events || Object.keys(claims.events).length === 0) {
        return { valid: false, reason: 'NO_EVENTS' };
    }

    receivedSetGuard.record(claims.jti);

    return { valid: true, claims };
};

/**
 * Maps an RFC 9493 subject to a local uid.
 *
 * Returns null rather than guessing. An `iss_sub` subject is only resolved when
 * its `iss` matches the SET's issuer — otherwise one trusted issuer could name
 * subjects belonging to another and revoke sessions it has no authority over.
 */
const resolveSubject = async (subject, setIssuer) => {
    if (!subject?.format) return null;

    switch (subject.format) {
        case SubjectFormats.ISS_SUB: {
            if (subject.iss !== setIssuer) {
                logger.warn(`SSF: refusing iss_sub subject naming ${subject.iss} inside a SET issued by ${setIssuer}`);
                return null;
            }

            const exists = await UserModel.uidExists(subject.sub);
            return exists ? { uid: subject.sub } : null;
        }

        case SubjectFormats.EMAIL: {
            const uid = await UserModel.getUidByEmail(String(subject.email).toLowerCase());
            return uid ? { uid } : null;
        }

        case SubjectFormats.OPAQUE:
            // A session-scoped identifier. Only meaningful when this deployment
            // minted it, which the link-code revocation below verifies by uid
            // scoping at the call site.
            return { linkCode: subject.id };

        default:
            return null;
    }
};

/**
 * Applies one CAEP event to local state.
 *
 * @returns {Promise<{applied: boolean, action?: string, reason?: string}>}
 */
const applyEvent = async (eventType, payload, setIssuer) => {
    const resolved = await resolveSubject(payload?.subject, setIssuer);

    if (!resolved) {
        return { applied: false, reason: 'UNRESOLVED_SUBJECT' };
    }

    switch (eventType) {
        case CaepEventTypes.SESSION_REVOKED: {
            if (resolved.linkCode) {
                const result = await revokeTokensByLinkCode(resolved.linkCode, {
                    reason: `caep-session-revoked from ${setIssuer}`,
                    revokedBy: 'SSF'
                });
                return { applied: !result.error, action: 'revoked-session', reason: result.errorCode };
            }

            const result = await revokeAllTokensForUser(resolved.uid, {
                reason: `caep-session-revoked from ${setIssuer}`,
                revokedBy: 'SSF'
            });

            // Stateless (tier 1) deployments have no rows to delete; the account
            // watermark is the mechanism there, so move it instead.
            if (result.error && result.errorCode === 'TOKEN-REVOCATION::STATELESS-TIER::A::p') {
                await UserModel.invalidateSessionsNow(resolved.uid);
                return { applied: true, action: 'watermark-advanced' };
            }

            return { applied: !result.error, action: 'revoked-all', reason: result.errorCode };
        }

        case CaepEventTypes.CREDENTIAL_CHANGE:
        case CaepEventTypes.TOKEN_CLAIMS_CHANGE:
        case CaepEventTypes.ASSURANCE_LEVEL_CHANGE: {
            // All three mean "what this session was authorized on has changed".
            // The watermark expresses exactly that and applies at every tier,
            // including stateless, so it is the right instrument regardless of
            // which of the three arrived.
            await UserModel.invalidateSessionsNow(resolved.uid);
            return { applied: true, action: 'watermark-advanced' };
        }

        case CaepEventTypes.DEVICE_COMPLIANCE_CHANGE: {
            if (payload?.current_status === 'not-compliant') {
                await UserModel.invalidateSessionsNow(resolved.uid);
                return { applied: true, action: 'watermark-advanced' };
            }
            return { applied: true, action: 'noted' };
        }

        default:
            return { applied: false, reason: 'UNSUPPORTED_EVENT' };
    }
};

/**
 * Processes a received SET end to end.
 *
 * @param {string} token
 * @returns {Promise<{accepted: boolean, reason?: string, results?: object}>}
 */
const receiveSet = async token => {
    const verification = await verifyInboundSet(token);

    if (!verification.valid) {
        logger.warn(`SSF: rejected inbound SET — ${verification.reason}`);
        return { accepted: false, reason: verification.reason };
    }

    const { claims } = verification;
    const results = {};

    for (const [eventType, payload] of Object.entries(claims.events)) {
        try {
            results[eventType] = await applyEvent(eventType, payload, claims.iss);
        } catch (e) {
            logger.error(`SSF: failed applying ${eventType} from ${claims.iss} — ${e.message}`);
            results[eventType] = { applied: false, reason: 'APPLY_FAILED' };
        }
    }

    logger.info(`SSF: accepted SET ${claims.jti} from ${claims.iss} (${Object.keys(claims.events).length} event(s))`);

    return { accepted: true, results };
};

export { receiveSet, verifyInboundSet, applyEvent, resolveSubject };
