/**
 * Regression tests for the proof-of-possession rollout.
 *
 * The point of this pass was that RFC 9449 was fully implemented and entirely
 * unreachable: no issuance path ever set `cnf.jkt`, the `tokenBinding` setting
 * was written and never read, and two client/server disagreements (`ath` and
 * `htu`) would have rejected every request had it been switched on. These
 * cover the parts that are exercisable without a database or a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { verifyDpopProof, jwkThumbprint, accessTokenHash, canonicalizeHtu } from '../lib/Utils/Core/TokenManagement/internals/dpop.js';
import { assessTierRisk, IP_MISMATCH_RISK, FINGERPRINT_MISMATCH_RISK } from '../lib/Utils/Core/TokenManagement/internals/tierBinding.js';
import { AbuseDetectionSystem, THRESHOLDS, MAX_TRACKED_ACTORS } from '../lib/Utils/Systems/AbuseDetectionSystem.js';

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

// ── htu canonicalization ────────────────────────────────────────────────────
test('BIND-001: htu comparison survives benign URI spelling differences', async t => {
    await t.test('default ports, case and trailing slashes normalize together', () => {
        const canonical = canonicalizeHtu('https://api.example.com/v1/session');

        assert.equal(canonicalizeHtu('https://API.Example.COM/v1/session'), canonical);
        assert.equal(canonicalizeHtu('https://api.example.com:443/v1/session'), canonical);
        assert.equal(canonicalizeHtu('https://api.example.com/v1/session/'), canonical);
        assert.equal(canonicalizeHtu('https://api.example.com//v1//session'), canonical);
        assert.equal(canonicalizeHtu('https://api.example.com/v1/session?a=1#frag'), canonical);
    });

    await t.test('genuinely different targets still differ', () => {
        const base = canonicalizeHtu('https://api.example.com/v1/session');

        assert.notEqual(canonicalizeHtu('http://api.example.com/v1/session'), base, 'scheme must matter');
        assert.notEqual(canonicalizeHtu('https://api.example.com:8443/v1/session'), base, 'non-default port must matter');
        assert.notEqual(canonicalizeHtu('https://other.example.com/v1/session'), base, 'host must matter');
        assert.notEqual(canonicalizeHtu('https://api.example.com/v1/other'), base, 'path must matter');
    });

    await t.test('a client-built URI verifies against the server-rebuilt one', async () => {
        const key = makeKey();

        // Client concatenates base + slug + endpoint, producing a doubled slash.
        // Server reassembles protocol + Host + originalUrl, with a query string.
        const result = await verifyDpopProof({
            proof: makeProof(key, { url: 'https://api.example.com//v1/session' }),
            method: 'POST',
            url: 'https://api.example.com:443/v1/session?redirect=/home',
            accessToken: null,
            expectedJkt: jwkThumbprint(key.jwk)
        });

        assert.equal(result.valid, true, 'these describe the same target and must verify');
    });
});

// ── ath policy ──────────────────────────────────────────────────────────────
test('BIND-002: ath is required only where the client can compute it', async t => {
    const key = makeKey();
    const token = 'cookie-borne-access-token';
    const url = 'https://api.example.com/x';

    await t.test('cookie transport: a proof without ath is accepted', async () => {
        const result = await verifyDpopProof({
            proof: makeProof(key),
            method: 'POST',
            url,
            accessToken: token,
            expectedJkt: jwkThumbprint(key.jwk),
            requireAth: false
        });

        assert.equal(result.valid, true, 'HttpOnly cookies are unreadable to script, so ath is not computable');
    });

    await t.test('header transport: a proof without ath is refused', async () => {
        const result = await verifyDpopProof({
            proof: makeProof(key),
            method: 'POST',
            url,
            accessToken: token,
            expectedJkt: jwkThumbprint(key.jwk),
            requireAth: true
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'MISSING_ATH');
    });

    await t.test('an ath that IS offered is verified even when not required', async () => {
        const result = await verifyDpopProof({
            proof: makeProof(key, { ath: accessTokenHash('a-completely-different-token') }),
            method: 'POST',
            url,
            accessToken: token,
            expectedJkt: jwkThumbprint(key.jwk),
            requireAth: false
        });

        assert.equal(result.valid, false, 'never accept a claim we can prove wrong');
        assert.equal(result.reason, 'TOKEN_HASH_MISMATCH');
    });
});

// ── tier risk ───────────────────────────────────────────────────────────────
test('BIND-003: IP is fatal only when it is the sole binding', async t => {
    const row = { ip_range: '203.0.113.0/24', hashed_fingerprint: 'stored' };

    const deps = (bindingOn, { ipMatches = true, fpMatches = true } = {}) => ({
        isBindingRequired: () => bindingOn,
        isIpInRange: async () => ipMatches,
        verifyHash: async () => fpMatches
    });

    await t.test('tier 2 without proof of possession: IP mismatch is fatal', async () => {
        const result = await assessTierRisk(2, { ip: '198.51.100.7' }, row, deps(false, { ipMatches: false }));

        assert.equal(result.ok, false);
        assert.equal(result.hardFail, true);
    });

    await t.test('tier 2 WITH proof of possession: IP mismatch is a signal, not a rejection', async () => {
        const result = await assessTierRisk(2, { ip: '198.51.100.7' }, row, deps(true, { ipMatches: false }));

        assert.equal(result.ok, true, 'the key binding is doing the work an address cannot');
        assert.equal(result.riskScore, IP_MISMATCH_RISK);
    });

    await t.test('tier 2 matching IP passes either way', async () => {
        assert.equal((await assessTierRisk(2, { ip: '203.0.113.9' }, row, deps(false))).ok, true);
        assert.equal((await assessTierRisk(2, { ip: '203.0.113.9' }, row, deps(true))).ok, true);
    });

    await t.test('tier 4 still escalates to step-up when both signals miss', async () => {
        const result = await assessTierRisk(4, { ip: '198.51.100.7', fingerprint: 'x' }, row, deps(true, { ipMatches: false, fpMatches: false }));

        assert.equal(result.stepUpRequired, true);
        assert.equal(result.riskScore, IP_MISMATCH_RISK + FINGERPRINT_MISMATCH_RISK);
    });

    await t.test('tier 4 with one signal missing stays below the threshold', async () => {
        const result = await assessTierRisk(4, { ip: '198.51.100.7', fingerprint: 'x' }, row, deps(true, { ipMatches: false, fpMatches: true }));

        assert.equal(result.ok, true, 'a single signal is advisory by design');
        assert.equal(result.riskScore, IP_MISMATCH_RISK);
    });
});

// ── abuse detection memory bounds ───────────────────────────────────────────
test('BIND-004: abuse detection state is bounded and still blocks', async t => {
    await t.test('thresholds still trip a block', async () => {
        const sys = new AbuseDetectionSystem();
        sys._isCluster = false;

        for (let i = 0; i < THRESHOLDS.authFailureHardBlock; i++) {
            await sys.recordAuthFailure('203.0.113.5', 'fp-a');
        }

        const blocked = await sys.isBlocked('203.0.113.5');
        assert.equal(blocked.blocked, true);
        assert.equal(blocked.reason, 'ip');

        assert.equal((await sys.isBlocked('198.51.100.1')).blocked, false, 'blocks must not leak to other actors');
    });

    await t.test('fingerprint churn from one address trips a block', async () => {
        const sys = new AbuseDetectionSystem();
        sys._isCluster = false;

        for (let i = 0; i < THRESHOLDS.fpChurnThreshold; i++) {
            await sys.recordAuthFailure('203.0.113.6', `fp-${i}`);
        }

        assert.equal((await sys.isBlocked('203.0.113.6')).blocked, true);
    });

    await t.test('unblock clears the actor', async () => {
        const sys = new AbuseDetectionSystem();
        sys._isCluster = false;

        for (let i = 0; i < THRESHOLDS.authFailureHardBlock; i++) {
            await sys.recordAuthFailure('203.0.113.7', 'fp-a');
        }

        assert.equal(await sys.unblock('203.0.113.7'), true);
        assert.equal((await sys.isBlocked('203.0.113.7')).blocked, false);
    });

    await t.test('distinct sources cannot grow the maps without bound', async () => {
        const sys = new AbuseDetectionSystem();
        sys._isCluster = false;

        // A routed IPv6 /64 gives an attacker 2^64 source addresses. This used
        // to allocate permanently for every one of them.
        const overflow = MAX_TRACKED_ACTORS + 2_000;

        for (let i = 0; i < overflow; i++) {
            await sys.recordAuthFailure(`2001:db8::${i.toString(16)}`, `fp${i}`);
        }

        const stats = sys.getStats();

        assert.ok(stats.trackedIps <= MAX_TRACKED_ACTORS, `failure map grew to ${stats.trackedIps}`);
        assert.ok(stats.trackedChurnIps <= MAX_TRACKED_ACTORS, `churn map grew to ${stats.trackedChurnIps}`);
    });
});
