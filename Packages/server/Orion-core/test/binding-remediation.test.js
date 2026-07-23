/**
 * Regression tests for the second remediation pass (TIER-001, PERF-001,
 * TOKEN-003, PASSKEY-001 supporting logic).
 *
 * Everything here is exercisable without a database. The DB-backed halves —
 * ceremony consume, login backoff SQL — are single-statement by construction and
 * need an integration environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { verifyDpopProof, jwkThumbprint, accessTokenHash } from '../lib/Utils/Core/TokenManagement/internals/dpop.js';
import { createReplayGuard } from '../lib/Utils/Core/TokenManagement/internals/proofReplayGuard.js';

// ── helpers ─────────────────────────────────────────────────────────────────
const makeKey = () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    return { publicKey, privateKey, jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y } };
};

const makeProof = (key, { method = 'POST', url = 'https://api.example.com/x', ath, jti, iat } = {}) =>
    jwt.sign(
        {
            htm: method,
            htu: url,
            iat: iat ?? Math.floor(Date.now() / 1000),
            jti: jti ?? crypto.randomBytes(12).toString('base64url'),
            ...(ath ? { ath } : {})
        },
        key.privateKey,
        { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk: key.jwk } }
    );

// ── TIER-001 ────────────────────────────────────────────────────────────────
test('TIER-001: DPoP proofs bind a token to a key the holder must possess', async t => {
    const key = makeKey();
    const token = 'access-token-value';
    const ath = accessTokenHash(token);
    const url = 'https://api.example.com/x';

    await t.test('a well-formed proof from the bound key is accepted', async () => {
        const result = await verifyDpopProof({
            proof: makeProof(key, { ath }),
            method: 'POST',
            url,
            accessToken: token,
            expectedJkt: jwkThumbprint(key.jwk)
        });

        assert.equal(result.valid, true, result.reason);
        assert.equal(result.jkt, jwkThumbprint(key.jwk));
    });

    await t.test('a proof from a DIFFERENT key is rejected — this is the whole point', async () => {
        const attacker = makeKey();

        const result = await verifyDpopProof({
            proof: makeProof(attacker, { ath }),
            method: 'POST',
            url,
            accessToken: token,
            expectedJkt: jwkThumbprint(key.jwk)
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'KEY_BINDING_MISMATCH');
    });

    await t.test('a proof cannot be lifted onto another endpoint or method', async () => {
        const proof = makeProof(key, { ath });

        const wrongUrl = await verifyDpopProof({ proof, method: 'POST', url: 'https://api.example.com/other', accessToken: token });
        assert.equal(wrongUrl.reason, 'URI_MISMATCH');

        const wrongMethod = await verifyDpopProof({ proof: makeProof(key, { ath }), method: 'DELETE', url, accessToken: token });
        assert.equal(wrongMethod.reason, 'METHOD_MISMATCH');
    });

    await t.test('a proof minted for one token cannot be paired with another', async () => {
        const result = await verifyDpopProof({
            proof: makeProof(key, { ath: accessTokenHash('some-other-token') }),
            method: 'POST',
            url,
            accessToken: token
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'TOKEN_HASH_MISMATCH');
    });

    await t.test('a captured proof cannot be replayed', async () => {
        const proof = makeProof(key, { ath });

        const first = await verifyDpopProof({ proof, method: 'POST', url, accessToken: token });
        assert.equal(first.valid, true, first.reason);

        const second = await verifyDpopProof({ proof, method: 'POST', url, accessToken: token });
        assert.equal(second.valid, false);
        assert.equal(second.reason, 'PROOF_REPLAYED');
    });

    await t.test('stale and far-future proofs are refused', async () => {
        const old = await verifyDpopProof({
            proof: makeProof(key, { ath, iat: Math.floor(Date.now() / 1000) - 600 }),
            method: 'POST',
            url,
            accessToken: token
        });
        assert.equal(old.reason, 'PROOF_EXPIRED');

        const future = await verifyDpopProof({
            proof: makeProof(key, { ath, iat: Math.floor(Date.now() / 1000) + 600 }),
            method: 'POST',
            url,
            accessToken: token
        });
        assert.equal(future.reason, 'PROOF_EXPIRED');
    });

    await t.test('a missing proof is refused, not defaulted through', async () => {
        const result = await verifyDpopProof({ proof: null, method: 'POST', url, accessToken: token });
        assert.equal(result.valid, false);
        assert.equal(result.reason, 'MISSING_PROOF');
    });

    await t.test('a proof carrying private key material is refused outright', async () => {
        const key2 = makeKey();
        const privJwk = key2.privateKey.export({ format: 'jwk' });

        const proof = jwt.sign({ htm: 'POST', htu: url, iat: Math.floor(Date.now() / 1000), jti: 'x1' }, key2.privateKey, {
            algorithm: 'ES256',
            header: { typ: 'dpop+jwt', jwk: privJwk }
        });

        const result = await verifyDpopProof({ proof, method: 'POST', url, accessToken: token });
        assert.equal(result.valid, false);
        assert.equal(result.reason, 'PRIVATE_KEY_IN_PROOF');
    });
});

// ── RFC 7638 ────────────────────────────────────────────────────────────────
test('TIER-001: thumbprints are canonical and key-specific', async t => {
    await t.test('member order does not change the thumbprint', () => {
        const key = makeKey();
        const reordered = { y: key.jwk.y, x: key.jwk.x, kty: key.jwk.kty, crv: key.jwk.crv };

        assert.equal(jwkThumbprint(key.jwk), jwkThumbprint(reordered));
    });

    await t.test('different keys produce different thumbprints', () => {
        assert.notEqual(jwkThumbprint(makeKey().jwk), jwkThumbprint(makeKey().jwk));
    });
});

// ── TOKEN-003 / proof replay guard ──────────────────────────────────────────
test('TOKEN-003: replay guard treats first use as fresh and repeats as seen', async t => {
    const guard = createReplayGuard({ retentionSec: 60 });

    await t.test('first use is fresh, second is not', () => {
        assert.equal(guard.isFresh('a'), true);
        guard.record('a');
        assert.equal(guard.isFresh('a'), false);
    });

    await t.test('an expired entry becomes fresh again', () => {
        guard.record('b', -1);
        assert.equal(guard.isFresh('b'), true);
    });

    await t.test('distinct keys do not collide', () => {
        guard.record('c');
        assert.equal(guard.isFresh('d'), true);
    });
});
