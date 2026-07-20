import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AUTH_TIMESTAMP_LEEWAY_SEC, isTimestampWithinLeeway } from '../lib/core/middleware/securityMiddleware.js';
import { generateSignatureKeyPair, generateSignature, verifySignature, sha256Hash } from '../lib/utils/crypto.js';

describe('securityMiddleware time helpers', () => {
    it('accepts timestamps within leeway (seconds)', () => {
        const now = 1_700_000_000;
        assert.strictEqual(isTimestampWithinLeeway(now, now, AUTH_TIMESTAMP_LEEWAY_SEC), true);
        assert.strictEqual(isTimestampWithinLeeway(now - 10, now, AUTH_TIMESTAMP_LEEWAY_SEC), true);
        assert.strictEqual(isTimestampWithinLeeway(now - 100, now, AUTH_TIMESTAMP_LEEWAY_SEC), false);
    });

    it('rejects non-finite timestamps', () => {
        assert.strictEqual(isTimestampWithinLeeway(NaN, 1, 30), false);
        assert.strictEqual(isTimestampWithinLeeway(0, 1, 30), false);
    });

    it('registration PoP (nonce + key-bound) matches between client and middleware', () => {
        const identity = generateSignatureKeyPair();
        const ts = 1_700_000_050;
        const workerId = '';
        const nonce = '123456789';
        const encryptionPublicKey = [1, 2, 3, 4, 5];

        // Client side (interface.js startWorker)
        const encKeyDigest = sha256Hash(JSON.stringify(encryptionPublicKey));
        const clientPayload = `${ts}:${workerId}:${nonce}:${encKeyDigest}`;
        const sig = generateSignature(clientPayload, identity.privateKey);

        // Middleware side (validateRegistrationSignature) reconstructs identically
        const middlewareDigest = sha256Hash(JSON.stringify(encryptionPublicKey));
        const middlewarePayload = `${parseInt(String(ts), 10)}:${workerId}:${nonce}:${middlewareDigest}`;
        assert.strictEqual(clientPayload, middlewarePayload);
        assert.strictEqual(verifySignature(middlewarePayload, sig, identity.publicKey), true);
    });

    it('registration PoP fails if the encryption key is swapped', () => {
        const identity = generateSignatureKeyPair();
        const ts = 1_700_000_050;
        const nonce = '123456789';
        const original = [1, 2, 3];
        const tampered = [9, 9, 9];
        const payload = `${ts}::${nonce}:${sha256Hash(JSON.stringify(original))}`;
        const sig = generateSignature(payload, identity.privateKey);
        const tamperedPayload = `${ts}::${nonce}:${sha256Hash(JSON.stringify(tampered))}`;
        assert.strictEqual(verifySignature(tamperedPayload, sig, identity.publicKey), false);
    });
});
