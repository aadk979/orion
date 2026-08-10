import { KeyVaultProvider, KeyVaultError, TokenCache, b64, unb64, WRAP_CONTEXT } from '../KeyVaultProvider.js';

const DEFAULT_GATEWAY = 'https://api.akeyless.io';

/**
 * Akeyless Vault (SaaS or self-hosted gateway).
 *
 * Encryption runs against an Akeyless DFC (Distributed Fragments Cryptography)
 * key: the key is never assembled in one place, and Akeyless itself never holds
 * every fragment — the zero-knowledge property the product is built around.
 * From Orion's side it behaves like any other remote-crypto vault.
 *
 * Auth exchanges an API-key pair (access id + access key) for a short-lived
 * `t-…` token, which is cached and refreshed on expiry.
 *
 * WRAP_CONTEXT travels as Akeyless's encryption-context and must match on
 * decrypt, exactly like AWS's EncryptionContext.
 */
class AkeylessProvider extends KeyVaultProvider {
    static id = 'AKEYLESS';
    static displayName = 'Akeyless Vault';

    static configSchema = {
        required: ['keyName', 'accessId', 'accessKey'],
        optional: ['gatewayUrl', 'accessType'],
        envFallbacks: { accessId: ['AKEYLESS_ACCESS_ID'], accessKey: ['AKEYLESS_ACCESS_KEY'] }
    };

    constructor(config = {}) {
        super(config);

        this.gateway = String(config.gatewayUrl || DEFAULT_GATEWAY).replace(/\/$/, '');
        this.keyName = this._require('keyName', config.keyName);

        const accessId = this._require('accessId', config.accessId || process.env.AKEYLESS_ACCESS_ID);
        const accessKey = this._require('accessKey', config.accessKey || process.env.AKEYLESS_ACCESS_KEY);
        const accessType = config.accessType || 'access_key';

        this._tokens = new TokenCache(async () => {
            const result = await this._request(`${this.gateway}/auth`, {
                method: 'POST',
                body: { 'access-id': accessId, 'access-key': accessKey, 'access-type': accessType }
            });

            if (!result?.token) {
                throw new KeyVaultError('KEYVAULT::AUTH-REJECTED', 'Akeyless: /auth returned no token', { provider: this.id });
            }

            // Akeyless tokens are valid for an hour; refresh a little early.
            return { token: result.token, expiresInSeconds: 3300 };
        });

        this._context = JSON.stringify(WRAP_CONTEXT);
    }

    get capabilities() {
        return { mode: 'remote', rotateKek: true, keyVersions: true, aad: true };
    }

    get keyRef() {
        return `akeyless:${this.gateway}:${this.keyName}`;
    }

    async initialize() {
        // Proves both the credentials and the key name before the node serves.
        await this._tokens.get();
        this.initialized = true;
    }

    async _call(path, payload) {
        const token = await this._tokens.get();

        try {
            return await this._request(`${this.gateway}${path}`, { method: 'POST', body: { ...payload, token } });
        } catch (error) {
            if (error.code === 'KEYVAULT::AUTH-REJECTED') {
                this._tokens.invalidate();
                const fresh = await this._tokens.get();
                return this._request(`${this.gateway}${path}`, { method: 'POST', body: { ...payload, token: fresh } });
            }
            throw error;
        }
    }

    async wrapKey(dek) {
        const result = await this._call('/encrypt', { 'key-name': this.keyName, plaintext: b64(dek), 'encryption-context': this._context });
        const ciphertext = result?.result ?? result?.Result;

        if (!ciphertext) {
            throw new KeyVaultError('KEYVAULT::MALFORMED-RESPONSE', 'Akeyless /encrypt returned no result', { provider: this.id });
        }

        return this._wrapResult(ciphertext, { algorithm: 'Akeyless DFC' });
    }

    async unwrapKey(blob) {
        const result = await this._call('/decrypt', { 'key-name': this.keyName, ciphertext: String(blob), 'encryption-context': this._context });
        const plaintext = result?.result ?? result?.Result;

        if (!plaintext) {
            throw new KeyVaultError('KEYVAULT::UNWRAP-FAILED', 'Akeyless /decrypt returned no result', { provider: this.id });
        }

        // The plaintext round-trips as the base64 that wrapKey submitted.
        return this._assertDek(unb64(plaintext));
    }

    async rotateKek() {
        try {
            await this._call('/rotate-key', { name: this.keyName });
            return { rotated: true, keyVersion: null, reason: null };
        } catch (error) {
            return { rotated: false, keyVersion: null, reason: `Akeyless refused rotation: ${error.message}` };
        }
    }
}

export { AkeylessProvider };
