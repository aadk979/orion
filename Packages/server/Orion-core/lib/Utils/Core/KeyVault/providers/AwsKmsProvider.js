import { KeyVaultProvider, KeyVaultError, b64, unb64, WRAP_CONTEXT } from '../KeyVaultProvider.js';
import { signAwsRequest, createAwsCredentialProvider, loadOptionalSdk } from '../cloudAuth.js';

/**
 * AWS Key Management Service.
 *
 * The KEK is a KMS customer managed key (symmetric, SYMMETRIC_DEFAULT). Orion
 * calls Encrypt/Decrypt with the DEK as the payload — well under the 4 KB
 * limit — and never sees the KEK. Keys are backed by FIPS 140-2 Level 3 HSMs.
 *
 * WRAP_CONTEXT travels as the KMS EncryptionContext, which KMS binds into the
 * ciphertext as AAD: a ciphertext lifted out of Orion's database cannot be
 * decrypted by a caller who omits it, even with full kms:Decrypt permission.
 *
 * Required IAM on the key: kms:Encrypt, kms:Decrypt, and kms:RotateKeyOnDemand
 * only if on-demand rotation is used from the control plane.
 */
class AwsKmsProvider extends KeyVaultProvider {
    static id = 'AWS_KMS';
    static displayName = 'AWS Key Management Service';

    // Credentials are deliberately NOT required: the default path is an
    // instance/task role resolved at runtime, and demanding static keys in
    // config would push deployments toward long-lived credentials.
    static configSchema = {
        required: ['region', 'keyId'],
        optional: ['endpoint', 'accessKeyId', 'secretAccessKey', 'sessionToken'],
        envFallbacks: { region: ['AWS_REGION'] }
    };

    constructor(config = {}) {
        super(config);

        this.region = this._require('region', config.region || process.env.AWS_REGION);
        this.keyId = this._require('keyId', config.keyId);
        this.host = config.endpoint ? new URL(config.endpoint).host : `kms.${this.region}.amazonaws.com`;
        this.endpoint = config.endpoint || `https://${this.host}/`;

        this._credentials = createAwsCredentialProvider(config);
        this._sdkClient = null;
        this._sdk = null;
    }

    get capabilities() {
        // KMS ciphertexts carry their own key-version reference internally, so
        // rotation never requires re-wrapping — but no version is exposed to us.
        return { mode: 'remote', rotateKek: true, keyVersions: false, aad: true };
    }

    get keyRef() {
        return `aws-kms:${this.region}:${this.keyId}`;
    }

    async initialize() {
        // SDK when installed (it owns retries, endpoint discovery, FIPS
        // endpoints and the full credential chain); built-in SigV4 otherwise.
        this._sdk = await loadOptionalSdk('@aws-sdk/client-kms');

        if (this._sdk) {
            this._sdkClient = new this._sdk.KMSClient({
                region: this.region,
                ...(this.config.endpoint ? { endpoint: this.config.endpoint } : {}),
                ...(this.config.accessKeyId && this.config.secretAccessKey
                    ? {
                          credentials: {
                              accessKeyId: this.config.accessKeyId,
                              secretAccessKey: this.config.secretAccessKey,
                              ...(this.config.sessionToken ? { sessionToken: this.config.sessionToken } : {})
                          }
                      }
                    : {})
            });
        }

        this.initialized = true;
    }

    /** Signed JSON-1.1 call to the KMS API — the no-SDK path. */
    async _call(target, payload) {
        const body = JSON.stringify(payload);
        const credentials = await this._credentials();

        const headers = signAwsRequest({
            region: this.region,
            service: 'kms',
            host: this.host,
            path: '/',
            body,
            headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `TrentService.${target}` },
            credentials
        });

        return this._request(this.endpoint, { method: 'POST', headers, body });
    }

    async wrapKey(dek) {
        if (this._sdkClient) {
            const result = await this._sdkClient.send(new this._sdk.EncryptCommand({ KeyId: this.keyId, Plaintext: dek, EncryptionContext: { ...WRAP_CONTEXT } }));
            return this._wrapResult(b64(result.CiphertextBlob), { algorithm: 'AWS KMS SYMMETRIC_DEFAULT' });
        }

        const result = await this._call('Encrypt', { KeyId: this.keyId, Plaintext: b64(dek), EncryptionContext: { ...WRAP_CONTEXT } });

        if (!result.CiphertextBlob) {
            throw new KeyVaultError('KEYVAULT::MALFORMED-RESPONSE', 'AWS KMS Encrypt returned no CiphertextBlob', { provider: this.id });
        }

        return this._wrapResult(result.CiphertextBlob, { algorithm: 'AWS KMS SYMMETRIC_DEFAULT' });
    }

    async unwrapKey(blob) {
        if (this._sdkClient) {
            const result = await this._sdkClient.send(
                new this._sdk.DecryptCommand({ CiphertextBlob: unb64(blob), KeyId: this.keyId, EncryptionContext: { ...WRAP_CONTEXT } })
            );
            return this._assertDek(Buffer.from(result.Plaintext));
        }

        const result = await this._call('Decrypt', { CiphertextBlob: String(blob), KeyId: this.keyId, EncryptionContext: { ...WRAP_CONTEXT } });

        if (!result.Plaintext) {
            throw new KeyVaultError('KEYVAULT::UNWRAP-FAILED', 'AWS KMS Decrypt returned no Plaintext', { provider: this.id });
        }

        return this._assertDek(unb64(result.Plaintext));
    }

    /**
     * On-demand rotation of the KMS key material. Existing ciphertexts stay
     * decryptable — KMS keeps every backing key — so nothing needs re-wrapping.
     */
    async rotateKek() {
        try {
            if (this._sdkClient) {
                await this._sdkClient.send(new this._sdk.RotateKeyOnDemandCommand({ KeyId: this.keyId }));
            } else {
                await this._call('RotateKeyOnDemand', { KeyId: this.keyId });
            }

            return { rotated: true, keyVersion: null, reason: null };
        } catch (error) {
            return { rotated: false, keyVersion: null, reason: `AWS KMS refused on-demand rotation: ${error.message}` };
        }
    }

    async close() {
        this._sdkClient?.destroy?.();
    }
}

export { AwsKmsProvider };
