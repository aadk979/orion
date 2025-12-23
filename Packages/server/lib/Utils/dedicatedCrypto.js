/**
 * Client-to-Server Encryption Module
 * 
 * Contains cryptographic functions specifically designed for secure
 * client-to-server communication and data encryption.
 */

import crypto from 'crypto';

async function generateKeyPairECC(size = "P-256") {
  return crypto.webcrypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: size,
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

async function exportPublicKeyECC(key) {
  const raw = await crypto.webcrypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

async function importPublicKeyECC(rawKey, size = "P-256") {
  return crypto.webcrypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'ECDH', namedCurve: size },
    true,
    []
  );
}

async function deriveSharedSecret(privateKey, peerPublicKey) {
  const sharedSecret = await crypto.webcrypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    privateKey,
    256
  );
  return new Uint8Array(sharedSecret);
}

async function deriveKey(sharedSecret, salt = new Uint8Array(16), info = new Uint8Array(0)) {
  const keyMaterial = await crypto.webcrypto.subtle.importKey(
    'raw',
    sharedSecret,
    'HKDF',
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.webcrypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const rawKey = await crypto.webcrypto.subtle.exportKey('raw', derivedKey);
  return new Uint8Array(rawKey);
}

async function generateKeyPairDedicated(length) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: length || 4096,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    return { publicKey , privateKey };
}

async function encryptPublic(data, publicKey) {
    try {
        const encryptedData = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_OAEP_PADDING,
                oaepHash: "sha256",
            },
            Buffer.from(data, "utf-8")
        );

        return encryptedData.toString("base64");
    } catch (e) {
        return { error: true, context: e.message };
    }
}

async function decryptPrivate(encryptedData , privateKey) {
    try{
        const decryptedData = crypto.privateDecrypt(
            {
              key: privateKey,
              padding: crypto.constants.RSA_OAEP_PADDING,
              oaepHash: "sha256",
            },
            Buffer.from(encryptedData, "base64")
        );

        return decryptedData.toString();
    }
    catch(e){
        return { error: true , context: e.message }
    }
}

export {
  generateKeyPairDedicated ,
  encryptPublic ,
  decryptPrivate,
  generateKeyPairECC,
  exportPublicKeyECC,
  importPublicKeyECC,
  deriveKey,
  deriveSharedSecret
}