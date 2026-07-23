/**
 * DPoP — proof-of-possession binding for session tokens (RFC 9449).
 *
 * WHY THIS EXISTS
 *
 * Security tiers 2–4 bound tokens to the client's IP range and device
 * fingerprint. Both of those arrive as ordinary request values, which means an
 * attacker holding a stolen token also holds everything needed to satisfy its
 * bindings — they were transmitted alongside it and are echoed back by choice.
 * A binding that the token's bearer can reproduce from the token alone is not a
 * binding.
 *
 * DPoP binds to a key instead. The client generates a keypair with
 * `extractable: false`, so the private key exists only as a handle inside the
 * browser — script can ASK it to sign, but cannot read it out. A token stolen
 * from storage, a log, or a backup is then inert: using it requires a signature
 * only that browser can produce. It does not stop an attacker who is executing
 * inside the live page, but it converts permanent, portable token theft into
 * use-while-resident, which is the difference that matters.
 *
 * WHAT IS VERIFIED
 *
 * The client sends a `DPoP` header: a JWT signed by the private key, with the
 * public JWK in its header. For it to be accepted:
 *   - the signature must verify against the embedded public key;
 *   - `htm` / `htu` must match this request's method and URI, so a proof cannot
 *     be lifted onto a different endpoint;
 *   - `iat` must be fresh, and `jti` unseen, so a captured proof cannot be
 *     replayed;
 *   - `ath` must equal the SHA-256 of the presented access token, so a proof
 *     minted for one token cannot be paired with another;
 *   - the key's RFC 7638 thumbprint must equal the `cnf.jkt` the token was
 *     issued against, which is what actually ties key and token together.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createReplayGuard } from './proofReplayGuard.js';
import { logger } from '../../../logger.js';

/** Proofs older/newer than this are refused. */
const PROOF_MAX_AGE_SECONDS = 60;

/** Only EC/RSA public keys; symmetric "keys" would let the presenter forge. */
const ALLOWED_KEY_TYPES = new Set(['EC', 'RSA']);
const ALLOWED_ALGORITHMS = new Set(['ES256', 'ES384', 'ES512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512']);

const proofReplayGuard = createReplayGuard({ retentionSec: PROOF_MAX_AGE_SECONDS * 2 });

/**
 * RFC 7638 JWK thumbprint — the canonical identity of a public key.
 * Only the required members participate, in lexicographic order.
 */
const jwkThumbprint = jwk => {
    let canonical;

    if (jwk.kty === 'EC') {
        canonical = { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
    } else if (jwk.kty === 'RSA') {
        canonical = { e: jwk.e, kty: jwk.kty, n: jwk.n };
    } else {
        throw new Error(`Unsupported key type for thumbprint: ${jwk.kty}`);
    }

    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('base64url');
};

/** SHA-256 of the access token, base64url — the `ath` claim. */
const accessTokenHash = token => crypto.createHash('sha256').update(token).digest('base64url');

/**
 * Verifies a DPoP proof for one request.
 *
 * @param {object} params
 * @param {string} params.proof        raw DPoP header value
 * @param {string} params.method       HTTP method
 * @param {string} params.url          full request URI, no query string
 * @param {string} params.accessToken  the token presented alongside this proof
 * @param {string} [params.expectedJkt] thumbprint the token is bound to
 * @returns {Promise<{valid: boolean, jkt?: string, reason?: string}>}
 */
const verifyDpopProof = async ({ proof, method, url, accessToken, expectedJkt = null }) => {
    if (!proof || typeof proof !== 'string') {
        return { valid: false, reason: 'MISSING_PROOF' };
    }

    let decoded;
    try {
        decoded = jwt.decode(proof, { complete: true });
    } catch {
        return { valid: false, reason: 'MALFORMED_PROOF' };
    }

    const header = decoded?.header;
    const jwk = header?.jwk;

    if (!header || header.typ !== 'dpop+jwt' || !jwk) {
        return { valid: false, reason: 'MALFORMED_PROOF' };
    }

    if (!ALLOWED_KEY_TYPES.has(jwk.kty) || !ALLOWED_ALGORITHMS.has(header.alg)) {
        return { valid: false, reason: 'UNSUPPORTED_ALGORITHM' };
    }

    // A private key member in the presented JWK means the client sent key
    // material it should never transmit — refuse rather than silently use it.
    if (jwk.d) {
        return { valid: false, reason: 'PRIVATE_KEY_IN_PROOF' };
    }

    let publicKey;
    try {
        publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    } catch {
        return { valid: false, reason: 'INVALID_KEY' };
    }

    let payload;
    try {
        payload = jwt.verify(proof, publicKey, { algorithms: [header.alg] });
    } catch {
        return { valid: false, reason: 'BAD_SIGNATURE' };
    }

    // Bind the proof to THIS request.
    if (payload.htm !== method.toUpperCase()) {
        return { valid: false, reason: 'METHOD_MISMATCH' };
    }

    if (payload.htu !== url) {
        return { valid: false, reason: 'URI_MISMATCH' };
    }

    // Freshness. Two-sided: a far-future iat is as suspicious as a stale one.
    const now = Math.floor(Date.now() / 1000);

    if (typeof payload.iat !== 'number' || Math.abs(now - payload.iat) > PROOF_MAX_AGE_SECONDS) {
        return { valid: false, reason: 'PROOF_EXPIRED' };
    }

    if (!payload.jti || typeof payload.jti !== 'string') {
        return { valid: false, reason: 'MISSING_JTI' };
    }

    if (!proofReplayGuard.isFresh(payload.jti)) {
        return { valid: false, reason: 'PROOF_REPLAYED' };
    }

    // Tie the proof to the specific token presented with it.
    if (accessToken) {
        if (payload.ath !== accessTokenHash(accessToken)) {
            return { valid: false, reason: 'TOKEN_HASH_MISMATCH' };
        }
    }

    let jkt;
    try {
        jkt = jwkThumbprint(jwk);
    } catch {
        return { valid: false, reason: 'INVALID_KEY' };
    }

    // The binding itself: this key must be the key the token was issued to.
    if (expectedJkt && jkt !== expectedJkt) {
        return { valid: false, reason: 'KEY_BINDING_MISMATCH' };
    }

    // Recorded only after everything else passed, so a bogus proof cannot burn a
    // jti the legitimate client might still use — the same ordering R_sync uses.
    proofReplayGuard.record(payload.jti);

    return { valid: true, jkt };
};

/**
 * Extracts the thumbprint from a proof WITHOUT verifying it.
 * Used at issuance, where there is no prior binding to check against — the
 * proof is still fully verified first by the caller.
 */
const thumbprintFromProof = proof => {
    try {
        const jwk = jwt.decode(proof, { complete: true })?.header?.jwk;
        return jwk ? jwkThumbprint(jwk) : null;
    } catch (e) {
        logger.warn(`DPoP: could not read thumbprint from proof — ${e.message}`);
        return null;
    }
};

export { verifyDpopProof, jwkThumbprint, accessTokenHash, thumbprintFromProof, PROOF_MAX_AGE_SECONDS };
