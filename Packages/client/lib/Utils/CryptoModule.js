async function encryptPublic(message, publicKey) {
    try {
        const encoder = new TextEncoder();
        const encodedMessage = encoder.encode(message);

        const importedKey = await importPublicKey(publicKey);

        if (!importedKey.usages.includes("encrypt")) {
            throw new Error("The key cannot be used for encryption");
        }

        const encryptedBuffer = await window.crypto.subtle.encrypt(
            { name: "RSA-OAEP" },
            importedKey,
            encodedMessage
        );

        return btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
    } catch (e) {
        return { error: true, context: e.message };
    }
}

async function importPublicKey(pem) {
    const pemContent = pem
        .replace(/-----BEGIN PUBLIC KEY-----/, "")
        .replace(/-----END PUBLIC KEY-----/, "")
        .replace(/\r?\n/g, "");

    const binaryDer = Uint8Array.from(atob(pemContent), (char) => char.charCodeAt(0));

    return await window.crypto.subtle.importKey(
        "spki",
        binaryDer.buffer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        true,
        ["encrypt"]
    );
}

async function generateHmac(data, key) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign']
  );

  const dataBuffer = encoder.encode(data);
  const signatureBuffer = await window.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    dataBuffer
  );

  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  return signatureArray
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// AES-256-GCM Encryption in the browser
async function encryptAESGCM(plaintext, rawKey) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV

  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt"]);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );

  const encryptedBytes = new Uint8Array(encrypted); // includes ciphertext + authTag
  const combined = new Uint8Array(iv.length + encryptedBytes.length);
  combined.set(iv, 0);
  combined.set(encryptedBytes, iv.length); // IV + ciphertext+authTag

  return btoa(String.fromCharCode(...combined)); // base64 encoded string
}

async function decryptAESGCM(base64Data, rawKey) {
  const binary = atob(base64Data);
  const combined = Uint8Array.from(binary, c => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const ciphertextWithTag = combined.slice(12);

  const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertextWithTag
  );

  return new TextDecoder().decode(decrypted);
}

async function generateAES256Key() {
  const cryptoKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const rawKey = await crypto.subtle.exportKey("raw", cryptoKey); // ArrayBuffer
  return new Uint8Array(rawKey); // 32 bytes
}

function exportKeyBase64(rawKey) {
  return btoa(String.fromCharCode(...rawKey)); // for sending to server
}

function importKeyFromBase64(base64Key) {
  const binary = atob(base64Key);
  return Uint8Array.from(binary, c => c.charCodeAt(0)); // Uint8Array to feed into importKey
}

export { generateHmac , encryptPublic , encryptAESGCM , decryptAESGCM , generateAES256Key , exportKeyBase64 , importKeyFromBase64 }