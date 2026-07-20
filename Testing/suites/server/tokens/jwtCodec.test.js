import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import { decodeKeyId, signWithKeyPair, verifyWithKeyPair } from '../../../../Packages/server/Orion-core/lib/Utils/Core/TokenManagement/internals/jwtCodec.js';

// Shape a TokenSecretsManager key pair object around a locally generated
// P-256 pair (the managers are configured ES256 in onStartConfigurations.js).
const makeSecret = keyPairId => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    return {
        keyPairId,
        generationConfig: { algorithm: 'ES256' },
        _nodePrivateKey: privateKey,
        _nodePublicKey: publicKey
    };
};

describe('jwtCodec', () => {
    const secret = makeSecret('kid-test-1');

    test('sign → verify round-trip carries the payload and the kid', () => {
        const token = signWithKeyPair(secret, { u: 'USER_1', st: 4 }, '5m');

        assert.equal(decodeKeyId(token), 'kid-test-1');

        const result = verifyWithKeyPair(token, secret);
        assert.equal(result.valid, true);
        assert.equal(result.payload.u, 'USER_1');
        assert.equal(result.payload.st, 4);
        assert.ok(result.payload.exp > Date.now() / 1000);
    });

    test('expired tokens are reported as expired, not generically invalid', () => {
        const token = signWithKeyPair(secret, { u: 'USER_1' }, '-10s');
        assert.deepEqual(verifyWithKeyPair(token, secret), { valid: false, expired: true });
    });

    test('tokens signed with a different key fail verification as invalid', () => {
        const otherSecret = makeSecret('kid-test-2');
        const token = signWithKeyPair(otherSecret, { u: 'USER_1' }, '5m');
        assert.deepEqual(verifyWithKeyPair(token, secret), { valid: false, expired: false });
    });

    test('malformed tokens never throw', () => {
        assert.equal(decodeKeyId('not-a-jwt-at-all'), null);
        assert.equal(decodeKeyId(''), null);
        assert.deepEqual(verifyWithKeyPair('not-a-jwt-at-all', secret), { valid: false, expired: false });
    });

    test('structurally valid tokens without a kid decode to null keyId', () => {
        const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
        const kidlessToken = `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ u: 'USER_1' })}.fakesig`;
        assert.equal(decodeKeyId(kidlessToken), null);
    });
});
