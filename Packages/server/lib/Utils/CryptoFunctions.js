// This file contains crypto fucntions for internal use

const bcrypt = require('bcrypt');
const crypto = require("crypto");

const alphabetMap = {
  A: 168,
  B: 893,
  C: 159,
  D: 395,
  E: 165,
  F: 996,
  G: 973,
  H: 266,
  I: 223,
  J: 596,
  K: 731,
  L: 649,
  M: 654,
  N: 198,
  O: 138,
  P: 424,
  Q: 265,
  R: 468,
  S: 759,
  T: 431,
  U: 148,
  V: 567,
  W: 302,
  X: 792,
  Y: 894,
  Z: 968,
  a: 577,
  b: 536,
  c: 432,
  d: 114,
  e: 981,
  f: 340,
  g: 150,
  h: 889,
  i: 560,
  j: 922,
  k: 690,
  l: 425,
  m: 970,
  n: 144,
  o: 630,
  p: 327,
  q: 334,
  r: 295,
  s: 936,
  t: 193,
  u: 822,
  v: 890,
  w: 902,
  x: 495,
  y: 986,
  z: 479,
};

function getCheckSumFromHash(hash) {
  let array = hash.split("");

  array = array.map((val) => {
    if (!/^[a-zA-Z0-9]$/.test(val)) {
      return 2;
    }

    if (isNaN(Number(val))) {
      const number = alphabetMap[val];
      return number;
    }

    return val;
  });

  const chunkSize = Math.ceil(array.length / 4);

  const chunk1 = array.slice(0, chunkSize);
  const chunk2 = array.slice(chunkSize, chunkSize * 2);
  const chunk3 = array.slice(chunkSize * 2, chunkSize * 3);
  const chunk4 = array.slice(chunkSize * 3, chunkSize * 4);

  const nums1 = chunk1.map(Number);
  const nums2 = chunk2.map(Number);
  const nums3 = chunk3.map(Number);
  const nums4 = chunk4.map(Number);

  // 1. Sum all values in chunk1
  const val1 = nums1.reduce((acc, val) => acc + val, 0);

  // 2. Subtract each value from the accumulator in chunk2
  const val2 = nums2.reduce((acc, val) => acc - val);

  // 3. Reduce chunk3 safely: (acc - 1) / val
  const val3 = nums3.reduce((acc, val) => (val !== 0 ? (acc - 1) / val : acc));

  // 4. Reduce chunk4 with alternating operation
  const val4 = nums4.reduce((acc, val, index) => {
    if (val === 0) val = 1; // prevent division by zero
    return index % 2 === 0 ? (acc + 1) / val : (acc + 1) * val;
  });

  const fVal1 = val3 / val1 - val1 / val3;
  const fVal2 = val2 / val4 + val4 / val2;

  console.log(fVal1 * fVal2);

  return fVal1 * fVal2;
}

const SALT_ROUNDS = 10;

async function hashString(input) {
    if (typeof input !== 'string' || input.trim() === '') {
        throw new Error("Invalid input to hash: must be a non-empty string");
    }

    return await new Promise((resolve, reject) => {
        bcrypt.hash(input, SALT_ROUNDS, (err, hashed) => {
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

// AES-256-GCM Encryption
function encryptAESGCM(plaintext, keyBuffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  // Combine: iv + ciphertext + authTag
  const result = Buffer.concat([iv, encrypted, authTag]);
  return result.toString("base64");
}

function decryptAESGCM(base64Data, keyBuffer) {
  const data = Buffer.from(base64Data, "base64");

  const iv = data.subarray(0, 12);
  const ciphertext = data.subarray(12, data.length - 16);
  const authTag = data.subarray(data.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function importKeyFromBase64(base64Key) {
  return Buffer.from(base64Key, "base64"); // Convert browser-exported key
}

function exportKeyBase64(keyBuffer) {
  // Accepts a 32-byte Buffer and returns a Base64 string
  return keyBuffer.toString("base64");
}

function generateEncryptionKey() {
  return crypto.randomBytes(64); // 256-bit key (32 bytes)
}

async function generateHmac(data, key) {
  const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(data);
  return hmac.digest('hex');
}

function generateHmacKey() {
    return new Promise((resolve) => {
        const key = crypto.randomBytes(32).toString("hex");
        resolve(key);
    });
}

module.exports = { generateHmacKey , generateHmac , hashString, verifyHash, generateKeyPair, publicEncrypt,exportKeyBase64, importKeyFromBase64, privateDecrypt , encrypt: encryptAESGCM , decrypt: decryptAESGCM , generateEncryptionKey , getCheckSumFromHash };