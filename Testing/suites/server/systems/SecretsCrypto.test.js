import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { SecretsCrypto } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/SecretsCrypto.js';

const sc = new SecretsCrypto('access');

function assertKeyMaterial(result, domain) {
    // generateId upper-cases the whole prefix (`access_key_pair` → `ACCESS_KEY_PAIR`)
    assert.match(result.keyPairId, new RegExp(`^ID_${domain.toUpperCase()}_KEY_PAIR-`));
    assert.match(result.keyPairHash, /^[0-9a-f]{64}$/);
    assert.match(result.keys.public.pem, /BEGIN PUBLIC KEY/);
    assert.match(result.keys.private.pem, /BEGIN PRIVATE KEY/);
    assert.ok(result._nodePrivateKey);
    assert.ok(result._nodePublicKey);
    assert.equal(typeof result.publicKeyExp, 'number');
    assert.equal(typeof result.privateKeyExp, 'number');
    // signing key should expire before the (longer-lived) verifying key
    assert.ok(result.privateKeyExp <= result.publicKeyExp);
}

describe('SecretsCrypto — ECDSA', () => {
    test('generates a usable P-256 signing keypair', async () => {
        const result = await sc.generateECDSAKey({ size: 256 });
        assertKeyMaterial(result, 'access');

        // Prove the exported node keys are a real pair.
        const data = Buffer.from('sign-me');
        const sig = crypto.sign('sha256', data, result._nodePrivateKey);
        assert.equal(crypto.verify('sha256', data, result._nodePublicKey, sig), true);
        assert.equal(crypto.verify('sha256', Buffer.from('tampered'), result._nodePublicKey, sig), false);
    });

    test('re-imports an exported public key (base64 → key material)', async () => {
        const result = await sc.generateECDSAKey({ size: 256 });
        const imported = await sc.importECDSAPublicKeyFromBase64(result.keys.public.base64, 'P-256');
        assert.equal(imported.base64, result.keys.public.base64);
        assert.match(imported.pem, /BEGIN PUBLIC KEY/);
        assert.ok(imported._nodePublicKey);
    });

    test('re-imports an exported private key from JWK', async () => {
        const result = await sc.generateECDSAKey({ size: 256 });
        const imported = await sc.importECDSAPrivateKeyFromJWK(result.keys.private.jwk);
        assert.ok(imported._nodePrivateKey);
        assert.match(imported.pem, /BEGIN PRIVATE KEY/);
    });
});

describe('SecretsCrypto — RSA', () => {
    test('generates a usable RS256 keypair', async () => {
        const result = await sc.generateRSAKey({ size: 2048, algorithm: 'RS256' });
        assertKeyMaterial(result, 'access');

        const data = Buffer.from('rsa-sign-me');
        const sig = crypto.sign('sha256', data, result._nodePrivateKey);
        assert.equal(crypto.verify('sha256', data, result._nodePublicKey, sig), true);
    });

    test('re-imports an exported RSA public key (base64)', async () => {
        const result = await sc.generateRSAKey({ size: 2048, algorithm: 'RS256' });
        const imported = await sc.importRSAPublicKeyFromBase64(result.keys.public.base64, 'SHA-256');
        assert.equal(imported.base64, result.keys.public.base64);
        assert.ok(imported._nodePublicKey);
    });
});

describe('SecretsCrypto — formatPEM', () => {
    test('wraps base64 in PEM armor with 64-char lines', () => {
        const b64 = 'A'.repeat(200);
        const pem = sc.formatPEM(b64, 'PUBLIC KEY');
        assert.ok(pem.startsWith('-----BEGIN PUBLIC KEY-----\n'));
        assert.ok(pem.trimEnd().endsWith('-----END PUBLIC KEY-----'));
        const body = pem.split('\n').slice(1, -2);
        assert.ok(body.every(line => line.length <= 64));
    });
});
