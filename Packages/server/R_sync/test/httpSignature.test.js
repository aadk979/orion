/**
 * RFC 9421 HTTP Message Signatures + RFC 9530 Content-Digest.
 *
 * These replaced a proprietary canonical string. The tests below cover both the
 * standard's requirements and the specific weaknesses of what came before —
 * particularly the delimiter ambiguity, which is the kind of bug that produces
 * two different requests with identical signature bases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    contentDigest,
    contentDigestMatches,
    buildSignatureBase,
    parseSignatureInput,
    parseSignature,
    signRequest,
    verifyRequest,
    DEFAULT_COVERED_COMPONENTS
} from '../lib/utils/httpSignature.js';

const makeKeyPair = () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    return { publicKey: publicKey.export({ format: 'jwk' }), privateKey: privateKey.export({ format: 'jwk' }) };
};

/** Turns a signRequest result into the headers a verifier receives. */
const toHeaders = (signed, workerId, extra = {}) => ({
    'x-r_sync-worker-id': workerId,
    'content-digest': signed.contentDigest,
    'signature-input': signed.signatureInput,
    signature: signed.signature,
    ...extra
});

const URL_A = 'http://orchestrator.internal:8080/r_sync/api/v1/worker-event';

test('SIG-001: a signed request verifies and is bound to its exact target', async t => {
    const keys = makeKeyPair();
    const body = { payload: 'abc', signature: 'xyz', timestamp: 1 };

    const signed = signRequest({
        method: 'POST',
        url: URL_A,
        body,
        workerId: 'worker-1',
        privateJwk: keys.privateKey,
        nonce: 'nonce-1'
    });

    await t.test('round-trips', () => {
        const result = verifyRequest({
            method: 'POST',
            url: URL_A,
            headers: toHeaders(signed, 'worker-1'),
            body,
            publicJwk: keys.publicKey
        });

        assert.equal(result.valid, true, result.reason);
        assert.equal(result.params.keyid, 'worker-1');
        assert.equal(result.params.nonce, 'nonce-1');
    });

    await t.test('emits the RFC-shaped headers', () => {
        assert.match(signed.contentDigest, /^sha-256=:[A-Za-z0-9+/=]+:$/);
        assert.match(signed.signatureInput, /^sig1=\("@method" "@target-uri" "content-digest" "x-r_sync-worker-id"\);created=\d+;keyid="worker-1";nonce="nonce-1";alg="ed25519"$/);
        assert.match(signed.signature, /^sig1=:[A-Za-z0-9+/=]+:$/);
    });

    await t.test('cannot be replayed against another host — the gap @target-uri closes', () => {
        const result = verifyRequest({
            method: 'POST',
            url: 'http://evil.internal:8080/r_sync/api/v1/worker-event',
            headers: toHeaders(signed, 'worker-1'),
            body,
            publicJwk: keys.publicKey
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'INVALID_SIGNATURE');
    });

    await t.test('cannot be lifted onto another path or method', () => {
        assert.equal(
            verifyRequest({ method: 'POST', url: URL_A.replace('worker-event', 'admin'), headers: toHeaders(signed, 'worker-1'), body, publicJwk: keys.publicKey })
                .valid,
            false
        );

        assert.equal(verifyRequest({ method: 'DELETE', url: URL_A, headers: toHeaders(signed, 'worker-1'), body, publicJwk: keys.publicKey }).valid, false);
    });

    await t.test('a tampered body is caught by Content-Digest', () => {
        const result = verifyRequest({
            method: 'POST',
            url: URL_A,
            headers: toHeaders(signed, 'worker-1'),
            body: { ...body, payload: 'tampered' },
            publicJwk: keys.publicKey
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'CONTENT_DIGEST_MISMATCH');
    });

    await t.test('another worker key does not verify', () => {
        const result = verifyRequest({
            method: 'POST',
            url: URL_A,
            headers: toHeaders(signed, 'worker-1'),
            body,
            publicJwk: makeKeyPair().publicKey
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'INVALID_SIGNATURE');
    });
});

test('SIG-002: the signature base is unambiguous', async t => {
    await t.test('values containing the old delimiter cannot shift field boundaries', () => {
        // The previous format joined fields with ":" — a character that appears
        // in hosts and paths. Two different requests could canonicalize to the
        // same string. RFC 9421 quotes and line-delimits every component, so
        // these must differ.
        const params = { created: 1700000000, keyid: 'w1', nonce: 'n1', alg: 'ed25519' };

        const a = buildSignatureBase({
            components: ['@method', '@target-uri'],
            method: 'POST',
            url: 'http://host:8080/a',
            headers: {},
            digest: null,
            params
        });

        const b = buildSignatureBase({
            components: ['@method', '@target-uri'],
            method: 'POST',
            url: 'http://host:8080/a:b',
            headers: {},
            digest: null,
            params
        });

        assert.notEqual(a, b);
    });

    await t.test('signature parameters are themselves signed', () => {
        const params = { created: 1700000000, keyid: 'w1', nonce: 'n1', alg: 'ed25519' };
        const base = buildSignatureBase({ components: ['@method'], method: 'POST', url: URL_A, headers: {}, digest: null, params });

        // The last line carries created/keyid/nonce, so none of them can be
        // altered in transit without breaking verification.
        assert.match(base, /"@signature-params": \("@method"\);created=1700000000;keyid="w1";nonce="n1";alg="ed25519"$/);
        assert.equal(base.endsWith('\n'), false, 'the base must not end with a newline');
    });

    await t.test('a covered component that is absent is a hard error, not an empty string', () => {
        assert.throws(
            () =>
                buildSignatureBase({
                    components: ['x-missing-header'],
                    method: 'POST',
                    url: URL_A,
                    headers: {},
                    digest: null,
                    params: { created: 1, keyid: 'w', nonce: 'n', alg: 'ed25519' }
                }),
            /not present/
        );
    });

    await t.test('@authority elides the default port', () => {
        const params = { created: 1, keyid: 'w', nonce: 'n', alg: 'ed25519' };
        const withPort = buildSignatureBase({ components: ['@authority'], method: 'GET', url: 'https://h.example.com:443/x', headers: {}, digest: null, params });
        const without = buildSignatureBase({ components: ['@authority'], method: 'GET', url: 'https://h.example.com/x', headers: {}, digest: null, params });

        assert.equal(withPort, without);
    });
});

test('SIG-003: policy is enforced independently of what the signer chose to cover', async t => {
    const keys = makeKeyPair();
    const body = { a: 1 };

    await t.test('a signature covering less than policy requires is refused', () => {
        // Legitimately signed — but only over "@method". Without this check an
        // attacker who can re-sign could leave the body and target unprotected.
        const weak = signRequest({
            method: 'POST',
            url: URL_A,
            body,
            workerId: 'worker-1',
            privateJwk: keys.privateKey,
            nonce: 'n',
            components: ['@method']
        });

        const result = verifyRequest({
            method: 'POST',
            url: URL_A,
            headers: toHeaders(weak, 'worker-1'),
            body,
            publicJwk: keys.publicKey,
            requiredComponents: DEFAULT_COVERED_COMPONENTS
        });

        assert.equal(result.valid, false);
        assert.match(result.reason, /^MISSING_COMPONENT:/);
    });

    await t.test('a stale or future-dated signature is refused', () => {
        const now = Math.floor(Date.now() / 1000);

        const old = signRequest({ method: 'POST', url: URL_A, body, workerId: 'w', privateJwk: keys.privateKey, nonce: 'n1', created: now - 600 });
        assert.equal(verifyRequest({ method: 'POST', url: URL_A, headers: toHeaders(old, 'w'), body, publicJwk: keys.publicKey }).reason, 'STALE_OR_FUTURE_CREATED');

        const future = signRequest({ method: 'POST', url: URL_A, body, workerId: 'w', privateJwk: keys.privateKey, nonce: 'n2', created: now + 600 });
        assert.equal(
            verifyRequest({ method: 'POST', url: URL_A, headers: toHeaders(future, 'w'), body, publicJwk: keys.publicKey }).reason,
            'STALE_OR_FUTURE_CREATED'
        );
    });

    await t.test('malformed headers are refused rather than partially understood', () => {
        assert.equal(parseSignatureInput('garbage'), null);
        assert.equal(parseSignatureInput('sig1=()'), null, 'an empty component list is not usable');
        assert.equal(parseSignature('sig1=notbytes'), null);

        const result = verifyRequest({ method: 'POST', url: URL_A, headers: { 'signature-input': 'garbage' }, body, publicJwk: keys.publicKey });
        assert.equal(result.valid, false);
        assert.equal(result.reason, 'MALFORMED_SIGNATURE_INPUT');
    });

    await t.test('a non-ed25519 alg is refused', () => {
        const signed = signRequest({ method: 'POST', url: URL_A, body, workerId: 'w', privateJwk: keys.privateKey, nonce: 'n' });
        const headers = toHeaders(signed, 'w');
        headers['signature-input'] = headers['signature-input'].replace('alg="ed25519"', 'alg="hmac-sha256"');

        assert.equal(verifyRequest({ method: 'POST', url: URL_A, headers, body, publicJwk: keys.publicKey }).reason, 'UNSUPPORTED_ALG');
    });
});

test('SIG-004: Content-Digest canonicalizes an absent body identically on both sides', async t => {
    await t.test('null, undefined and {} agree', () => {
        // Express hands a bodyless POST to the verifier as {}. If the signer
        // digested something else, every heartbeat would fail to verify.
        assert.equal(contentDigest(null), contentDigest({}));
        assert.equal(contentDigest(undefined), contentDigest({}));
    });

    await t.test('matching is constant-time-safe and rejects mismatches', () => {
        assert.equal(contentDigestMatches(contentDigest({ a: 1 }), { a: 1 }), true);
        assert.equal(contentDigestMatches(contentDigest({ a: 1 }), { a: 2 }), false);
        assert.equal(contentDigestMatches(undefined, { a: 1 }), false);
        assert.equal(contentDigestMatches('sha-256=:short:', { a: 1 }), false);
    });

    await t.test('a heartbeat with no body round-trips', () => {
        const keys = makeKeyPair();
        const signed = signRequest({ method: 'POST', url: URL_A, body: {}, workerId: 'w', privateJwk: keys.privateKey, nonce: 'n' });

        const result = verifyRequest({ method: 'POST', url: URL_A, headers: toHeaders(signed, 'w'), body: {}, publicJwk: keys.publicKey });

        assert.equal(result.valid, true, result.reason);
    });
});
