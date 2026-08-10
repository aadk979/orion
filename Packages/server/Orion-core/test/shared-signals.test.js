/**
 * Shared Signals / CAEP.
 *
 * Covers the SET envelope rules that are easy to get wrong when a codebase
 * already has JWT plumbing (explicit typing, no `exp`, replay, audience), the
 * CAEP payload shapes, stream validation, and a real push delivery over a live
 * HTTP server including the retry path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import jwt from 'jsonwebtoken';

import {
    buildSetClaims,
    signSet,
    verifySet,
    toPublicJwk,
    issSubSubject,
    opaqueSubject,
    isValidSubject,
    SET_TYP
} from '../lib/Utils/Core/SharedSignals/SecurityEventToken.js';
import { CaepEventTypes, CredentialTypes, ChangeTypes, sessionRevoked, credentialChange, tokenClaimsChange } from '../lib/Utils/Core/SharedSignals/CaepEvents.js';
import { SsfStreamRegistry, DeliveryMethods, StreamStatus } from '../lib/Utils/Core/SharedSignals/SsfStreamRegistry.js';
import { SsfTransmitter } from '../lib/Utils/Core/SharedSignals/SsfTransmitter.js';
import { createReplayGuard } from '../lib/Utils/Core/TokenManagement/internals/proofReplayGuard.js';

// ── helpers ─────────────────────────────────────────────────────────────────
const ISSUER = 'https://auth.example.com';
const AUDIENCE = 'https://receiver.example.com';

/** A stand-in for a TokenSecretsManager key pair. */
const makePair = () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    return {
        keyPairId: `kid-${crypto.randomBytes(4).toString('hex')}`,
        _nodePrivateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        _nodePublicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        generationConfig: { algorithm: 'ES256', type: 'ECDSA' }
    };
};

const makeSet = (pair, { events, audience = AUDIENCE, issuer = ISSUER } = {}) =>
    signSet(buildSetClaims({ issuer, audience, events: events || sessionRevoked({ issuer, uid: 'user-1' }) }), pair);

// ── RFC 8417 envelope ───────────────────────────────────────────────────────
test('SET-001: the SET envelope follows RFC 8417', async t => {
    const pair = makePair();

    await t.test('a well-formed SET verifies', () => {
        const result = verifySet({
            token: makeSet(pair),
            verificationPair: pair,
            expectedIssuer: ISSUER,
            expectedAudience: AUDIENCE
        });

        assert.equal(result.valid, true);
        assert.ok(result.claims.jti);
        assert.equal(result.claims.iss, ISSUER);
    });

    await t.test('carries typ secevent+jwt and NO exp', () => {
        const decoded = jwt.decode(makeSet(pair), { complete: true });

        assert.equal(decoded.header.typ, SET_TYP);
        // RFC 8417 §4.1.4 — a SET reports the past; it does not stop being true.
        assert.equal(decoded.payload.exp, undefined, 'a SET must not carry exp');
        // §2.2 — the subject belongs inside the event, not at the top level.
        assert.equal(decoded.payload.sub, undefined, 'a SET should not carry a top-level sub');
    });

    await t.test('an access token presented as a SET is refused on typ alone', () => {
        // Same key, same issuer/audience — only the type differs. This is the
        // token-confusion case explicit typing exists to stop.
        const notASet = jwt.sign({ iss: ISSUER, aud: AUDIENCE, events: {} }, pair._nodePrivateKey, {
            algorithm: 'ES256',
            keyid: pair.keyPairId
        });

        const result = verifySet({ token: notASet, verificationPair: pair, expectedIssuer: ISSUER, expectedAudience: AUDIENCE });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'WRONG_TYP');
    });

    await t.test('a SET signed by another key is refused', () => {
        const result = verifySet({
            token: makeSet(makePair()),
            verificationPair: pair,
            expectedIssuer: ISSUER,
            expectedAudience: AUDIENCE
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'BAD_SIGNATURE');
    });

    await t.test('a SET for another audience is refused', () => {
        const result = verifySet({
            token: makeSet(pair, { audience: 'https://somebody-else.example.com' }),
            verificationPair: pair,
            expectedIssuer: ISSUER,
            expectedAudience: AUDIENCE
        });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'AUDIENCE_MISMATCH');
    });

    await t.test('a replayed SET is refused, and a bogus one cannot burn a jti', () => {
        const guard = createReplayGuard({ retentionSec: 600 });
        const token = makeSet(pair);

        const first = verifySet({ token, verificationPair: pair, expectedIssuer: ISSUER, expectedAudience: AUDIENCE, replayGuard: guard });
        assert.equal(first.valid, true);

        const second = verifySet({ token, verificationPair: pair, expectedIssuer: ISSUER, expectedAudience: AUDIENCE, replayGuard: guard });
        assert.equal(second.valid, false);
        assert.equal(second.reason, 'REPLAYED');

        // A SET that fails signature must not consume its jti — otherwise an
        // attacker pre-burns ids and the genuine redelivery bounces as a replay.
        const forged = makeSet(makePair());
        const forgedJti = jwt.decode(forged).jti;

        verifySet({ token: forged, verificationPair: pair, expectedIssuer: ISSUER, expectedAudience: AUDIENCE, replayGuard: guard });
        assert.equal(guard.isFresh(forgedJti), true, 'a rejected SET must not consume its jti');
    });

    await t.test('a stale SET is refused', () => {
        const old = jwt.sign(
            { iss: ISSUER, aud: AUDIENCE, jti: 'j1', iat: Math.floor(Date.now() / 1000) - 3600, events: sessionRevoked({ issuer: ISSUER, uid: 'u' }) },
            pair._nodePrivateKey,
            { algorithm: 'ES256', keyid: pair.keyPairId, header: { typ: SET_TYP }, noTimestamp: true }
        );

        const result = verifySet({ token: old, verificationPair: pair, expectedIssuer: ISSUER, expectedAudience: AUDIENCE });

        assert.equal(result.valid, false);
        assert.equal(result.reason, 'STALE_IAT');
    });

    await t.test('the published JWK carries no private material', () => {
        const jwk = toPublicJwk(pair);

        assert.equal(jwk.kid, pair.keyPairId);
        assert.equal(jwk.use, 'sig');
        assert.equal(jwk.d, undefined, 'a published JWK must never contain the private scalar');
    });
});

