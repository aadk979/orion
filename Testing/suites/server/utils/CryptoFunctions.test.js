import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    sha256Hash,
    sha512Hash,
    blake2bHash,
    blake2sHash,
    pbkdf2Hash,
    scryptHash,
    hashStringSync,
    verifyHashSync,
    hashString,
    verifyHash,
    encrypt,
    decrypt,
    generateEncryptionKey,
    exportKeyBase64,
    importKeyFromBase64,
    generateKeyPair,
    publicEncrypt,
    privateDecrypt,
    generateHmac,
    generateHmacKey,
    hashToBigNumber,
    generateSignatureKeyPair,
    generateSignature,
    verifySignature
} from '../../../../Packages/server/Orion-core/lib/Utils/CryptoFunctions.js';
import { aesKey } from '../../../helpers/fixtures.js';

describe('raw digest helpers', () => {
    test('sha256 is a stable 64-hex-char known-answer', () => {
        assert.equal(sha256Hash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    test('sha512 is 128 hex chars', () => {
        assert.match(sha512Hash('abc'), /^[0-9a-f]{128}$/);
    });

    test('blake2b / blake2s produce hex output', () => {
        assert.match(blake2bHash('abc'), /^[0-9a-f]{128}$/);
        assert.match(blake2sHash('abc'), /^[0-9a-f]{64}$/);
    });

    test('digest helpers reject empty / non-string input', () => {
        assert.throws(() => sha256Hash(''));
        assert.throws(() => sha256Hash('   '));
        assert.throws(() => sha512Hash(42));
    });

    test('pbkdf2 / scrypt are deterministic for a fixed salt', () => {
        assert.equal(pbkdf2Hash('pw', 'saltsalt'), pbkdf2Hash('pw', 'saltsalt'));
        assert.equal(scryptHash('pw', 'saltsalt'), scryptHash('pw', 'saltsalt'));
        assert.notEqual(pbkdf2Hash('pw', 'saltsalt'), pbkdf2Hash('pw', 'different'));
    });
});

describe('hashStringSync / verifyHashSync', () => {
    // For direct-concatenation digests the salt (empty string) is stable, so an
    // unsalted hash verifies deterministically.
    for (const alg of ['sha256', 'sha512', 'blake2b', 'blake2s']) {
        test(`${alg}: verifies a matching input (no salt)`, () => {
            const h = hashStringSync('secret-value', alg);
            assert.equal(verifyHashSync('secret-value', h, alg), true);
            assert.equal(verifyHashSync('wrong-value', h, alg), false);
        });
    }

    // Salted mode embeds the salt (`hash:*:salt`) so every algorithm — including
    // the KDF-based pbkdf2/scrypt — round-trips.
    for (const alg of ['sha256', 'sha512', 'blake2b', 'blake2s', 'pbkdf2', 'scrypt']) {
        test(`${alg}: salted hash embeds the salt and still verifies`, () => {
            const h = hashStringSync('secret-value', alg, true);
            assert.match(h, /:\*:/);
            assert.equal(verifyHashSync('secret-value', h, alg), true);
            assert.equal(verifyHashSync('nope', h, alg), false);
        });
    }

    test('pbkdf2/scrypt still produce hex output in unsalted mode', () => {
        assert.match(hashStringSync('x', 'pbkdf2'), /^[0-9a-f]+$/);
        assert.match(hashStringSync('x', 'scrypt'), /^[0-9a-f]+$/);
    });

    test('unsupported algorithm throws', () => {
        assert.throws(() => hashStringSync('x', 'md5'), /Unsupported algorithm/);
    });
});

describe('bcrypt hashString / verifyHash', () => {
    test('hashes and verifies a password', async () => {
        const hash = await hashString('hunter2');
        assert.match(hash, /^\$2[aby]\$/);
        assert.equal(await verifyHash('hunter2', hash), true);
        assert.equal(await verifyHash('wrong', hash), false);
    });
});

describe('AES-256-GCM encrypt / decrypt', () => {
    test('round-trips plaintext with a 32-byte key', () => {
        const key = aesKey();
        const ct = encrypt('top secret payload', key);
        assert.equal(typeof ct, 'string');
        assert.equal(decrypt(ct, key), 'top secret payload');
    });

    test('ciphertext is non-deterministic (random IV)', () => {
        const key = aesKey();
        assert.notEqual(encrypt('same', key), encrypt('same', key));
    });

    test('decrypting with the wrong key fails (auth tag)', () => {
        const ct = encrypt('data', aesKey());
        const otherKey = Buffer.alloc(32, 9);
        assert.throws(() => decrypt(ct, otherKey));
    });

    test('generateEncryptionKey + export/import base64 round-trip', () => {
        const key = generateEncryptionKey();
        assert.equal(key.length, 32);
        const b64 = exportKeyBase64(key);
        const restored = importKeyFromBase64(b64);
        const ct = encrypt('hello', key);
        assert.equal(decrypt(ct, restored), 'hello');
    });
});

describe('RSA keypair + public/private encryption', () => {
    test('generateKeyPair produces PEM keys that round-trip a message', async () => {
        const { publicKey, privateKey } = await generateKeyPair(2048);
        assert.match(publicKey, /BEGIN PUBLIC KEY/);
        assert.match(privateKey, /BEGIN PRIVATE KEY/);
        const enc = await publicEncrypt(publicKey, 'confidential');
        assert.equal(await privateDecrypt(privateKey, enc), 'confidential');
    });
});

describe('HMAC helpers', () => {
    test('generateHmac is deterministic for a fixed key', async () => {
        const key = 'shared-key';
        const a = await generateHmac('message', key);
        const b = await generateHmac('message', key);
        assert.equal(a, b);
        assert.match(a, /^[0-9a-f]{64}$/);
    });

    test('generateHmacKey yields a 64-hex-char key', async () => {
        const key = await generateHmacKey();
        assert.match(key, /^[0-9a-f]{64}$/);
    });
});

describe('Ed25519 signatures', () => {
    test('sign then verify succeeds; tampered data fails', () => {
        const { publicKey, privateKey } = generateSignatureKeyPair();
        const sig = generateSignature('payload', privateKey);
        assert.equal(verifySignature('payload', sig, publicKey), true);
        assert.equal(verifySignature('payload-tampered', sig, publicKey), false);
    });
});

describe('hashToBigNumber', () => {
    test('interprets a hex digest as a BigInt', () => {
        assert.equal(hashToBigNumber('ff'), 255n);
        assert.equal(typeof hashToBigNumber(sha256Hash('x')), 'bigint');
    });
});
