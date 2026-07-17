/**
 * Auth primitives for the system-admin plane — Node crypto only, no native
 * dependencies.
 *
 * Passwords (root admin only): scrypt with per-hash random salt, stored as
 * `scrypt$N$r$p$salt$key` (base64url). Tokens (magic links, sessions): 32
 * random bytes; the RAW value goes to the user exactly once, only its SHA-256
 * is stored — a database leak reveals no usable credential.
 */

import crypto from 'crypto';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

const hashPassword = (password) => new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
        if (err) return reject(err);
        resolve(`scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`);
    });
});

const verifyPassword = (password, stored) => new Promise((resolve) => {
    try {
        const [scheme, n, r, p, saltB64, keyB64] = String(stored || '').split('$');
        if (scheme !== 'scrypt') return resolve(false);

        const salt = Buffer.from(saltB64, 'base64url');
        const expected = Buffer.from(keyB64, 'base64url');

        crypto.scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) }, (err, key) => {
            if (err) return resolve(false);
            resolve(key.length === expected.length && crypto.timingSafeEqual(key, expected));
        });
    } catch (_) {
        resolve(false);
    }
});

/** New random credential: hand `raw` to the user, persist only `hash`. */
const generateToken = (prefix = 'TOK') => {
    const raw = `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
    return { raw, hash: hashToken(raw) };
};

const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

export { hashPassword, verifyPassword, generateToken, hashToken };
