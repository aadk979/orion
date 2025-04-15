const bcrypt = require('bcrypt');
const crypto = require('crypto');

const SALT_ROUNDS = 10;

async function hashString(input) {
    return await new Promise((resolve, reject) => {
        bcrypt.hash(input, SALT_ROUNDS, (err, hashed) => {
            if (err) reject(err);
            resolve(hashed);
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

async function generateKeyPair(keySize = 2048) {
    return await new Promise((resolve, reject) => {
        crypto.generateKeyPair('rsa', {
            modulusLength: keySize,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        }, (err, publicKey, privateKey) => {
            if (err) reject(err);
            resolve({ publicKey, privateKey });
        });
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

const AES_ALGO = 'aes-256-cbc';
const IV_LENGTH = 16;

async function encrypt(plainText, hexKey) {
    return await new Promise((resolve, reject) => {
        try {
            const key = Buffer.from(hexKey, 'hex');
            if (key.length !== 32) throw new Error('Key must be 32 bytes (256 bits).');
            const iv = crypto.randomBytes(IV_LENGTH);
            const cipher = crypto.createCipheriv(AES_ALGO, key, iv);
            const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
            const combined = Buffer.concat([iv, encrypted]);
            resolve(combined.toString('base64'));
        } catch (err) {
            reject(err);
        }
    });
}

async function decrypt(encryptedBase64, hexKey) {
    return await new Promise((resolve, reject) => {
        try {
            const key = Buffer.from(hexKey, 'hex');
            if (key.length !== 32) throw new Error('Key must be 32 bytes (256 bits).');
            const data = Buffer.from(encryptedBase64, 'base64');
            const iv = data.subarray(0, IV_LENGTH);
            const encrypted = data.subarray(IV_LENGTH);
            const decipher = crypto.createDecipheriv(AES_ALGO, key, iv);
            const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
            resolve(decrypted.toString('utf8'));
        } catch (err) {
            reject(err);
        }
    });
}

async function generateEncryptionKey() {
    return await new Promise((resolve) => {
        const key = crypto.randomBytes(32).toString("hex");
        resolve(key);
    });
}

module.exports = { hashString, verifyHash, generateKeyPair, publicEncrypt, privateDecrypt , encrypt , decrypt , generateEncryptionKey };