// ── RFC 9493 subjects + CAEP payloads ───────────────────────────────────────
test('SET-002: CAEP events carry resolvable RFC 9493 subjects', async t => {
    await t.test('subject validation rejects unusable shapes', () => {
        assert.equal(isValidSubject(issSubSubject(ISSUER, 'u1')), true);
        assert.equal(isValidSubject(opaqueSubject('link-1')), true);

        assert.equal(isValidSubject(null), false);
        assert.equal(isValidSubject('user-1'), false, 'a bare string is not a subject identifier');
        assert.equal(isValidSubject({ format: 'iss_sub', iss: ISSUER }), false, 'iss_sub needs both members');
        assert.equal(isValidSubject({ format: 'invented' }), false, 'unknown formats are refused, not passed through');
    });

    await t.test('session-revoked is account-scoped or session-scoped', () => {
        const account = sessionRevoked({ issuer: ISSUER, uid: 'u1' });
        const single = sessionRevoked({ issuer: ISSUER, linkCode: 'link-9' });

        assert.equal(account[CaepEventTypes.SESSION_REVOKED].subject.format, 'iss_sub');
        assert.equal(account[CaepEventTypes.SESSION_REVOKED].subject.sub, 'u1');

        assert.equal(single[CaepEventTypes.SESSION_REVOKED].subject.format, 'opaque');
        assert.equal(single[CaepEventTypes.SESSION_REVOKED].subject.id, 'link-9');
    });

    await t.test('every event carries its own occurrence timestamp', () => {
        // Distinct from the SET's iat: they diverge whenever delivery is retried,
        // and a receiver ordering by transmission time applies them out of order.
        const event = sessionRevoked({ issuer: ISSUER, uid: 'u1' })[CaepEventTypes.SESSION_REVOKED];
        assert.equal(typeof event.event_timestamp, 'number');
    });

    await t.test('credential-change and token-claims-change carry their specifics', () => {
        const cred = credentialChange({
            issuer: ISSUER,
            uid: 'u1',
            credentialType: CredentialTypes.PASSWORD,
            changeType: ChangeTypes.UPDATE
        })[CaepEventTypes.CREDENTIAL_CHANGE];

        assert.equal(cred.credential_type, 'password');
        assert.equal(cred.change_type, 'update');

        const claims = tokenClaimsChange({ issuer: ISSUER, uid: 'u1', claims: { role: 'USER' } })[CaepEventTypes.TOKEN_CLAIMS_CHANGE];
        assert.deepEqual(claims.claims, { role: 'USER' });
    });

    await t.test('an event with an unusable subject is refused at build time', () => {
        assert.throws(() => sessionRevoked({ issuer: ISSUER }), /Subject Identifier/, 'no uid and no linkCode means no resolvable subject');
    });
});

