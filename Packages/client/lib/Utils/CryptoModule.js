// ----------------- Encryption -----------------
async function encryptPublic(message, publicKeyPem) {
    try {
        const encoder = new TextEncoder();
        const encodedMessage = encoder.encode(message);

        const importedKey = await importPublicKey(publicKeyPem);

        if (!importedKey.usages.includes('encrypt')) {
            throw new Error('The key cannot be used for encryption');
        }

        const encryptedBuffer = await window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, importedKey, encodedMessage);

        return btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer)));
    } catch (e) {
        return { error: true, context: e.message };
    }
}

async function generateKeyPair(size) {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: size, // secure size
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256'
        },
        true, // keys are extractable
        ['encrypt', 'decrypt']
    );
    return keyPair;
}

// ----------------- Decryption -----------------
async function decryptPrivate(encryptedBase64, privateKey) {
    try {
        const encryptedBytes = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
        const decryptedBuffer = await window.crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, encryptedBytes);
        const decoder = new TextDecoder();
        return decoder.decode(decryptedBuffer);
    } catch (e) {
        return { error: true, context: e.message };
    }
}

// ----------------- Import Keys -----------------
async function importPublicKey(pem) {
    const pemContent = pem
        .replace(/-----BEGIN PUBLIC KEY-----/, '')
        .replace(/-----END PUBLIC KEY-----/, '')
        .replace(/\r?\n/g, '');
    const binaryDer = Uint8Array.from(atob(pemContent), char => char.charCodeAt(0));
    return await window.crypto.subtle.importKey('spki', binaryDer.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['encrypt']);
}

async function importPrivateKey(pem) {
    const pemContent = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\r?\n/g, '');
    const binaryDer = Uint8Array.from(atob(pemContent), char => char.charCodeAt(0));
    return await window.crypto.subtle.importKey('pkcs8', binaryDer.buffer, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
}

// ----------------- Export Public Key -----------------
async function exportPublicKey(publicKey) {
    const spki = await window.crypto.subtle.exportKey('spki', publicKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
    const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    return pem;
}

async function generateKeyPairECC(size = 'P-256') {
    return crypto.subtle.generateKey(
        {
            name: 'ECDH',
            namedCurve: size
        },
        true,
        ['deriveKey', 'deriveBits']
    );
}

// Export public key for sending
async function exportPublicKeyECC(key) {
    const raw = await crypto.subtle.exportKey('raw', key);
    return new Uint8Array(raw);
}

// Import peer public key
async function importPublicKeyECC(rawKey, size = 'P-256') {
    return crypto.subtle.importKey('raw', rawKey, { name: 'ECDH', namedCurve: size }, true, []);
}

// Derive shared secret
async function deriveSharedSecret(privateKey, peerPublicKey) {
    const sharedSecret = await crypto.subtle.deriveBits(
        {
            name: 'ECDH',
            public: peerPublicKey
        },
        privateKey,
        256
    );
    return new Uint8Array(sharedSecret);
}

// HKDF to derive symmetric key
async function deriveKey(sharedSecret, salt = new Uint8Array(16), info = new Uint8Array(0)) {
    // Import the shared secret as raw key material
    const keyMaterial = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);

    // Derive an AES-GCM key
    const derivedKey = await crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: salt,
            info: info
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true, // extractable so we can export it
        ['encrypt', 'decrypt']
    );

    // Export the key as raw bytes
    const rawKey = await crypto.subtle.exportKey('raw', derivedKey);
    return new Uint8Array(rawKey); // now this is a usable byte array
}

async function generateHmac(data, key) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);

    const cryptoKey = await window.crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: { name: 'SHA-256' } }, false, ['sign']);

    const dataBuffer = encoder.encode(data);
    const signatureBuffer = await window.crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);

    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// AES-256-GCM Encryption in the browser
async function encryptAESGCM(plaintext, rawKey) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV

    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));

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

    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertextWithTag);

    return new TextDecoder().decode(decrypted);
}

async function generateAES256Key() {
    const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawKey = await crypto.subtle.exportKey('raw', cryptoKey); // ArrayBuffer
    return new Uint8Array(rawKey); // 32 bytes
}

function exportKeyBase64(rawKey) {
    return btoa(String.fromCharCode(...rawKey)); // for sending to server
}

function importKeyFromBase64(base64Key) {
    const binary = atob(base64Key);
    return Uint8Array.from(binary, c => c.charCodeAt(0)); // Uint8Array to feed into importKey
}

// 1. Stable stringify: deterministic serialization
function stableStringify(obj) {
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
    if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

// 2. Convert ArrayBuffer to hex
function bufferToHex(buffer) {
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// 3. Generate checksum (async)
async function getChecksum(obj) {
    const str = stableStringify(obj);
    const encoded = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    return bufferToHex(hashBuffer);
}

// 4. Validate checksum (async)
async function validateChecksum(obj, checksum) {
    const objHash = await getChecksum(obj);
    return objHash === checksum;
}

async function getSupportedEncryptionAlgs() {
    const supported = [];

    if (!window.crypto || !window.crypto.subtle) {
        return supported;
    }

    const subtle = window.crypto.subtle;

    try {
        await subtle.generateKey(
            {
                name: 'ECDH',
                namedCurve: 'P-256'
            },
            true,
            ['deriveKey', 'deriveBits']
        );
        supported.push('ECC_256');
    } catch (_) {}

    try {
        await subtle.generateKey(
            {
                name: 'ECDH',
                namedCurve: 'P-384'
            },
            true,
            ['deriveKey', 'deriveBits']
        );
        supported.push('ECC_384');
    } catch (_) {}

    try {
        await subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );
        supported.push('RSA_2048');
    } catch (_) {}

    try {
        await subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 3072,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );
        supported.push('RSA_3072');
    } catch (_) {}

    try {
        await subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 4096,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );
        supported.push('RSA_4096');
    } catch (_) {}

    return supported;
}

export {
    generateHmac,
    encryptPublic,
    encryptAESGCM,
    decryptAESGCM,
    generateAES256Key,
    exportKeyBase64,
    importKeyFromBase64,
    getSupportedEncryptionAlgs,
    getChecksum,
    validateChecksum,
    deriveKey,
    generateKeyPairECC,
    exportPublicKeyECC,
    importPublicKeyECC,
    deriveSharedSecret,
    decryptPrivate,
    importPrivateKey,
    exportPublicKey,
    generateKeyPair
};
