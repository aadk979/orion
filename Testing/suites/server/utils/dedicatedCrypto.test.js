import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    generateKeyPairECC,
    exportPublicKeyECC,
    importPublicKeyECC,
    exportPrivateKeyECC,
    importPrivateKeyECC,
    deriveSharedSecret,
    deriveKey,
    generateKeyPairDedicated,
    encryptPublic,
    decryptPrivate
} from '../../../../Packages/server/Orion-core/lib/Utils/dedicatedCrypto.js';

describe('ECDH key agreement (client↔server transport)', () => {
    test('two parties derive the same shared secret', async () => {
        const alice = await generateKeyPairECC();
        const bob = await generateKeyPairECC();

        const aliceSecret = await deriveSharedSecret(alice.privateKey, bob.publicKey);
        const bobSecret = await deriveSharedSecret(bob.privateKey, alice.publicKey);

        assert.ok(aliceSecret instanceof Uint8Array);
        assert.equal(aliceSecret.length, 32);
        assert.deepEqual(Array.from(aliceSecret), Array.from(bobSecret));
    });

    test('public key raw export/import round-trips and still agrees', async () => {
        const alice = await generateKeyPairECC();
        const bob = await generateKeyPairECC();

        const bobRaw = await exportPublicKeyECC(bob.publicKey);
        assert.ok(bobRaw instanceof Uint8Array);
        const bobReimported = await importPublicKeyECC(bobRaw);

        const s1 = await deriveSharedSecret(alice.privateKey, bob.publicKey);
        const s2 = await deriveSharedSecret(alice.privateKey, bobReimported);
        assert.deepEqual(Array.from(s1), Array.from(s2));
    });

    test('private key pkcs8 export/import round-trips', async () => {
        const alice = await generateKeyPairECC();
        const bob = await generateKeyPairECC();

        const alicePkcs8 = await exportPrivateKeyECC(alice.privateKey);
        const aliceReimported = await importPrivateKeyECC(alicePkcs8);

        const s1 = await deriveSharedSecret(alice.privateKey, bob.publicKey);
        const s2 = await deriveSharedSecret(aliceReimported, bob.publicKey);
        assert.deepEqual(Array.from(s1), Array.from(s2));
    });

    test('deriveKey (HKDF) produces a 32-byte AES key, deterministic for same inputs', async () => {
        const alice = await generateKeyPairECC();
        const bob = await generateKeyPairECC();
        const secret = await deriveSharedSecret(alice.privateKey, bob.publicKey);

        const salt = new Uint8Array(16).fill(1);
        const info = new TextEncoder().encode('orion-transport');
        const k1 = await deriveKey(secret, salt, info);
        const k2 = await deriveKey(secret, salt, info);

        assert.equal(k1.length, 32);
        assert.deepEqual(Array.from(k1), Array.from(k2));

        const k3 = await deriveKey(secret, new Uint8Array(16).fill(2), info);
        assert.notDeepEqual(Array.from(k1), Array.from(k3));
    });
});

describe('RSA-OAEP dedicated keypair', () => {
    test('encryptPublic/decryptPrivate round-trip', async () => {
        const { publicKey, privateKey } = await generateKeyPairDedicated(2048);
        assert.match(publicKey, /BEGIN PUBLIC KEY/);
        const ct = await encryptPublic('handshake-token', publicKey);
        assert.equal(typeof ct, 'string');
        const pt = await decryptPrivate(ct, privateKey);
        assert.equal(pt, 'handshake-token');
    });

    test('decrypting garbage returns an error envelope rather than throwing', async () => {
        const { privateKey } = await generateKeyPairDedicated(2048);
        const result = await decryptPrivate('not-valid-base64-ciphertext', privateKey);
        assert.equal(result.error, true);
        assert.equal(typeof result.context, 'string');
    });
});
