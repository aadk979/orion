import { getFutureUnixTime } from "../Date&Time.js";
import crypto from 'crypto';
import { generateId } from "../valueGenerator.js";
import { hashStringSync } from "../CryptoFunctions.js";

const SIGNING_KEY_EXP = "7d";
const VERIFYING_KEY_EXP = "14d";

// FIX: RS384 and RS512 now correctly map to their respective hash algorithms,
// so generateRSAKey uses the right hash instead of always defaulting to SHA-256.
const RSA_JWK_ALG_TO_HASH = {
    "RS256": "SHA-256",
    "RS384": "SHA-384",
    "RS512": "SHA-512"
};

const KEY_PAIR_LENGTH = 16;

class SecretsCrypto {

    constructor(domain) {
        this.domain = domain;
    }

    formatPEM(b64, type) {
        return `-----BEGIN ${type}-----\n` +
            b64.match(/.{1,64}/g).join('\n') +
            `\n-----END ${type}-----\n`;
    }

    async exportECDSAKey(keyPair) {
        const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

        const publicKeySpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
        const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

        const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeySpki)));
        const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyPkcs8)));

        const publicKeyPem = this.formatPEM(publicKeyBase64, "PUBLIC KEY");
        const privateKeyPem = this.formatPEM(privateKeyBase64, "PRIVATE KEY");

        return {
            public: {
                jwk: publicKeyJwk,
                spki: publicKeySpki,
                base64: publicKeyBase64,
                pem: publicKeyPem
            },
            private: {
                jwk: privateKeyJwk,
                pkcs8: privateKeyPkcs8,
                base64: privateKeyBase64,
                pem: privateKeyPem
            }
        };
    }

    async generateECDSAKey(config) {
        const { size } = config;
        const namedCurve = `P-${size}`;

        const keyPair = await crypto.subtle.generateKey(
            { name: "ECDSA", namedCurve },
            true,
            ["sign", "verify"]
        );

        const privateKeyDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
        const nodePrivateKey = crypto.createPrivateKey({
            key: Buffer.from(privateKeyDer),
            format: 'der',
            type: 'pkcs8'
        });

        const publicKeyDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
        const nodePublicKey = crypto.createPublicKey({
            key: Buffer.from(publicKeyDer),
            format: 'der',
            type: 'spki'
        });

        const keyPairId = generateId(`${this.domain}_key_pair`, KEY_PAIR_LENGTH);
        const date = Date.now();
        const exportedKeys = await this.exportECDSAKey(keyPair);

        const hashedKeys = hashStringSync(
            `${exportedKeys.public.base64}${exportedKeys.private.base64}${date}${keyPairId}`,
            "sha256"
        );

        const publicKeyExp = getFutureUnixTime(VERIFYING_KEY_EXP);
        const privateKeyExp = getFutureUnixTime(SIGNING_KEY_EXP);

        return {
            keys: exportedKeys,
            keyPairId,
            keyPairHash: hashedKeys,
            generationDate: date,
            generationConfig: { ...config },
            publicKeyExp,
            privateKeyExp,
            _cryptoKey: keyPair,
            _nodePrivateKey: nodePrivateKey,
            _nodePublicKey: nodePublicKey
        };
    }

    async exportRSAKey(keyPair) {
        const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
        const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

        const publicKeySpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
        const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

        const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeySpki)));
        const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyPkcs8)));

        const publicKeyPem = this.formatPEM(publicKeyBase64, "PUBLIC KEY");
        const privateKeyPem = this.formatPEM(privateKeyBase64, "PRIVATE KEY");

        return {
            public: {
                jwk: publicKeyJwk,
                spki: publicKeySpki,
                base64: publicKeyBase64,
                pem: publicKeyPem
            },
            private: {
                jwk: privateKeyJwk,
                pkcs8: privateKeyPkcs8,
                base64: privateKeyBase64,
                pem: privateKeyPem
            }
        };
    }

    async generateRSAKey(config) {
        const { size, algorithm } = config;

        // FIX: Derive the correct hash from the algorithm field in config (e.g. "RS384" → "SHA-384")
        // rather than always defaulting to SHA-256. KEY_TYPES entries now carry `algorithm` so this works.
        const hash = RSA_JWK_ALG_TO_HASH[algorithm] ?? "SHA-256";

        const keyPair = await crypto.subtle.generateKey(
            { name: "RSASSA-PKCS1-v1_5", modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash },
            true,
            ["sign", "verify"]
        );

        const privateKeyDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
        const nodePrivateKey = crypto.createPrivateKey({
            key: Buffer.from(privateKeyDer),
            format: 'der',
            type: 'pkcs8'
        });

        const publicKeyDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
        const nodePublicKey = crypto.createPublicKey({
            key: Buffer.from(publicKeyDer),
            format: 'der',
            type: 'spki'
        });

        const keyPairId = generateId(`${this.domain}_key_pair`, KEY_PAIR_LENGTH);
        const date = Date.now();
        const exportedKeys = await this.exportRSAKey(keyPair);

        const hashedKeys = hashStringSync(
            `${exportedKeys.public.base64}${exportedKeys.private.base64}${date}${keyPairId}`,
            "sha256"
        );

        const publicKeyExp = getFutureUnixTime(VERIFYING_KEY_EXP);
        const privateKeyExp = getFutureUnixTime(SIGNING_KEY_EXP);

        return {
            keys: exportedKeys,
            keyPairId,
            keyPairHash: hashedKeys,
            generationDate: date,
            generationConfig: { ...config },
            publicKeyExp,
            privateKeyExp,
            _cryptoKey: keyPair,
            _nodePrivateKey: nodePrivateKey,
            _nodePublicKey: nodePublicKey
        };
    }

    async importECDSAPublicKeyFromBase64(base64PublicKey, namedCurve = "P-256") {
        const binaryDer = Uint8Array.from(atob(base64PublicKey), c => c.charCodeAt(0));

        const publicKey = await crypto.subtle.importKey(
            "spki",
            binaryDer,
            { name: "ECDSA", namedCurve },
            true,
            ["verify"]
        );

        const nodePublicKey = crypto.createPublicKey({
            key: Buffer.from(binaryDer),
            format: 'der',
            type: 'spki'
        });

        const jwk = await crypto.subtle.exportKey("jwk", publicKey);
        const spki = await crypto.subtle.exportKey("spki", publicKey);
        const pem = this.formatPEM(base64PublicKey, "PUBLIC KEY");

        return { jwk, spki, base64: base64PublicKey, pem, _cryptoKey: publicKey, _nodePublicKey: nodePublicKey };
    }

    async importRSAPublicKeyFromBase64(base64PublicKey, hash = "SHA-256") {
        const binaryDer = Uint8Array.from(atob(base64PublicKey), c => c.charCodeAt(0));

        const publicKey = await crypto.subtle.importKey(
            "spki",
            binaryDer,
            { name: "RSASSA-PKCS1-v1_5", hash },
            true,
            ["verify"]
        );

        const nodePublicKey = crypto.createPublicKey({
            key: Buffer.from(binaryDer),
            format: 'der',
            type: 'spki'
        });

        const jwk = await crypto.subtle.exportKey("jwk", publicKey);
        const spki = await crypto.subtle.exportKey("spki", publicKey);
        const pem = this.formatPEM(base64PublicKey, "PUBLIC KEY");

        return { jwk, spki, base64: base64PublicKey, pem, _cryptoKey: publicKey, _nodePublicKey: nodePublicKey };
    }

    async importECDSAPublicKeyFromJWK(jwk) {
        const publicKey = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "ECDSA", namedCurve: jwk.crv },
            true,
            ["verify"]
        );

        const spki = await crypto.subtle.exportKey("spki", publicKey);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
        const pem = this.formatPEM(base64, "PUBLIC KEY");

        const nodePublicKey = crypto.createPublicKey({
            key: Buffer.from(spki),
            format: 'der',
            type: 'spki'
        });

        return { jwk, spki, base64, pem, _cryptoKey: publicKey, _nodePublicKey: nodePublicKey };
    }

    async importRSAPublicKeyFromJWK(jwk) {
        const hash = RSA_JWK_ALG_TO_HASH[jwk.alg] ?? "SHA-256";

        const publicKey = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "RSASSA-PKCS1-v1_5", hash },
            true,
            ["verify"]
        );

        const spki = await crypto.subtle.exportKey("spki", publicKey);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
        const pem = this.formatPEM(base64, "PUBLIC KEY");

        const nodePublicKey = crypto.createPublicKey({
            key: Buffer.from(spki),
            format: 'der',
            type: 'spki'
        });

        return { jwk, spki, base64, pem, _cryptoKey: publicKey, _nodePublicKey: nodePublicKey };
    }

    async importECDSAPrivateKeyFromBase64(base64PrivateKey, namedCurve = "P-256") {
        const binaryDer = Uint8Array.from(atob(base64PrivateKey), c => c.charCodeAt(0));

        const privateKey = await crypto.subtle.importKey(
            "pkcs8",
            binaryDer,
            { name: "ECDSA", namedCurve },
            true,
            ["sign"]
        );

        const nodePrivateKey = crypto.createPrivateKey({
            key: Buffer.from(binaryDer),
            format: 'der',
            type: 'pkcs8'
        });

        const jwk = await crypto.subtle.exportKey("jwk", privateKey);
        const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
        const pem = this.formatPEM(base64PrivateKey, "PRIVATE KEY");

        return { jwk, pkcs8, base64: base64PrivateKey, pem, _cryptoKey: privateKey, _nodePrivateKey: nodePrivateKey };
    }

    async importRSAPrivateKeyFromBase64(base64PrivateKey, hash = "SHA-256") {
        const binaryDer = Uint8Array.from(atob(base64PrivateKey), c => c.charCodeAt(0));

        const privateKey = await crypto.subtle.importKey(
            "pkcs8",
            binaryDer,
            { name: "RSASSA-PKCS1-v1_5", hash },
            true,
            ["sign"]
        );

        const nodePrivateKey = crypto.createPrivateKey({
            key: Buffer.from(binaryDer),
            format: 'der',
            type: 'pkcs8'
        });

        const jwk = await crypto.subtle.exportKey("jwk", privateKey);
        const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
        const pem = this.formatPEM(base64PrivateKey, "PRIVATE KEY");

        return { jwk, pkcs8, base64: base64PrivateKey, pem, _cryptoKey: privateKey, _nodePrivateKey: nodePrivateKey };
    }

    async importECDSAPrivateKeyFromJWK(jwk) {
        const privateKey = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "ECDSA", namedCurve: jwk.crv },
            true,
            ["sign"]
        );

        const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
        const pem = this.formatPEM(base64, "PRIVATE KEY");

        const nodePrivateKey = crypto.createPrivateKey({
            key: Buffer.from(pkcs8),
            format: 'der',
            type: 'pkcs8'
        });

        return { jwk, pkcs8, base64, pem, _cryptoKey: privateKey, _nodePrivateKey: nodePrivateKey };
    }

    async importRSAPrivateKeyFromJWK(jwk) {
        const hash = RSA_JWK_ALG_TO_HASH[jwk.alg] ?? "SHA-256";

        const privateKey = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "RSASSA-PKCS1-v1_5", hash },
            true,
            ["sign"]
        );

        const pkcs8 = await crypto.subtle.exportKey("pkcs8", privateKey);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
        const pem = this.formatPEM(base64, "PRIVATE KEY");

        const nodePrivateKey = crypto.createPrivateKey({
            key: Buffer.from(pkcs8),
            format: 'der',
            type: 'pkcs8'
        });

        return { jwk, pkcs8, base64, pem, _cryptoKey: privateKey, _nodePrivateKey: nodePrivateKey };
    }
}

export { SecretsCrypto };