import { KeyVaultProvider, KeyVaultError, TokenCache, b64url, unb64url } from '../KeyVaultProvider.js';
import { createAzureTokenRefresher, loadOptionalSdk } from '../cloudAuth.js';

const DEFAULT_API_VERSION = '7.4';

/**
 * Azure Key Vault (and Managed HSM).
 *
 * Uses the wrapKey/unwrapKey operations, which exist precisely for this
 * purpose: protecting a symmetric key with a key that never leaves the vault.
 * The standard tier is software-protected; the premium tier and Managed HSM
 * are FIPS 140-3 Level 3 HSMs.
 *
 * Unlike KMS and Cloud KMS, an Azure ciphertext does NOT identify the key
 * version that produced it — the version is part of the request URI. Rotation
 * therefore strands old blobs unless the version is recorded, so this provider
 * reports `keyVersions: true` and stores the resolved version with every wrap.
 * unwrapKey then addresses that exact version.
 *
 * `alg` defaults to RSA-OAEP-256 (an RSA key). For an oct-HSM key set
 * `algorithm: 'A256KW'`. AAD is not applicable to either algorithm and is not
 * sent — the binding Orion relies on lives in the DEK envelope instead.
 *
 * Required access policy / RBAC role: Key Vault Crypto User (wrapKey,
 * unwrapKey, get), plus Key Vault Crypto Officer for control-plane rotation.
 */
class AzureKeyVaultProvider extends KeyVaultProvider {
    static id = 'AZURE_KEY_VAULT';
    static displayName = 'Azure Key Vault';

    // tenantId/clientId/clientSecret are optional: omitting them selects
    // managed identity, which is the preferred production path.
    static configSchema = {
        required: ['vaultUrl', 'keyName'],
        optional: ['algorithm', 'apiVersion', 'keyVersion', 'tenantId', 'clientId', 'clientSecret'],
        envFallbacks: { tenantId: ['AZURE_TENANT_ID'], clientId: ['AZURE_CLIENT_ID'], clientSecret: ['AZURE_CLIENT_SECRET'] }
    };

    constructor(config = {}) {
        super(config);

        this.vaultUrl = String(this._require('vaultUrl', config.vaultUrl)).replace(/\/$/, '');
        this.keyName = this._require('keyName', config.keyName);
        this.algorithm = config.algorithm || 'RSA-OAEP-256';
        this.apiVersion = config.apiVersion || DEFAULT_API_VERSION;

        // A pinned version is honoured; otherwise the current one is resolved
        // at boot and refreshed whenever the vault reports a newer kid.
        this.pinnedVersion = config.keyVersion || null;
        this._currentVersion = this.pinnedVersion;

        this._tokens = new TokenCache(createAzureTokenRefresher(config));
        this._sdkClients = null;
    }

    get capabilities() {
        return { mode: 'remote', rotateKek: true, keyVersions: true, aad: false };
    }

    get keyRef() {
        return `azure-kv:${this.vaultUrl}/keys/${this.keyName}`;
    }

    async initialize() {
        const [keysSdk, identitySdk] = await Promise.all([loadOptionalSdk('@azure/keyvault-keys'), loadOptionalSdk('@azure/identity')]);

        if (keysSdk?.KeyClient && identitySdk) {
            const credential =
                this.config.tenantId && this.config.clientId && this.config.clientSecret
                    ? new identitySdk.ClientSecretCredential(this.config.tenantId, this.config.clientId, this.config.clientSecret)
                    : new identitySdk.DefaultAzureCredential();

            const keyClient = new keysSdk.KeyClient(this.vaultUrl, credential);
            const key = await keyClient.getKey(this.keyName);

            this._currentVersion = this.pinnedVersion || key.properties.version;
            this._sdkClients = { keyClient, credential, cryptoFor: version => new keysSdk.CryptographyClient(`${this.vaultUrl}/keys/${this.keyName}/${version}`, credential) };
        } else {
            await this._resolveCurrentVersion();
        }

        this.initialized = true;
    }

    /** Reads the key bundle and extracts the version from its kid. */
    async _resolveCurrentVersion() {
        if (this.pinnedVersion) return this.pinnedVersion;

        const token = await this._tokens.get();
        const bundle = await this._request(`${this.vaultUrl}/keys/${encodeURIComponent(this.keyName)}?api-version=${this.apiVersion}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
        });

        const version = String(bundle?.key?.kid || '').split('/').pop();

        if (!version) {
            throw new KeyVaultError('KEYVAULT::KEY-NOT-FOUND', `Azure Key Vault: could not resolve a version for key "${this.keyName}"`, { provider: this.id });
        }

        this._currentVersion = version;
        return version;
    }

    async _keyOperation(operation, version, value) {
        const token = await this._tokens.get();

        const result = await this._request(
            `${this.vaultUrl}/keys/${encodeURIComponent(this.keyName)}/${encodeURIComponent(version)}/${operation}?api-version=${this.apiVersion}`,
            { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: { alg: this.algorithm, value } }
        );

        if (!result?.value) {
            throw new KeyVaultError('KEYVAULT::MALFORMED-RESPONSE', `Azure Key Vault ${operation} returned no value`, { provider: this.id });
        }

        return result.value;
    }

    async wrapKey(dek) {
        const version = this._currentVersion || (await this._resolveCurrentVersion());

        if (this._sdkClients) {
            const result = await this._sdkClients.cryptoFor(version).wrapKey(this.algorithm, dek);
            return this._wrapResult(Buffer.from(result.result).toString('base64url'), { keyVersion: version, algorithm: this.algorithm });
        }

        return this._wrapResult(await this._keyOperation('wrapkey', version, b64url(dek)), { keyVersion: version, algorithm: this.algorithm });
    }

    async unwrapKey(blob, { keyVersion = null } = {}) {
        // Address the version that performed the wrap. Falling back to the
        // current version would silently fail after any rotation.
        const version = keyVersion || this._currentVersion || (await this._resolveCurrentVersion());

        if (this._sdkClients) {
            const result = await this._sdkClients.cryptoFor(version).unwrapKey(this.algorithm, unb64url(blob));
            return this._assertDek(Buffer.from(result.result));
        }

        return this._assertDek(unb64url(await this._keyOperation('unwrapkey', version, String(blob))));
    }

    /**
     * Key Vault rotation creates a new version and makes it current. Old
     * versions remain enabled, and existing wrapped DEKs still name the version
     * that produced them, so nothing is stranded.
     */
    async rotateKek() {
        try {
            const token = await this._tokens.get();

            const bundle = await this._request(`${this.vaultUrl}/keys/${encodeURIComponent(this.keyName)}/rotate?api-version=${this.apiVersion}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                body: {}
            });

            const version = String(bundle?.key?.kid || '').split('/').pop() || null;

            // A pinned version is an explicit operator decision — rotation must
            // not silently start using a different key than the one configured.
            if (!this.pinnedVersion && version) this._currentVersion = version;

            return {
                rotated: true,
                keyVersion: version,
                reason: this.pinnedVersion ? 'Rotated, but utilities.dataEncryption.keyVersion is pinned — new wraps still use the pinned version' : null
            };
        } catch (error) {
            return { rotated: false, keyVersion: null, reason: `Azure Key Vault refused rotation: ${error.message}` };
        }
    }
}

export { AzureKeyVaultProvider };
