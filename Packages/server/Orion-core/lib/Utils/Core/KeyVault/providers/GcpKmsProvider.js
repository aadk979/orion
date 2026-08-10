import { KeyVaultProvider, KeyVaultError, TokenCache, b64, unb64, WRAP_CONTEXT } from '../KeyVaultProvider.js';
import { createGcpTokenRefresher, loadOptionalSdk } from '../cloudAuth.js';

const CLOUD_KMS_BASE = 'https://cloudkms.googleapis.com/v1';

/**
 * Google Cloud KMS.
 *
 * Wrapping targets the CryptoKey, not a specific version, so Cloud KMS always
 * encrypts with the key's PRIMARY version while decrypt automatically selects
 * the version that produced the ciphertext. Rotation therefore never strands
 * existing wrapped DEKs.
 *
 * WRAP_CONTEXT travels as additionalAuthenticatedData and is bound into the
 * ciphertext.
 *
 * Credentials: a service-account key in `credentials` (or the
 * GOOGLE_APPLICATION_CREDENTIALS_JSON env var), otherwise the GCE/GKE
 * metadata server. Required role: roles/cloudkms.cryptoKeyEncrypterDecrypter,
 * plus roles/cloudkms.admin only for control-plane rotation.
 */
class GcpKmsProvider extends KeyVaultProvider {
    static id = 'GCP_KMS';
    static displayName = 'Google Cloud KMS';

    static configSchema = {
        optional: ['credentials'],
        oneOf: [
            { label: 'a full resource name', keys: ['cryptoKey'] },
            { label: 'the four resource parts', keys: ['projectId', 'location', 'keyRing', 'keyName'] }
        ]
    };

    constructor(config = {}) {
        super(config);

        // Either a full resource name, or the four parts it is built from.
        this.cryptoKey =
            config.cryptoKey ||
            `projects/${this._require('projectId', config.projectId)}/locations/${this._require('location', config.location)}` +
                `/keyRings/${this._require('keyRing', config.keyRing)}/cryptoKeys/${this._require('keyName', config.keyName)}`;

        this._tokens = new TokenCache(createGcpTokenRefresher(config));
        this._sdkClient = null;
        this._aad = Buffer.from(JSON.stringify(WRAP_CONTEXT), 'utf8');
    }

    get capabilities() {
        return { mode: 'remote', rotateKek: true, keyVersions: false, aad: true };
    }

    get keyRef() {
        return `gcp-kms:${this.cryptoKey}`;
    }

    async initialize() {
        const sdk = await loadOptionalSdk('@google-cloud/kms');

        if (sdk?.KeyManagementServiceClient) {
            this._sdkClient = new sdk.KeyManagementServiceClient(this.config.credentials ? { credentials: this.config.credentials } : {});
        } else {
            // Fail fast on a bad service-account key rather than at first wrap.
            await this._tokens.get();
        }

        this.initialized = true;
    }

    async _authorizedRequest(path, body) {
        const token = await this._tokens.get();

        try {
            return await this._request(`${CLOUD_KMS_BASE}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
        } catch (error) {
            // A rejected token is worth exactly one retry with a fresh one:
            // metadata-server tokens can be revoked mid-life.
            if (error.code === 'KEYVAULT::AUTH-REJECTED') {
                this._tokens.invalidate();
                const fresh = await this._tokens.get();
                return this._request(`${CLOUD_KMS_BASE}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${fresh}` }, body });
            }
            throw error;
        }
    }

    async wrapKey(dek) {
        if (this._sdkClient) {
            const [result] = await this._sdkClient.encrypt({ name: this.cryptoKey, plaintext: dek, additionalAuthenticatedData: this._aad });
            return this._wrapResult(Buffer.from(result.ciphertext).toString('base64'), { algorithm: 'GCP KMS symmetric' });
        }

        const result = await this._authorizedRequest(`${this.cryptoKey}:encrypt`, { plaintext: b64(dek), additionalAuthenticatedData: b64(this._aad) });

        if (!result.ciphertext) {
            throw new KeyVaultError('KEYVAULT::MALFORMED-RESPONSE', 'Cloud KMS encrypt returned no ciphertext', { provider: this.id });
        }

        return this._wrapResult(result.ciphertext, { algorithm: 'GCP KMS symmetric' });
    }

    async unwrapKey(blob) {
        if (this._sdkClient) {
            const [result] = await this._sdkClient.decrypt({ name: this.cryptoKey, ciphertext: unb64(blob), additionalAuthenticatedData: this._aad });
            return this._assertDek(Buffer.from(result.plaintext));
        }

        const result = await this._authorizedRequest(`${this.cryptoKey}:decrypt`, { ciphertext: String(blob), additionalAuthenticatedData: b64(this._aad) });

        if (!result.plaintext) {
            throw new KeyVaultError('KEYVAULT::UNWRAP-FAILED', 'Cloud KMS decrypt returned no plaintext', { provider: this.id });
        }

        return this._assertDek(unb64(result.plaintext));
    }

    /**
     * Manual rotation: create a fresh CryptoKeyVersion and promote it to
     * primary. Older versions stay ENABLED, so previously wrapped DEKs keep
     * decrypting.
     */
    async rotateKek() {
        try {
            const token = await this._tokens.get();

            const created = await this._request(`${CLOUD_KMS_BASE}/${this.cryptoKey}/cryptoKeyVersions`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: {}
            });

            if (!created.name) {
                throw new Error('Cloud KMS did not return the new key version');
            }

            const version = created.name.split('/').pop();

            await this._request(`${CLOUD_KMS_BASE}/${this.cryptoKey}:updatePrimaryVersion`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: { cryptoKeyVersionId: version }
            });

            return { rotated: true, keyVersion: version, reason: null };
        } catch (error) {
            return { rotated: false, keyVersion: null, reason: `Cloud KMS refused rotation: ${error.message}` };
        }
    }

    async close() {
        await this._sdkClient?.close?.();
    }
}

export { GcpKmsProvider };