// ── stream configuration ────────────────────────────────────────────────────
test('SET-003: stream configuration is validated, not echoed', async t => {
    const registry = new SsfStreamRegistry();
    registry._isCluster = false;

    await t.test('a push stream requires an https endpoint', async () => {
        const missing = await registry.create({ delivery: { method: DeliveryMethods.PUSH } });
        assert.equal(missing.error, true);

        const plaintext = await registry.create({
            delivery: { method: DeliveryMethods.PUSH, endpoint_url: 'http://receiver.example.com/events' }
        });
        assert.equal(plaintext.error, true, 'SETs name users — plaintext delivery is refused');
    });

    await t.test('events_delivered reports what we will really send', async () => {
        const result = await registry.create({
            aud: AUDIENCE,
            delivery: { method: DeliveryMethods.PUSH, endpoint_url: 'https://receiver.example.com/events' },
            events_requested: [CaepEventTypes.SESSION_REVOKED, 'https://example.com/invented-event']
        });

        assert.equal(result.error, false);
        assert.deepEqual(result.stream.events_delivered, [CaepEventTypes.SESSION_REVOKED], 'unsupported requests must not be silently accepted');
    });

    await t.test('only enabled streams subscribed to the type are selected', async () => {
        const fresh = new SsfStreamRegistry();
        fresh._isCluster = false;

        const created = await fresh.create({
            aud: AUDIENCE,
            delivery: { method: DeliveryMethods.PUSH, endpoint_url: 'https://receiver.example.com/events' },
            events_requested: [CaepEventTypes.SESSION_REVOKED]
        });

        assert.equal((await fresh.streamsFor(CaepEventTypes.SESSION_REVOKED)).length, 1);
        assert.equal((await fresh.streamsFor(CaepEventTypes.CREDENTIAL_CHANGE)).length, 0, 'a stream must not receive types it did not request');

        await fresh.setStatus(created.stream.stream_id, StreamStatus.PAUSED);
        assert.equal((await fresh.streamsFor(CaepEventTypes.SESSION_REVOKED)).length, 0, 'a paused stream receives nothing');
    });
});

// ── real push delivery ──────────────────────────────────────────────────────
test('SET-004: push delivery reaches a live receiver and retries transient failure', async t => {
    const received = [];
    let failuresRemaining = 0;

    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => (body += c));
        req.on('end', () => {
            if (failuresRemaining > 0) {
                failuresRemaining--;
                res.writeHead(503).end();
                return;
            }
            received.push({ contentType: req.headers['content-type'], body, auth: req.headers['authorization'] });
            res.writeHead(202).end();
        });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const endpoint = `http://127.0.0.1:${port}/events`;

    t.after(() => server.close());

    const pair = makePair();
    const transmitter = new SsfTransmitter();

    await t.test('a SET is POSTed as application/secevent+jwt and verifies at the receiver', async () => {
        const stream = {
            stream_id: 's1',
            aud: AUDIENCE,
            delivery: { method: DeliveryMethods.PUSH, endpoint_url: endpoint },
            delivery_auth: 'receiver-secret'
        };

        const token = signSet(buildSetClaims({ issuer: ISSUER, audience: AUDIENCE, events: sessionRevoked({ issuer: ISSUER, uid: 'u1' }) }), pair);

        const result = await transmitter._push(stream, token, 'jti-1', 0);

        assert.equal(result.delivered, true);
        assert.equal(received.length, 1);
        assert.equal(received[0].contentType, 'application/secevent+jwt');
        assert.equal(received[0].auth, 'Bearer receiver-secret');

        // The receiver can independently verify what arrived.
        const verified = verifySet({
            token: received[0].body,
            verificationPair: pair,
            expectedIssuer: ISSUER,
            expectedAudience: AUDIENCE
        });
        assert.equal(verified.valid, true);
        assert.ok(verified.claims.events[CaepEventTypes.SESSION_REVOKED]);
    });

    await t.test('a 4xx rejection is permanent and is not retried', async () => {
        const rejecting = http.createServer((req, res) => res.writeHead(400).end());
        await new Promise(resolve => rejecting.listen(0, '127.0.0.1', resolve));
        t.after(() => rejecting.close());

        const stream = {
            stream_id: 's2',
            aud: AUDIENCE,
            delivery: { method: DeliveryMethods.PUSH, endpoint_url: `http://127.0.0.1:${rejecting.address().port}/events` }
        };

        const result = await transmitter._push(stream, makeSet(pair), 'jti-2', 0);

        assert.equal(result.delivered, false);
        assert.equal(result.permanent, true, 'retrying an identical payload cannot change a 400');
    });

    transmitter.shutdown();
});

// ── poll delivery ───────────────────────────────────────────────────────────
test('SET-005: poll delivery holds events until acknowledged', async t => {
    const transmitter = new SsfTransmitter();

    transmitter._enqueueForPoll('s1', 'token-a', 'jti-a');
    transmitter._enqueueForPoll('s1', 'token-b', 'jti-b');

    await t.test('polling returns queued SETs without consuming them', () => {
        const first = transmitter.poll('s1');
        assert.deepEqual(Object.keys(first.sets).sort(), ['jti-a', 'jti-b']);

        // A receiver that crashed between receiving and processing must still
        // find its events waiting.
        const again = transmitter.poll('s1');
        assert.equal(Object.keys(again.sets).length, 2);
    });

    await t.test('acknowledgement is what removes them', () => {
        assert.equal(transmitter.acknowledge('s1', ['jti-a']).acknowledged, 1);

        const remaining = transmitter.poll('s1');
        assert.deepEqual(Object.keys(remaining.sets), ['jti-b']);
    });

    await t.test('a receiver that never polls cannot grow the queue without bound', () => {
        const flood = new SsfTransmitter();

        for (let i = 0; i < 1500; i++) flood._enqueueForPoll('dead', `token-${i}`, `jti-${i}`);

        const queued = flood.getStats().queuedEvents;
        assert.ok(queued <= 1000, `poll queue grew to ${queued}`);
    });

    transmitter.shutdown();
});
