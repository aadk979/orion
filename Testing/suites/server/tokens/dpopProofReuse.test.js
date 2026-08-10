/**
 * Regression cover for the DPoP proof-reuse defect.
 *
 * A client sends ONE proof per HTTP request. The server may need to verify it
 * several times within that request: the step-up token in requestMetadata, the
 * access token in the auth middleware, and — on a refresh — the refresh token
 * plus the freshly minted access token. Verification consumes the proof's jti,
 * so before the per-request memo every check after the first failed as
 * PROOF_REPLAYED. Concretely that meant:
 *
 *   - a session with a STEP_UP_TOKEN cookie 401'd on every request for the
 *     five-hour life of that cookie;
 *   - every access-token refresh failed, and because the refresh token had
 *     already been retired, the retry was then misread as token theft and tore
 *     down the whole session family.
 *
 * These tests pin both halves of the contract: the same proof may be reused
 * WITHIN one request, and may not be reused ACROSS requests.
 */
import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    verifyDpopProof,
    jwkThumbprint,
    accessTokenHash
} from '../../../../Packages/server/Orion-core/lib/Utils/Core/TokenManagement/internals/dpop.js';

const METHOD = 'POST';
const URL_UNDER_TEST = 'https://api.example.com/orion/api/v1/action/get-user-profile';

/** Mints an EC P-256 keypair and the public JWK a proof carries in its header. */
const makeKey = () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });

    return { privateKey, jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } };
};

const b64url = input => Buffer.from(input).toString('base64url');

/**
 * Builds the compact JWS by hand rather than through a JWT library, for the
 * same reason the rest of this suite avoids third-party imports — and because
 * it is what the browser client actually does (see client DpopKey.js).
 * `ieee-p1363` is the raw r||s signature encoding JOSE requires; the DER form
 * Node emits by default would not verify.
 */
const makeProof = (key, { method = METHOD, url = URL_UNDER_TEST, jti, iat, ath } = {}) => {
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: key.jwk };

    const payload = {
        htm: method,
        htu: url,
        iat: iat ?? Math.floor(Date.now() / 1000),
        jti: jti ?? crypto.randomUUID(),
        ...(ath ? { ath } : {})
    };

    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

    const signature = crypto.sign('sha256', Buffer.from(signingInput), {
        key: key.privateKey,
        dsaEncoding: 'ieee-p1363'
    });

    return `${signingInput}.${signature.toString('base64url')}`;
};

/** Stands in for the per-request memo requestMetadata puts on the context. */
const newRequestMemo = () => new Map();

describe('dpop — one proof, many checks within a single request', () => {
    test('the same proof verifies repeatedly when a request memo is supplied', async () => {
        const key = makeKey();
        const proof = makeProof(key);
        const jkt = jwkThumbprint(key.jwk);
        const memo = newRequestMemo();

        // Mirrors the real sequence: step-up token, then access token, then the
        // refresh-path pair — four checks, one proof.
        for (const label of ['step-up token', 'access token', 'refresh token', 'rotated access token']) {
            const result = await verifyDpopProof({
                proof,
                method: METHOD,
                url: URL_UNDER_TEST,
                accessToken: null,
                expectedJkt: jkt,
                proofCache: memo
            });

            assert.equal(result.valid, true, `${label} check must not be refused as a replay`);
            assert.equal(result.jkt, jkt);
        }
    });

    test('a refresh may check the proof against two different tokens', async () => {
        // The rotated access token is a different string from the one presented,
        // which is why the token-specific checks must stay per-call rather than
        // being memoised along with the signature.
        const key = makeKey();
        const proof = makeProof(key);
        const jkt = jwkThumbprint(key.jwk);
        const memo = newRequestMemo();

        const first = await verifyDpopProof({
            proof,
            method: METHOD,
            url: URL_UNDER_TEST,
            accessToken: 'old.refresh.token',
            expectedJkt: jkt,
            proofCache: memo
        });

        const second = await verifyDpopProof({
            proof,
            method: METHOD,
            url: URL_UNDER_TEST,
            accessToken: 'new.access.token',
            expectedJkt: jkt,
            proofCache: memo
        });

        assert.equal(first.valid, true);
        assert.equal(second.valid, true, 'rotation must not fail because the proof was already used this request');
    });

    test('a failure is memoised too, so a bad proof stays bad within the request', async () => {
        const key = makeKey();
        const proof = makeProof(key, { method: 'GET' }); // htm will not match POST
        const memo = newRequestMemo();

        const first = await verifyDpopProof({ proof, method: METHOD, url: URL_UNDER_TEST, accessToken: null, proofCache: memo });
        const second = await verifyDpopProof({ proof, method: METHOD, url: URL_UNDER_TEST, accessToken: null, proofCache: memo });

        assert.equal(first.valid, false);
        assert.equal(first.reason, 'METHOD_MISMATCH');
        assert.deepEqual(second, first, 'a memoised failure must not silently become a pass');
    });
});

