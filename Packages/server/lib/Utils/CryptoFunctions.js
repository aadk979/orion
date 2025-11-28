/**
 * Cryptographic Functions Module
 *
 * Contains cryptographic functions for internal use within the Orion system.
 * Provides hashing, verification, and encryption utilities.
 */

import bcrypt from "bcrypt";
import crypto from "crypto";

function hashToBigNumber(hash) {
  return BigInt("0x" + hash); // precise, no collisions
}

const SALT_ROUNDS = 10;

async function hashString(input) {
  if (typeof input !== "string" || input.trim() === "") {
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

function sha512Hash(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("Invalid input to hash: must be a non-empty string");
  }

  return crypto.createHash("sha512").update(input).digest("hex");
}

function sha256Hash(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("Invalid input to hash: must be a non-empty string");
  }

  return crypto.createHash("sha256").update(input).digest("hex");
}

async function generateKeyPair(keySize = 2048) {
  return await new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      "rsa",
      {
        modulusLength: keySize,
        publicKeyEncoding: {
          type: "spki",
          format: "pem",
        },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "pem",
        },
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
      const encrypted = crypto
        .publicEncrypt(publicKey, Buffer.from(message))
        .toString("base64");
      resolve(encrypted);
    } catch (err) {
      reject(err);
    }
  });
}

async function privateDecrypt(privateKey, encryptedBase64) {
  return await new Promise((resolve, reject) => {
    try {
      const decrypted = crypto
        .privateDecrypt(privateKey, Buffer.from(encryptedBase64, "base64"))
        .toString("utf8");
      resolve(decrypted);
    } catch (err) {
      reject(err);
    }
  });
}

// AES-256-GCM Encryption
function encrypt(plaintext, keyBuffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuffer, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Combine: iv + ciphertext + authTag
  const result = Buffer.concat([iv, encrypted, authTag]);
  return result.toString("base64");
}

function decrypt(base64Data, keyBuffer) {
  const data = Buffer.from(base64Data, "base64");

  const iv = data.subarray(0, 12);
  const ciphertext = data.subarray(12, data.length - 16);
  const authTag = data.subarray(data.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuffer, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
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
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(data);
  return hmac.digest("hex");
}

function generateHmacKey() {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(32).toString("hex");
    resolve(key);
  });
}

function generateSignatureKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  const pubJwk = publicKey.export({ format: "jwk" });
  const privJwk = privateKey.export({ format: "jwk" });

  return {
    publicKey: pubJwk,
    privateKey: privJwk,
  };
}

function generateSignature(data, privateJwk) {
  const message = Buffer.from(data);

  // Convert JWK → KeyObject
  const privateKey = crypto.createPrivateKey({
    key: privateJwk,
    format: "jwk",
  });

  const signature = crypto.sign(null, message, privateKey);
  return signature.toString("base64"); // Optional: safe return
}

function verifySignature(data, signature, publicJwk) {
  const message = Buffer.from(data);

  // Convert JWK → KeyObject
  const publicKey = crypto.createPublicKey({
    key: publicJwk,
    format: "jwk",
  });

  return crypto.verify(
    null,
    message,
    publicKey,
    Buffer.from(signature, "base64")
  );
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
  generateSignatureKeyPair,
  generateSignature,
  verifySignature,
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
};
