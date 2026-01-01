import { orionVault } from './OrionVault.js';
import { getFutureUnixTime, isUnixExpired } from './Date&Time.js';
import { decryptAESGCM, deriveKey, encryptAESGCM, getChecksum, validateChecksum } from './CryptoModule.js';
import { generateNonce } from './Utils.js';
import { getDeviceFingerprint } from './DevicePrint.js';
import { hexToUint8Array } from './Utils.js';

export class SecureClientCache {
    constructor(cacheKeyPrefix = 'CACHE') {
        this.cacheKeyPrefix = cacheKeyPrefix;
    }

    async encryptAndStoreData(data, namespace, ttlSeconds) {
        const nonceFn = generateNonce();
        const nonce = nonceFn();
        const fingerprint = await getDeviceFingerprint();
        const fingerprintBytes = hexToUint8Array(fingerprint);

        const cachePayload = {
            ...data,
            expiryUnix: getFutureUnixTime(ttlSeconds),
            nonce,
            fingerprint
        };

        const checkSum = getChecksum(cachePayload);
        cachePayload.checkSum = checkSum;

        const derivedKey = await deriveKey(fingerprintBytes, new TextEncoder().encode(nonce), new TextEncoder().encode(namespace));

        const encryptedStr = await encryptAESGCM(JSON.stringify(cachePayload), derivedKey);
        const cacheKey = `${this.cacheKeyPrefix}:*:${namespace}`;
        const cacheValue = `${nonce}:*:${namespace}:*:${encryptedStr}`;

        await orionVault.setItem(cacheKey, cacheValue);
        return true;
    }

    async retrieveAndDecryptData(namespace) {
        const cacheKey = `${this.cacheKeyPrefix}:*:${namespace}`;
        const cachedValue = await orionVault.getItem(cacheKey);

        if (cachedValue === undefined) {
            return { exists: false };
        }

        const fingerprint = await getDeviceFingerprint();
        const fingerprintBytes = hexToUint8Array(fingerprint);
        const split = cachedValue.split(':*:');

        if (split.length !== 3) {
            return { exists: false, reason: 'invalid_format' };
        }

        const [nonce, expectedNamespace, encryptedData] = split;

        if (expectedNamespace !== namespace) {
            return { exists: false, reason: 'namespace_mismatch' };
        }

        const derivedKey = await deriveKey(fingerprintBytes, new TextEncoder().encode(nonce), new TextEncoder().encode(namespace));

        let decryptedStr;
        try {
            decryptedStr = await decryptAESGCM(encryptedData, derivedKey);
        } catch (error) {
            return { exists: false, reason: 'decryption_failed', error: error.message };
        }

        const payload = JSON.parse(decryptedStr);
        const checkSum = payload?.checkSum || 'INVALID';
        delete payload.checkSum;

        // Validate cache integrity
        const validationResult = this.validateCachePayload(payload, checkSum, fingerprint);

        if (!validationResult.valid) {
            return {
                exists: false,
                reason: validationResult.reason,
                payload: validationResult.valid ? payload : null
            };
        }

        return {
            exists: true,
            valid: true,
            payload,
            expiresAt: payload.expiryUnix
        };
    }

    validateCachePayload(payload, expectedChecksum, currentFingerprint) {
        const isExpired = isUnixExpired(payload?.expiryUnix || 1);
        const checksumValid = validateChecksum(payload, expectedChecksum);
        const fingerprintMatch = currentFingerprint === (payload?.fingerprint || '0');

        if (isExpired) {
            return { valid: false, reason: 'expired' };
        }
        if (!checksumValid) {
            return { valid: false, reason: 'checksum_invalid' };
        }
        if (!fingerprintMatch) {
            return { valid: false, reason: 'fingerprint_mismatch' };
        }

        return { valid: true, reason: 'valid' };
    }

    async deleteCachedData(namespace) {
        const cacheKey = `${this.cacheKeyPrefix}:*:${namespace}`;
        await orionVault.deleteItem(cacheKey);
        return true;
    }

    async clearAllCache() {
        await orionVault.reset();
    }

    async cacheData(data, namespace, ttlSeconds, validationCallback = null) {
        await this.encryptAndStoreData(data, namespace, ttlSeconds);

        if (validationCallback) {
            const retrieved = await this.retrieveAndDecryptData(namespace);
            if (!retrieved.exists || !retrieved.valid) {
                throw new Error(`Failed to validate cached data: ${retrieved.reason}`);
            }
            validationCallback(retrieved.payload);
        }

        return true;
    }
}
