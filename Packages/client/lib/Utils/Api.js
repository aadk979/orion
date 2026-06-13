import { renderDeviceAuthorizationUI } from '../Flows/DeviceAuthorizationFlow.js';
import { renderStepUpAuthUI } from '../Flows/StepUpAuthFlow.js';
import {
    deriveKey,
    deriveSharedSecret,
    encryptAESGCM,
    encryptPublic,
    exportKeyBase64,
    exportPublicKeyECC,
    generateAES256Key,
    generateHmac,
    generateKeyPairECC,
    getSupportedEncryptionAlgs,
    importPublicKeyECC
} from './CryptoModule.js';
import { getCurrentUnixTime } from './Date&Time.js';
import { getDeviceFingerprint } from './DevicePrint.js';
import { base64DecodeToUint8, base64EncodeUint8 } from './Encoders.js';
import { orionVault } from './OrionVault.js';
import { generateNonce } from './Utils.js';

const ORION_FLOW_TYPES = {
    'FLOW-DEVICE-AUTHORIZATION': { fn: renderDeviceAuthorizationUI, params: ['baseUrl', 'nameSpace', 'slug'] },
    'FLOW-STEP-UP-AUTH': { fn: renderStepUpAuthUI, params: ['baseUrl', 'nameSpace', 'slug'] }
};

class ApiInterface {
    constructor(baseUrl, nameSpace, slug) {
        this.baseUrl = baseUrl;
        this.nameSpace = nameSpace;
        this.slug = slug;
    }

