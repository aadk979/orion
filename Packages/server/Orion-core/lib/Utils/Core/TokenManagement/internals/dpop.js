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
// The leaf store, NOT the re-export from requestMetadata.js — that module
// imports the step-up validator, which imports this one. See the same note in
// dpopBinding.js.
import { requestContext } from '../../../../Server/Middleware/requestContextStore.js';
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
 * Canonical form of an `htu` value, per RFC 9449 §4.2 ("the HTTP target URI,
 * without query and fragment parts").
 *
 * The client and the server derive this string from different raw material —
 * the client concatenates its configured base URL, the server reassembles
 * `protocol + Host + originalUrl` — so a byte comparison of the two rejects
 * requests that are in fact identical. The differences that actually occur are
 * all normalisable: scheme/host case, an explicit `:443`/`:80`, a doubled
 * slash where a base URL ends with `/` and an endpoint begins with one, and a
 * trailing slash.
 *
 * Anything that survives this normalisation is a genuine mismatch.
 *
 * @param {string} value
 * @returns {string} `scheme://host[:port]/path`
 */
const canonicalizeHtu = value => {
    const parsed = new URL(value);

    const scheme = parsed.protocol.toLowerCase();
    const port = parsed.port;
    const isDefaultPort = (scheme === 'https:' && port === '443') || (scheme === 'http:' && port === '80');
    const host = parsed.hostname.toLowerCase() + (port && !isDefaultPort ? `:${port}` : '');

    // Collapse `//` runs, then drop a trailing slash — `/a//b/` and `/a/b` are
    // the same resource, and only one of the two sides tends to emit it.
    const path = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';

    return `${scheme}//${host}${path}`;
};

/**
 * Resolves the per-request memo of already-verified proofs.
 *
 * WHY THIS EXISTS
 *
 * A client sends exactly ONE proof per HTTP request, but a single request can
 * legitimately need it checked more than once: the step-up token is validated
 * in requestMetadata, the access token in the auth middleware, and a refresh
 * additionally validates the refresh token and the freshly minted access token.
 * Each of those is a separate `verifyDpopProof` call against the same proof.
 *
 * Because verification CONSUMES the proof's `jti`, the second call used to fail
 * as PROOF_REPLAYED — which made every refresh fail, and locked a session out
 * entirely for the five-hour life of a step-up cookie. Memoising the
 * nonce-consuming half per request fixes that without weakening replay
 * protection: the jti is still claimed exactly once, and a proof reused across
 * two DIFFERENT requests still fails, because each request gets a fresh memo.
 *
 * `explicit` is for callers that run BEFORE `requestContext.run` (the
 * requestMetadata middleware validating a step-up cookie), where the async
 * store is not readable yet and the map has to be handed over directly.
 */
const proofMemoFor = explicit => {
    if (explicit instanceof Map) return explicit;

    const store = requestContext.getStore();
    return store?.dpopProofCache instanceof Map ? store.dpopProofCache : null;
};

/**
 * The half of verification that does not depend on WHICH token the proof is
 * presented with: signature, key acceptability, `htm`/`htu`, freshness and the
 * one-time `jti` claim.
 *
 * This is the half that consumes the nonce, so it runs at most once per request
 * (see proofMemoFor). Its result — including a failure — is what gets memoised.
 *
 * @returns {Promise<{valid: false, reason: string} | {valid: true, jkt: string, payload: object}>}
 */
const verifyProofIntrinsic = async (proof, method, url) => {
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

    // Compared in canonical form — see canonicalizeHtu. A proof whose `htu` is
    // not a parseable absolute URI is refused rather than string-compared.
    try {
        if (canonicalizeHtu(payload.htu) !== canonicalizeHtu(url)) {
            return { valid: false, reason: 'URI_MISMATCH' };
        }
    } catch {
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

    if (!(await proofReplayGuard.isFresh(payload.jti))) {
        return { valid: false, reason: 'PROOF_REPLAYED' };
    }

    let jkt;
    try {
        jkt = jwkThumbprint(jwk);
    } catch {
        return { valid: false, reason: 'INVALID_KEY' };
    }

    // Claimed only after every intrinsic check passed, so a malformed or
    // badly-signed proof cannot burn a jti the legitimate client might still
    // use. The claim is atomic: a `false` means another request already took
    // this jti, so two concurrent replays cannot both succeed.
    if (!(await proofReplayGuard.record(payload.jti))) {
        return { valid: false, reason: 'PROOF_REPLAYED' };
    }

    return { valid: true, jkt, payload };
};

/**
 * Verifies a DPoP proof for one request, against one token.
 *
 * @param {object} params
 * @param {string} params.proof        raw DPoP header value
 * @param {string} params.method       HTTP method
 * @param {string} params.url          full request URI, no query string
 * @param {string} params.accessToken  the token presented alongside this proof
 * @param {string} [params.expectedJkt] thumbprint the token is bound to
 * @param {boolean} [params.requireAth] demand an `ath` claim. True when the
 *   access token travels in the `Authorization` header, where RFC 9449 §4.3
 *   makes it mandatory. False when the token is carried in an HttpOnly cookie:
 *   script cannot read the token there, so it cannot compute the hash, and
 *   demanding one would make the binding unimplementable. The claim's job —
 *   stopping a proof minted for token A being paired with token B — is already
 *   covered in that transport, because the browser decides which cookie is
 *   attached and the `cnf.jkt` check ties the proof to this session's key.
 *   An `ath` that IS present is always verified regardless of this flag.
 * @param {Map} [params.proofCache]   per-request memo, for callers running
 *   before the async request context is readable.
 * @returns {Promise<{valid: boolean, jkt?: string, reason?: string}>}
 */
const verifyDpopProof = async ({ proof, method, url, accessToken, expectedJkt = null, requireAth = false, proofCache = null }) => {
    if (!proof || typeof proof !== 'string') {
        return { valid: false, reason: 'MISSING_PROOF' };
    }

    const memo = proofMemoFor(proofCache);

    // Keyed on method and URL as well as the proof: htm/htu are verified
    // against them, so a memo entry is only reusable for the same target.
    const memoKey = `${String(method).toUpperCase()} ${url} ${proof}`;

    let intrinsic = memo?.get(memoKey);

    if (!intrinsic) {
        intrinsic = await verifyProofIntrinsic(proof, method, url);
        memo?.set(memoKey, intrinsic);
    }

    if (!intrinsic.valid) {
        return { valid: false, reason: intrinsic.reason };
    }

    // Per-caller checks. These depend on WHICH token the proof accompanies, so
    // they re-run on every call even when the intrinsic result was memoised —
    // one request may legitimately check the same proof against the step-up
    // token and the access token, and each must be bound independently.
    const { payload, jkt } = intrinsic;

    // Tie the proof to the specific token presented with it. Mandatory for
    // header-borne tokens; verified-when-offered for cookie-borne ones (see
    // `requireAth` above).
    if (requireAth && payload.ath === undefined) {
        return { valid: false, reason: 'MISSING_ATH' };
    }

    if (accessToken && payload.ath !== undefined) {
        const expected = Buffer.from(accessTokenHash(accessToken), 'utf8');
        const presented = Buffer.from(String(payload.ath), 'utf8');

        if (expected.length !== presented.length || !crypto.timingSafeEqual(expected, presented)) {
            return { valid: false, reason: 'TOKEN_HASH_MISMATCH' };
        }
    }

    // The binding itself: this key must be the key the token was issued to.
    if (expectedJkt && jkt !== expectedJkt) {
        return { valid: false, reason: 'KEY_BINDING_MISMATCH' };
    }

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

export { verifyDpopProof, jwkThumbprint, accessTokenHash, thumbprintFromProof, canonicalizeHtu, PROOF_MAX_AGE_SECONDS };
