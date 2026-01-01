/**
 * Cryptographic Functions Module
 *
 * Contains cryptographic functions for internal use within the Orion system.
 * Provides hashing, verification, and encryption utilities.
 */

import bcrypt from 'bcrypt';
import crypto from 'crypto';

function hashToBigNumber(hash) {
    return BigInt('0x' + hash); // precise, no collisions
}

const SALT_ROUNDS = 12;

function sha512Hash(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        throw new Error('Invalid input to hash: must be a non-empty string');
    }

    return crypto.createHash('sha512').update(input).digest('hex');
}

function sha256Hash(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        throw new Error('Invalid input to hash: must be a non-empty string');
    }

    return crypto.createHash('sha256').update(input).digest('hex');
}

function blake2bHash(input) {
    if (typeof input !== 'string' || input.trim() === '') throw new Error('Invalid input');
    return crypto.createHash('blake2b512').update(input).digest('hex');
}

function blake2sHash(input) {
    if (typeof input !== 'string' || input.trim() === '') throw new Error('Invalid input');
    return crypto.createHash('blake2s256').update(input).digest('hex');
}

function pbkdf2Hash(password, salt = crypto.randomBytes(16).toString('hex')) {
    const iterations = 100000;
    const keylen = 64;
    const digest = 'sha512';
    return crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
}

function scryptHash(password, salt = crypto.randomBytes(16).toString('hex')) {
    const keylen = 64;
    return crypto.scryptSync(password, salt, keylen).toString('hex');
}

async function hashString(input) {
    return await new Promise((resolve, reject) => {
        bcrypt.hash(input.normalize(), SALT_ROUNDS, (err, hashed) => {
            if (err) reject(err);
            else resolve(hashed);
        });
    });
}

async function verifyHash(input, hashed) {
    return await new Promise((resolve, reject) => {
        bcrypt.compare(input, hashed, (err, result) => {
            if (err) reject(err);
            resolve(result);
        });
    });
}

function hashStringSync(input, alg = 'sha256') {
    if (typeof input !== 'string' || input.trim() === '') {
        throw new Error('Invalid input');
    }

    const salt = crypto.randomBytes(16).toString('hex');

    let hash;
    switch (alg) {
        case 'sha256':
            hash = sha256Hash(input + salt);
            break;
        case 'sha512':
            hash = sha512Hash(input + salt);
            break;
        case 'blake2b':
            hash = blake2bHash(input + salt);
            break;
        case 'blake2s':
            hash = blake2sHash(input + salt);
            break;
        case 'pbkdf2':
            hash = pbkdf2Hash(input, salt);
            break;
        case 'scrypt':
            hash = scryptHash(input, salt);
            break;
        default:
            throw new Error('Unsupported algorithm');
    }

    return `${hash}:*:${salt}`;
}

function verifyHashSync(input, hashed, alg = 'sha256') {
    if (typeof input !== 'string' || input.trim() === '') {
        throw new Error('Invalid input');
    }

    const [hash, salt] = hashed.split(':*:');
    if (!hash || !salt) throw new Error('Invalid hash format');

    let computedHash;
    switch (alg) {
        case 'sha256':
            computedHash = sha256Hash(input + salt);
            break;
        case 'sha512':
            computedHash = sha512Hash(input + salt);
            break;
        case 'blake2b':
            computedHash = blake2bHash(input + salt);
            break;
        case 'blake2s':
            computedHash = blake2sHash(input + salt);
            break;
        case 'pbkdf2':
            computedHash = pbkdf2Hash(input, salt);
            break;
        case 'scrypt':
            computedHash = scryptHash(input, salt);
            break;
        default:
            throw new Error('Unsupported algorithm');
    }

    return hash === computedHash;
}

async function generateKeyPair(keySize = 2048) {
    return await new Promise((resolve, reject) => {
        crypto.generateKeyPair(
            'rsa',
            {
                modulusLength: keySize,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem'
                }
            },
            (err, publicKey, privateKey) => {
                if (err) reject(err);
                resolve({ publicKey, privateKey });
            }
        );
    });
}

