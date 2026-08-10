import { MaterialKeyVaultProvider, KeyVaultError, TokenCache } from '../KeyVaultProvider.js';

const HCP_AUTH_URL = 'https://auth.idp.hashicorp.com/oauth2/token';
const HCP_API_BASE = 'https://api.cloud.hashicorp.com/secrets/2023-11-28';
const HCP_AUDIENCE = 'https://api.hashicorp.cloud';

/**
 * HCP Vault Secrets — HashiCorp's managed secret STORE (distinct from HCP
 * Vault Dedicated, which runs a full Vault with a transit engine and is served
 * by VaultTransitProvider instead).
 *
 * This is a material-mode provider: HCP Vault Secrets has no transit/crypto
 * engine, so it holds high-entropy key material that Orion fetches once at
 * boot and uses to wrap the DEK locally. The KEK therefore does enter this
 * process's memory — weaker than a remote-crypto vault, and materially
 * stronger than a key in a config file, because it is centrally revocable,
 * rotatable and audited. Prefer HCP Vault Dedicated (`HASHICORP_VAULT`) where
 * the subscription allows it.
 *
 * Auth: an HCP service principal (client id + secret) via client_credentials.
 * The secret's `version` is recorded with every wrap so a rotation at the vault
 * is detected rather than silently producing undecryptable data.
 */
class HcpVaultSecretsProvider extends MaterialKeyVaultProvider {
    static id = 'HCP_VAULT_SECRETS';
    static displayName = 'HCP Vault Secrets';

    static configSchema = {
        required: ['organizationId', 'projectId', 'appName', 'secretName', 'clientId', 'clientSecret'],
        envFallbacks: {
            organizationId: ['HCP_ORG_ID'],
            projectId: ['HCP_PROJECT_ID'],
            clientId: ['HCP_CLIENT_ID'],
            clientSecret: ['HCP_CLIENT_SECRET']
        }
    };

    constructor(config = {}) {
        super(config);

        this.organizationId = this._require('organizationId', config.organizationId || process.env.HCP_ORG_ID);
        this.projectId = this._require('projectId', config.projectId || process.env.HCP_PROJECT_ID);
        this.appName = this._require('appName', config.appName);
        this.secretName = this._require('secretName', config.secretName);

        const clientId = this._require('clientId', config.clientId || process.env.HCP_CLIENT_ID);
        const clientSecret = this._require('clientSecret', config.clientSecret || process.env.HCP_CLIENT_SECRET);

        this._tokens = new TokenCache(async () => {
            const result = await this._request(HCP_AUTH_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, audience: HCP_AUDIENCE }).toString()
            });

            if (!result?.access_token) {
                throw new KeyVaultError('KEYVAULT::AUTH-REJECTED', 'HCP Vault Secrets: token endpoint returned no access_token', { provider: this.id });
            }

            return { token: result.access_token, expiresInSeconds: Number(result.expires_in) || 3600 };
        });
    }

    get keyRef() {
        return `hcp-vault-secrets:${this.organizationId}/${this.projectId}/${this.appName}/${this.secretName}`;
    }

    async fetchKeyMaterial() {
        const token = await this._tokens.get();

        const url =
            `${HCP_API_BASE}/organizations/${encodeURIComponent(this.organizationId)}` +
            `/projects/${encodeURIComponent(this.projectId)}/apps/${encodeURIComponent(this.appName)}` +
            `/secrets/${encodeURIComponent(this.secretName)}:open`;

        const result = await this._request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });

        const staticVersion = result?.secret?.static_version;
        const material = staticVersion?.value;

        if (!material) {
            throw new KeyVaultError(
                'KEYVAULT::KEY-NOT-FOUND',
                `HCP Vault Secrets: app "${this.appName}" has no static secret named "${this.secretName}" (rotating and dynamic secrets cannot be used as a KEK)`,
                { provider: this.id }
            );
        }

        return { material, version: staticVersion.version ?? null };
    }

    async rotateKek() {
        return {
            rotated: false,
            keyVersion: this._materialVersion,
            reason: 'HCP Vault Secrets stores key material rather than performing crypto — create a new version of the secret in HCP, then rotate the DEK so it is re-wrapped under it.'
        };
    }
}

export { HcpVaultSecretsProvider };
