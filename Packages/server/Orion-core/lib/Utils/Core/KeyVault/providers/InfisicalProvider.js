import { KeyVaultProvider, KeyVaultError, TokenCache, b64, unb64 } from '../KeyVaultProvider.js';

const DEFAULT_BASE_URL = 'https://app.infisical.com';

/**
 * Infisical KMS — covers both Infisical Cloud (US/EU) and a self-hosted
 * MIT-licensed instance; they are the same API behind different base URLs, so
 * `baseUrl` is the only thing that distinguishes them:
 *
 *   https://app.infisical.com   (cloud, US)
 *   https://eu.infisical.com    (cloud, EU)
 *   https://infisical.internal  (self-hosted, Docker/Helm)
 *
 * Auth is Machine Identity universal-auth (clientId + clientSecret exchanged
 * for a short-lived access token), or a pre-issued service token.
 *
 * Infisical's KMS API exposes no additional-authenticated-data parameter, so
 * `aad: false` is reported honestly rather than pretending the binding exists.
 */
class InfisicalProvider extends KeyVaultProvider {
    static id = 'INFISICAL';
    static displayName = 'Infisical KMS';

    static configSchema = {
        required: ['keyId'],
        optional: ['baseUrl'],
        envFallbacks: {
            baseUrl: ['INFISICAL_API_URL'],
            token: ['INFISICAL_TOKEN'],
            clientId: ['INFISICAL_CLIENT_ID'],
            clientSecret: ['INFISICAL_CLIENT_SECRET']
        },
        oneOf: [
            { label: 'a service token', keys: ['token'] },
            { label: 'Machine Identity universal-auth credentials', keys: ['clientId', 'clientSecret'] }
        ]
    };

    constructor(config = {}) {
        super(config);

        this.baseUrl = String(config.baseUrl || process.env.INFISICAL_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
        this.keyId = this._require('keyId', config.keyId);

        const staticToken = config.token || process.env.INFISICAL_TOKEN;

        if (staticToken) {
            this._tokens = new TokenCache(async () => ({ token: staticToken, expiresInSeconds: 3600 }));
        } else {
            const clientId = this._require('clientId', config.clientId || process.env.INFISICAL_CLIENT_ID);
            const clientSecret = this._require('clientSecret', config.clientSecret || process.env.INFISICAL_CLIENT_SECRET);

            this._tokens = new TokenCache(async () => {
                const result = await this._request(`${this.baseUrl}/api/v1/auth/universal-auth/login`, {
                    method: 'POST',
                    body: { clientId, clientSecret }
                });

                if (!result?.accessToken) {
                    throw new KeyVaultError('KEYVAULT::AUTH-REJECTED', 'Infisical: universal-auth login returned no accessToken', { provider: this.id });
                }

                return { token: result.accessToken, expiresInSeconds: Number(result.expiresIn) || 3600 };
            });
        }
    }

    get capabilities() {
        return { mode: 'remote', rotateKek: false, keyVersions: false, aad: false };
    }

    get keyRef() {
        return `infisical:${this.baseUrl}:${this.keyId}`;
    }

    async initialize() {
        const token = await this._tokens.get();

        // Confirms the key exists and the identity can see it, before serving.
        await this._request(`${this.baseUrl}/api/v1/kms/keys/${encodeURIComponent(this.keyId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
        });

        this.initialized = true;
    }

    async _call(operation, payload) {
        const token = await this._tokens.get();
        const url = `${this.baseUrl}/api/v1/kms/keys/${encodeURIComponent(this.keyId)}/${operation}`;

        try {
            return await this._request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: payload });
        } catch (error) {
            if (error.code === 'KEYVAULT::AUTH-REJECTED') {
                this._tokens.invalidate();
                const fresh = await this._tokens.get();
                return this._request(url, { method: 'POST', headers: { Authorization: `Bearer ${fresh}` }, body: payload });
            }
            throw error;
        }
    }

    async wrapKey(dek) {
        const result = await this._call('encrypt', { plaintext: b64(dek) });

        if (!result?.ciphertext) {
            throw new KeyVaultError('KEYVAULT::MALFORMED-RESPONSE', 'Infisical KMS encrypt returned no ciphertext', { provider: this.id });
        }

        return this._wrapResult(result.ciphertext, { algorithm: 'Infisical KMS' });
    }

    async unwrapKey(blob) {
        const result = await this._call('decrypt', { ciphertext: String(blob) });

        if (!result?.plaintext) {
            throw new KeyVaultError('KEYVAULT::UNWRAP-FAILED', 'Infisical KMS decrypt returned no plaintext', { provider: this.id });
        }

        return this._assertDek(unb64(result.plaintext));
    }

    async rotateKek() {
        return {
            rotated: false,
            keyVersion: null,
            reason: 'Infisical KMS does not expose key rotation through its API — create a new key, point utilities.dataEncryption.keyId at it, and rotate the DEK to re-wrap under it.'
        };
    }
}

export { InfisicalProvider };
