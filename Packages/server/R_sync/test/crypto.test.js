import { describe, it } from 'node:test';
import assert from 'node:assert';
import { encrypt, decrypt, generateSignatureKeyPair, generateSignature, verifySignature } from '../lib/utils/crypto.js';

describe('crypto AES-GCM + Ed25519', () => {
    it('round-trips plaintext', () => {
        const key = Buffer.alloc(32, 7);
        const msg = JSON.stringify({ hello: 'world', n: 42 });
        const enc = encrypt(msg, key);
        const out = decrypt(enc, key);
        assert.strictEqual(out, msg);
    });

    it('verifies signed payload', () => {
        const pair = generateSignatureKeyPair();
        const data = 'worker-1:1234567890:nonce';
        const sig = generateSignature(data, pair.privateKey);
        assert.strictEqual(verifySignature(data, sig, pair.publicKey), true);
        assert.strictEqual(verifySignature(data + 'x', sig, pair.publicKey), false);
    });
});