    async fetch(endpoint, method, authorization, body = {}, dip, encryption) {
        const url = `${this.baseUrl}${this.slug !== '' ? '/' + this.slug : ''}${endpoint}`;

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
                'orion-fingerprint': await getDeviceFingerprint(),
                'orion-user-agent': navigator.userAgent,
                'orion-dip-state': dip?.disabled ? 'NONE' : dip ? dip?.dipState : 'NO DATA',
                'orion-dip-id': dip?.disabled ? 'DEFAULT NONE' : dip ? dip?.dipId : 'DEFAULT NONE',
                'orion-dip-signature': dip?.disabled ? 'DEFAULT NONE' : dip ? dip?.dipSignature : 'DEFAULT NONE',
                'orion-dip-salt': dip?.disabled ? 'DEFAULT NONE' : dip ? dip?.salt : 'DEFAULT NONE',
                'orion-dip-timestamp': dip?.disabled ? 'DEFAULT NONE' : dip ? dip?.timestamp : 'DEFAULT NONE',
                'orion-encryption-status': encryption ? encryption.encryptionStatus : 'NONE',
                'orion-encryption-request-id': encryption ? encryption.encryptionRequestId : 'NONE',
                'orion-encryption-alg': encryption ? encryption.encryptionAlg : 'NONE',
                'orion-api-system-version': '1.0.0[BETA]',
                Origin: window.location.origin,
                Authorization: authorization
            },
            credentials: 'include',
            body: body ? JSON.stringify(body) : undefined
        });

        const refresh = response.headers.get('orion-response-refresh') || response.headers.get('Orion-Response-Refresh');

        if (refresh) {
            if (String(refresh) === 'true') {
                window.location.reload();
            }
        }

        const dipFailure = response.headers.get('orion-dip-failure') || response.headers.get('Orion-Dip-Failure');

        if (dipFailure) {
            if (String(dipFailure) === 'true') {
                await orionVault.deleteItem('CACHE:*:ORION_DIP_CONFIG');
                window.location.reload();
            }
        }

        const flow = response.headers.get('orion-flow-activation') || response.headers.get('Orion-Flow-Activation');

        if (flow) {
            const flowFn = ORION_FLOW_TYPES[flow];

            if (!flowFn) {
                throw new Error('Orion header flow triggered, invalid flow type!');
            }

            // dynamically extract params from 'this'
            const args = flowFn.params.map(paramName => this[paramName]);

            // await the flow UI — it now resolves when the user completes authorization
            await flowFn.fn(...args);

            // Signal the caller to retry their original operation with the same args.
            // The original response is stale (it had the flow header, not a real result).
            const retryErr = new Error('ORION_DEVICE_AUTH_COMPLETED');
            retryErr._orionDeviceAuthCompleted = true;
            throw retryErr;
        }

        return response;
    }

    async prepareDataForEncryption(data) {
        const algs = await getSupportedEncryptionAlgs();

        const key = await this.fetch(`/${this.nameSpace}/api/v1/request/encryption-request-key`, 'POST', 'NO_AUTH_BEARER', { packet: { algs } });

        if (!key.ok) {
            return { error: true, errorCode: 'CLIENT-UNABLE-TO-GET-KEY' };
        }

        const dataServer = await key.json();

        const algorithm = dataServer.data.alg;

        const pubKey = dataServer.data.publicKey;

        // The system support two encyrption algs ECC and RSA and have different working mechanics and paylod structures
        if (algorithm === 'RSA') {
            const secureTransportEncryptionKey = await generateAES256Key();

            const str = JSON.stringify(data);

            const encryptedClientPayload = await encryptAESGCM(str, secureTransportEncryptionKey);

            const exportableKey = exportKeyBase64(secureTransportEncryptionKey);

            const encryptedSecureTransportEncryptionKey = await encryptPublic(exportableKey, pubKey);

            const compressedPayload = JSON.stringify({
                payload: encryptedClientPayload,
                encryptedSecureTransportEncryptionKey: encryptedSecureTransportEncryptionKey
            });

            return {
                encryptedString: compressedPayload,
                encryption: {
                    encryptionStatus: 'ENCRYPTED',
                    encryptionRequestId: dataServer.data.encryptionId,
                    encryptionAlg: 'RSA'
                }
            };
        }

        if (algorithm === 'ECC') {
            const size = `P-${dataServer.data.size}`;

            const info = 'ORION_ECC_ENCRYPTION_TAG';

            const serverPubKey = base64DecodeToUint8(pubKey);

            const secureTransportEncryptionKey = await generateAES256Key();

            const str = JSON.stringify(data);

            const nonceFn = generateNonce();

            const nonce = nonceFn();

            const encryptedClientPayload = await encryptAESGCM(str, secureTransportEncryptionKey);

            const exportableKey = exportKeyBase64(secureTransportEncryptionKey);

            const keyPairClient = await generateKeyPairECC(size);

            const sharedKey = await deriveSharedSecret(keyPairClient.privateKey, await importPublicKeyECC(serverPubKey, size));

            const derivedKey = await deriveKey(sharedKey, new TextEncoder().encode(nonce), new TextEncoder().encode(info));

            const encryptedKey = await encryptAESGCM(exportableKey, derivedKey);

            const exportedClientPubKey = await exportPublicKeyECC(keyPairClient.publicKey);

            const compressedPayload = JSON.stringify({
                payload: encryptedClientPayload,
                encryptedSecureTransportEncryptionKey: encryptedKey,
                eccSpecificData: {
                    clientPublicKey: base64EncodeUint8(exportedClientPubKey),
                    salt: nonce,
                    info: info
                }
            });

            return {
                encryptedString: compressedPayload,
                encryption: {
                    encryptionStatus: 'ENCRYPTED',
                    encryptionRequestId: dataServer.data.encryptionId,
                    encryptionAlg: 'ECC'
                }
            };
        }
    }

    async prepareDataForDIP(data, dipConfig) {
        
        if (dipConfig?.disabled) {
            return { disabled: true, dipSignature: 'DEFAULT NONE', salt: 'DEFAULT NONE', timestamp: 'DEFAULT NONE' };
        }

        const stringData = JSON.stringify(data);

        const saltArray = window.crypto.getRandomValues(new Uint8Array(16)); // 16 bytes = 128 bits
        const salt = Array.from(saltArray).map(b => b.toString(16).padStart(2, '0')).join('');

        const deviceFingerprint = await getDeviceFingerprint();

        const unix = getCurrentUnixTime();

        const fullTimestamp = `Unix:${unix}`;

        const signature = await generateHmac(stringData + salt + fullTimestamp + navigator.userAgent + deviceFingerprint, dipConfig.signatureKey);

        return { dipSignature: signature, salt: salt, timestamp: fullTimestamp };
    }
}

export { ApiInterface };