async function publicEncrypt(publicKey, message) {
    return await new Promise((resolve, reject) => {
        try {
            const encrypted = crypto.publicEncrypt(publicKey, Buffer.from(message)).toString('base64');
            resolve(encrypted);
        } catch (err) {
            reject(err);
        }
    });
}

async function privateDecrypt(privateKey, encryptedBase64) {
    return await new Promise((resolve, reject) => {
        try {
            const decrypted = crypto.privateDecrypt(privateKey, Buffer.from(encryptedBase64, 'base64')).toString('utf8');
            resolve(decrypted);
        } catch (err) {
            reject(err);
        }
    });
}

// AES-256-GCM Encryption
function encrypt(plaintext, keyBuffer) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    const authTag = cipher.getAuthTag();

    // Combine: iv + ciphertext + authTag
    const result = Buffer.concat([iv, encrypted, authTag]);
    return result.toString('base64');
}

function decrypt(base64Data, keyBuffer) {
    const data = Buffer.from(base64Data, 'base64');

    const iv = data.subarray(0, 12);
    const ciphertext = data.subarray(12, data.length - 16);
    const authTag = data.subarray(data.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return decrypted.toString('utf8');
}

function importKeyFromBase64(base64Key) {
    return Buffer.from(base64Key, 'base64'); // Convert browser-exported key
}

function exportKeyBase64(keyBuffer) {
    // Accepts a 32-byte Buffer and returns a Base64 string
    return keyBuffer.toString('base64');
}

function generateEncryptionKey() {
    return crypto.randomBytes(32);
}

async function generateHmac(data, key) {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(data);
    return hmac.digest('hex');
}

function generateHmacKey() {
    return new Promise(resolve => {
        const key = crypto.randomBytes(32).toString('hex');
        resolve(key);
    });
}

function generateSignatureKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

    const pubJwk = publicKey.export({ format: 'jwk' });
    const privJwk = privateKey.export({ format: 'jwk' });

    return {
        publicKey: pubJwk,
        privateKey: privJwk
    };
}

function generateSignature(data, privateJwk) {
    const message = Buffer.from(data);

    // Convert JWK → KeyObject
    const privateKey = crypto.createPrivateKey({
        key: privateJwk,
        format: 'jwk'
    });

    const signature = crypto.sign(null, message, privateKey);
    return signature.toString('base64'); // Optional: safe return
}

function verifySignature(data, signature, publicJwk) {
    const message = Buffer.from(data);

    // Convert JWK → KeyObject
    const publicKey = crypto.createPublicKey({
        key: publicJwk,
        format: 'jwk'
    });

    return crypto.verify(null, message, publicKey, Buffer.from(signature, 'base64'));
}

const packageExports = {
    generateHmacKey,
    generateHmac,
    hashString,
    verifyHash,
    generateKeyPair,
    publicEncrypt,
    exportKeyBase64,
    importKeyFromBase64,
    privateDecrypt,
    encrypt,
    decrypt,
    generateEncryptionKey,
    hashToBigNumber,
    sha512Hash,
    sha256Hash,
    blake2bHash,
    blake2sHash,
    pbkdf2Hash,
    scryptHash,
    hashStringSync,
    verifyHashSync,
    generateSignatureKeyPair,
    generateSignature,
    verifySignature
};

export {
    packageExports,
    generateHmacKey,
    generateHmac,
    hashString,
    verifyHash,
    generateKeyPair,
    publicEncrypt,
    exportKeyBase64,
    importKeyFromBase64,
    privateDecrypt,
    encrypt,
    decrypt,
    generateEncryptionKey,
    hashToBigNumber,
    sha512Hash,
    sha256Hash,
    generateSignatureKeyPair,
    generateSignature,
    verifySignature,
    blake2bHash,
    blake2sHash,
    pbkdf2Hash,
    scryptHash,
    hashStringSync,
    verifyHashSync
};
