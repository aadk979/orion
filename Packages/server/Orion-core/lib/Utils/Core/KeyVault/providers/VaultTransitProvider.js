import { KeyVaultProvider, KeyVaultError, TokenCache, b64, unb64, WRAP_CONTEXT } from '../KeyVaultProvider.js';

/** Transit key types whose ciphers accept associated data (AAD). */
const AEAD_KEY_TYPES = new Set(['aes128-gcm96', 'aes256-gcm96', 'chacha20-poly1305', 'xchacha20-poly1305']);

/**
 * HashiCorp Vault / OpenBao transit secrets engine.
 *
 * One implementation serves three deployments because they speak the identical
 * wire protocol:
 *
 *   HASHICORP_VAULT — self-hosted Vault Community Edition, or HCP Vault
 *                     Dedicated (set `namespace: 'admin'` for HCP).
 *   OPENBAO         — the Linux Foundation fork; API-compatible by design.
 *
 * The transit engine is a crypto service, not a store: the key never leaves
 * the server, and Orion only ever posts a 32-byte DEK to be wrapped. Transit
 * ciphertexts are self-describing (`vault:v3:…`), so rotation never strands
 * previously wrapped DEKs — a decrypt of an older ciphertext keeps working
 * until `min_decryption_version` is raised past it.
 *
 * Auth is a static token, or AppRole (recommended: the response's lease is
 * honoured and the token is renewed automatically before it expires).
 *
 * Required policy on the mount:
 *   path "transit/encrypt/<key>" { capabilities = ["update"] }
 *   path "transit/decrypt/<key>" { capabilities = ["update"] }
 *   path "transit/keys/<key>"    { capabilities = ["read"] }
 *   path "transit/keys/<key>/rotate" { capabilities = ["update"] }   # rotation only
 */
class VaultTransitProvider extends KeyVaultProvider {
    static id = 'HASHICORP_VAULT';
    static displayName = 'HashiCorp Vault (transit)';

    static configSchema = {
        required: ['address', 'keyName'],
        optional: ['mount', 'namespace', 'authMount'],
        envFallbacks: { address: ['VAULT_ADDR'], token: ['VAULT_TOKEN'] },
        oneOf: [
            { label: 'a static token', keys: ['token'] },
            { label: 'AppRole credentials', keys: ['roleId', 'secretId'] }
        ]
    };

    constructor(config = {}) {
        super(config);

        this.address = String(this._require('address', config.address || process.env.VAULT_ADDR)).replace(/\/$/, '');
        this.mount = String(config.mount || 'transit').replace(/^\/|\/$/g, '');
        this.keyName = this._require('keyName', config.keyName);
        this.namespace = config.namespace || process.env.VAULT_NAMESPACE || null;

        this.supportsAad = false;

        const staticToken = config.token || process.env.VAULT_TOKEN;

        if (staticToken) {
            this._tokens = new TokenCache(async () => ({ token: staticToken, expiresInSeconds: 3600 }));
        } else {
            const roleId = this._require('roleId', config.roleId);
            const secretId = this._require('secretId', config.secretId);
            const authMount = String(config.authMount || 'approle').replace(/^\/|\/$/g, '');

            this._tokens = new TokenCache(async () => {
                const result = await this._request(`${this.address}/v1/auth/${authMount}/login`, {
                    method: 'POST',
                    headers: this._headers(null),
                    body: { role_id: roleId, secret_id: secretId }
                });

                if (!result?.auth?.client_token) {
                    throw new KeyVaultError('KEYVAULT::AUTH-REJECTED', `${this.displayName}: AppRole login returned no client_token`, { provider: this.id });
                }

                return { token: result.auth.client_token, expiresInSeconds: result.auth.lease_duration || 3600 };
            });
        }
    }

    get capabilities() {
        return { mode: 'remote', rotateKek: true, keyVersions: false, aad: this.supportsAad };
    }

    get keyRef() {
        return `${this.id.toLowerCase()}:${this.address}/${this.mount}/${this.keyName}`;
    }

    _headers(token) {
        return {
            ...(token ? { 'X-Vault-Token': token } : {}),
            ...(this.namespace ? { 'X-Vault-Namespace': this.namespace } : {})
        };
    }