describe('dpop — replay protection still holds across requests', () => {
    test('reusing a proof in a NEW request is refused', async () => {
        const key = makeKey();
        const proof = makeProof(key);
        const jkt = jwkThumbprint(key.jwk);

        // Each request gets a fresh memo — that is what keeps cross-request
        // replay protection intact while the within-request reuse above works.
        const first = await verifyDpopProof({
            proof,
            method: METHOD,
            url: URL_UNDER_TEST,
            accessToken: null,
            expectedJkt: jkt,
            proofCache: newRequestMemo()
        });

        const replayed = await verifyDpopProof({
            proof,
            method: METHOD,
            url: URL_UNDER_TEST,
            accessToken: null,
            expectedJkt: jkt,
            proofCache: newRequestMemo()
        });

        assert.equal(first.valid, true);
        assert.equal(replayed.valid, false);
        assert.equal(replayed.reason, 'PROOF_REPLAYED');
    });

    test('with no memo at all, a second check is refused as a replay', async () => {
        // The pre-fix behaviour, pinned so the memo cannot be quietly dropped
        // from the call sites without a test noticing.
        const key = makeKey();
        const proof = makeProof(key);

        const first = await verifyDpopProof({ proof, method: METHOD, url: URL_UNDER_TEST, accessToken: null });
        const second = await verifyDpopProof({ proof, method: METHOD, url: URL_UNDER_TEST, accessToken: null });

        assert.equal(first.valid, true);
        assert.equal(second.valid, false);
        assert.equal(second.reason, 'PROOF_REPLAYED');
    });
});

describe('dpop — per-caller checks are not weakened by the memo', () => {
    test('a key-binding mismatch is caught on a memoised proof', async () => {
        const key = makeKey();
        const otherKey = makeKey();
        const proof = makeProof(key);
        const memo = newRequestMemo();

        const bound = await verifyDpopProof({
            proof,
            method: METHOD,
            url: URL_UNDER_TEST,
            accessToken: null,
            expectedJkt: jwkThumbprint(key.jwk),
            proofCache: memo
        });

        const mismatched = await verifyDpopProof({
            proof,
            method: METHOD,
            url: URL_UNDER_TEST,
            accessToken: null,
            expectedJkt: jwkThumbprint(otherKey.jwk),
            proofCache: memo
        });

        assert.equal(bound.valid, true);
        assert.equal(mismatched.valid, false);
        assert.equal(mismatched.reason, 'KEY_BINDING_MISMATCH');
    });

    test('an ath claim is still matched against the token actually presented', async () => {
        const key = makeKey();
        const token = 'the.presented.token';
        const proof = makeProof(key, { ath: accessTokenHash(token) });
        const memo = newRequestMemo();

        const right = await verifyDpopProof({ proof, method: METHOD, url: URL_UNDER_TEST, accessToken: token, proofCache: memo });
        const wrong = await verifyDpopProof({ proof, method: METHOD, url: URL_UNDER_TEST, accessToken: 'a.different.token', proofCache: memo });

        assert.equal(right.valid, true);
        assert.equal(wrong.valid, false);
        assert.equal(wrong.reason, 'TOKEN_HASH_MISMATCH');
    });

    test('a stale proof is refused before it can be memoised', async () => {
        const key = makeKey();
        const proof = makeProof(key, { iat: Math.floor(Date.now() / 1000) - 3600 });

        const result = await verifyDpopProof({ proof, method: METHOD, url: URL_UNDER_TEST, accessToken: null, proofCache: newRequestMemo() });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'PROOF_EXPIRED');
    });
});