    async initialize() {
        const token = await this._tokens.get();

        const key = await this._request(`${this.address}/v1/${this.mount}/keys/${encodeURIComponent(this.keyName)}`, {
            method: 'GET',
            headers: this._headers(token)
        });

        const type = key?.data?.type;

        if (!type) {
            throw new KeyVaultError('KEYVAULT::KEY-NOT-FOUND', `${this.displayName}: transit key "${this.keyName}" does not exist on mount "${this.mount}"`, {
                provider: this.id
            });
        }

        if (key.data.supports_encryption === false || key.data.supports_decryption === false) {
            throw new KeyVaultError('KEYVAULT::INVALID-CONFIG', `${this.displayName}: transit key "${this.keyName}" is type "${type}", which cannot encrypt/decrypt`, {
                provider: this.id
            });
        }

        // Only AEAD ciphers accept associated_data; sending it to others is a
        // hard 400 from the server, so the capability is discovered, not assumed.
        this.supportsAad = AEAD_KEY_TYPES.has(type);
        this.keyType = type;

        this.initialized = true;
    }

    _aadField() {
        return this.supportsAad ? { associated_data: b64(Buffer.from(JSON.stringify(WRAP_CONTEXT), 'utf8')) } : {};
    }

    async _transit(operation, body) {
        const token = await this._tokens.get();

        try {
            return await this._request(`${this.address}/v1/${this.mount}/${operation}/${encodeURIComponent(this.keyName)}`, {
                method: 'POST',
                headers: this._headers(token),
                body
            });
        } catch (error) {
            // Vault tokens can be revoked or expire early; one re-login is warranted.
            if (error.code === 'KEYVAULT::AUTH-REJECTED') {
                this._tokens.invalidate();
                const fresh = await this._tokens.get();
                return this._request(`${this.address}/v1/${this.mount}/${operation}/${encodeURIComponent(this.keyName)}`, {
                    method: 'POST',
                    headers: this._headers(fresh),
                    body
                });
            }
            throw error;
        }
    }

    async wrapKey(dek) {
        const result = await this._transit('encrypt', { plaintext: b64(dek), ...this._aadField() });

        if (!result?.data?.ciphertext) {
            throw new KeyVaultError('KEYVAULT::MALFORMED-RESPONSE', `${this.displayName}: encrypt returned no ciphertext`, { provider: this.id });
        }

        // `vault:vN:…` — the version is carried in the blob itself.
        const version = String(result.data.ciphertext).split(':')[1] || null;

        return this._wrapResult(result.data.ciphertext, { keyVersion: version, algorithm: this.keyType || 'transit' });
    }

    async unwrapKey(blob) {
        const result = await this._transit('decrypt', { ciphertext: String(blob), ...this._aadField() });

        if (!result?.data?.plaintext) {
            throw new KeyVaultError('KEYVAULT::UNWRAP-FAILED', `${this.displayName}: decrypt returned no plaintext`, { provider: this.id });
        }

        return this._assertDek(unb64(result.data.plaintext));
    }

    async rotateKek() {
        try {
            const token = await this._tokens.get();

            await this._request(`${this.address}/v1/${this.mount}/keys/${encodeURIComponent(this.keyName)}/rotate`, {
                method: 'POST',
                headers: this._headers(token),
                body: {}
            });

            const key = await this._request(`${this.address}/v1/${this.mount}/keys/${encodeURIComponent(this.keyName)}`, {
                method: 'GET',
                headers: this._headers(token)
            });

            return { rotated: true, keyVersion: String(key?.data?.latest_version ?? ''), reason: null };
        } catch (error) {
            return { rotated: false, keyVersion: null, reason: `${this.displayName} refused rotation: ${error.message}` };
        }
    }
}

/**
 * OpenBao — the community fork of Vault under the Linux Foundation, kept
 * API-compatible with the transit engine. Registered as its own provider id so
 * operators declare what they actually run (it shows up in logs, health output
 * and the orchestrator panel), rather than configuring "vault" and hoping.
 */
class OpenBaoTransitProvider extends VaultTransitProvider {
    static id = 'OPENBAO';
    static displayName = 'OpenBao (transit)';

    static configSchema = {
        ...VaultTransitProvider.configSchema,
        envFallbacks: { address: ['BAO_ADDR', 'VAULT_ADDR'], token: ['BAO_TOKEN', 'VAULT_TOKEN'] }
    };

    constructor(config = {}) {
        super({ ...config, address: config.address || process.env.BAO_ADDR || process.env.VAULT_ADDR, token: config.token || process.env.BAO_TOKEN || process.env.VAULT_TOKEN });
    }
}

export { VaultTransitProvider, OpenBaoTransitProvider };
