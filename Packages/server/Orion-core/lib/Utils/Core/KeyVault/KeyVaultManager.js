/**
 * KeyVaultManager — provider selection, gating and lifecycle for field
 * encryption at rest.
 *
 * Gating mirrors OrionOAuthToolKit deliberately, so the two subsystems behave
 * the same way and an operator only has to learn the rule once:
 *
 *   - `allowedProviders` lists the backends whose wire contracts this release
 *     ships as verified. They initialize normally.
 *   - Every other provider is DISABLED INTERNALLY. Naming one in config is not
 *     enough; the provider's own config block must also carry
 *     `explicitAllow: true`. Without it the provider is skipped with a loud
 *     warning and encryption is treated as unavailable — it never silently
 *     half-starts.
 *
 * On top of that sits the deployment-shape rule the whole feature exists for:
 *
 *   - SINGLE INSTANCE  — may use INLINE_KEY (a key string in orion.config.js).
 *                        It is a real, supported choice for one box.
 *   - CLUSTER          — INLINE_KEY is refused. A symmetric key copied into
 *                        every node's config has no revocation, no rotation,
 *                        no audit trail, and multiplies across hosts, images
 *                        and backups. A key vault is required; without one,
 *                        encryptable fields (today: TOTP secrets) deactivate
 *                        rather than being written in plaintext or being
 *                        protected by a key that cannot be governed.
 *
 * "Deactivate" never means "lock users out" — see EncryptionKeyManager and the
 * degraded-mode handling in DeviceAuthorization/StepUpAuth: enrolled users fall
 * back to the email one-time code so 2FA is preserved and nobody is stranded.
 */

import { logger } from '../../logger.js';
import { KeyVaultError } from './KeyVaultProvider.js';
import { InlineKeyProvider } from './providers/InlineKeyProvider.js';
import { AwsKmsProvider } from './providers/AwsKmsProvider.js';
import { GcpKmsProvider } from './providers/GcpKmsProvider.js';
import { AzureKeyVaultProvider } from './providers/AzureKeyVaultProvider.js';
import { VaultTransitProvider, OpenBaoTransitProvider } from './providers/VaultTransitProvider.js';
import { AkeylessProvider } from './providers/AkeylessProvider.js';
import { InfisicalProvider } from './providers/InfisicalProvider.js';
import { HcpVaultSecretsProvider } from './providers/HcpVaultSecretsProvider.js';

/**
 * Every supported backend. HCP_VAULT is an alias of HASHICORP_VAULT because
 * HCP Vault Dedicated runs the same Vault API (operators just also set
 * `namespace: 'admin'`) — the alias exists so config reads like the product
 * that was actually purchased.
 */
const PROVIDER_REGISTRY = Object.freeze({
    INLINE_KEY: InlineKeyProvider,
    AWS_KMS: AwsKmsProvider,
    GCP_KMS: GcpKmsProvider,
    AZURE_KEY_VAULT: AzureKeyVaultProvider,
    HASHICORP_VAULT: VaultTransitProvider,
    HCP_VAULT: VaultTransitProvider,
    OPENBAO: OpenBaoTransitProvider,
    HCP_VAULT_SECRETS: HcpVaultSecretsProvider,
    AKEYLESS: AkeylessProvider,
    INFISICAL: InfisicalProvider
});

/**
 * Providers enabled without an explicit override. The rest are gated for the
 * same reason the OAuth toolkit gates its long tail: their integrations are
 * shipped but not fully exercised against a live account in this release, and
 * a key vault is not a place to discover that at 3am.
 */
const ALLOWED_PROVIDERS = Object.freeze(['INLINE_KEY', 'AWS_KMS', 'GCP_KMS', 'AZURE_KEY_VAULT', 'HASHICORP_VAULT', 'HCP_VAULT', 'OPENBAO']);

/** Providers that keep the KEK out of this process entirely. */
const REMOTE_CRYPTO_PROVIDERS = Object.freeze(['AWS_KMS', 'GCP_KMS', 'AZURE_KEY_VAULT', 'HASHICORP_VAULT', 'HCP_VAULT', 'OPENBAO', 'AKEYLESS', 'INFISICAL']);

class KeyVaultManager {
    constructor(config = {}, { clusterMode = false } = {}) {
        this.config = config || {};
        this.clusterMode = clusterMode === true;

        this.provider = null;
        this.providerId = null;
        this.available = false;

        /** Why encryption is unavailable, when it is. Surfaced to operators verbatim. */
        this.unavailableReason = null;

        this.lastHealth = null;
    }

    static get supportedProviders() {
        return Object.keys(PROVIDER_REGISTRY);
    }

    static get allowedProviders() {
        return [...ALLOWED_PROVIDERS];
    }

    static isRemoteCrypto(providerId) {
        return REMOTE_CRYPTO_PROVIDERS.includes(String(providerId || '').toUpperCase());
    }

    /**
     * Resolves the configured provider id. Absent-but-key-present is treated as
     * INLINE_KEY so deployments written against the pre-vault config keep
     * working untouched.
     */
    _resolveProviderId() {
        const explicit = this.config.provider;

        if (explicit) return String(explicit).toUpperCase().trim();
        if (this.config.key) return 'INLINE_KEY';

        return null;
    }

    /**
     * Builds the provider, applying both gates. Returns null (never throws) when
     * a gate refuses — an unavailable vault degrades the deployment, it does not
     * crash it, and the reason is always recorded on `unavailableReason`.
     */
    _buildProvider() {
        const providerId = this._resolveProviderId();

        if (!providerId) {
            this.unavailableReason =
                'utilities.dataEncryption is not configured. Encryptable fields (TOTP secrets) are deactivated: ' +
                'set utilities.dataEncryption.provider to a key vault, or utilities.dataEncryption.key on a single-instance deployment.';
            return null;
        }

        const ProviderClass = PROVIDER_REGISTRY[providerId];

        if (!ProviderClass) {
            this.unavailableReason = `utilities.dataEncryption.provider "${providerId}" is not a supported provider. Supported: ${KeyVaultManager.supportedProviders.join(', ')}.`;
            return null;
        }

        // ── Gate 1: internal allowlist + explicitAllow ───────────────────────
        if (!ALLOWED_PROVIDERS.includes(providerId) && this.config.explicitAllow !== true) {
            this.unavailableReason =
                `The "${providerId}" key vault integration is disabled in this release as it has not been fully tested against a live account. ` +
                'You may override this by setting `explicitAllow: true` in utilities.dataEncryption.';
            logger.warn(`KeyVault: ${this.unavailableReason}`);
            return null;
        }

        // ── Gate 2: deployment shape ─────────────────────────────────────────
        if (providerId === 'INLINE_KEY' && this.clusterMode) {
            this.unavailableReason =
                'utilities.dataEncryption.key (inline key mode) is refused in cluster mode: a symmetric key copied into every node cannot be revoked, ' +
                'rotated or audited. Configure a key vault provider, or run single-instance.';
            return null;
        }

        try {
            return new ProviderClass({ ...this.config, provider: providerId });
        } catch (error) {
            // Constructor-time failures are configuration errors (missing region,
            // key name, credentials) — report them, do not crash the boot.
            this.unavailableReason = error instanceof KeyVaultError ? error.message : `Could not construct the ${providerId} provider: ${error.message}`;
            return null;
        }
    }

    /**
     * Selects, constructs, initializes and health-checks the provider.
     * Never throws: the caller decides what an unavailable vault means, and for
     * Orion that is "deactivate encryptable fields", not "fail to start".
     *
     * @returns {Promise<boolean>} whether encryption is available
     */
    async initialize() {
        const provider = this._buildProvider();

        if (!provider) {
            this.available = false;
            return false;
        }

        this.provider = provider;
        this.providerId = provider.id;

        try {
            await provider.initialize();
        } catch (error) {
            this.available = false;
            this.unavailableReason = `${provider.displayName} could not be initialized: ${error.message}`;
            logger.error(`KeyVault: ${this.unavailableReason}`);
            return false;
        }

        // A vault that authenticates but cannot actually unwrap is the failure
        // that must never reach production traffic, so the boot check is a real
        // wrap/unwrap round trip rather than a metadata read.
        const health = await provider.health();
        this.lastHealth = health;

        if (!health.ok) {
            this.available = false;
            this.unavailableReason = `${provider.displayName} failed its wrap/unwrap round trip: ${health.error}`;
            logger.error(`KeyVault: ${this.unavailableReason}`);
            return false;
        }

        this.available = true;
        this.unavailableReason = null;

        if (provider.mode === 'material') {
            logger.warn(
                `KeyVault: ${provider.displayName} is a key-material provider — the key encryption key is held in this process's memory. ` +
                    'A provider that performs the crypto remotely (AWS KMS, Cloud KMS, Azure Key Vault, Vault/OpenBao transit) is stronger where available.'
            );
        }

        logger.info(`KeyVault: ${provider.displayName} ready (${health.latencyMs}ms round trip, key ${provider.keyRef})`);

        return true;
    }

    /** Wraps a DEK. Throws when encryption is unavailable — callers gate on `available`. */
    async wrapKey(dek) {
        this._assertAvailable();
        return this.provider.wrapKey(dek);
    }

    async unwrapKey(blob, metadata = {}) {
        this._assertAvailable();
        return this.provider.unwrapKey(blob, metadata);
    }

    async rotateKek() {
        this._assertAvailable();
        return this.provider.rotateKek();
    }

    _assertAvailable() {
        if (!this.available || !this.provider) {
            throw new KeyVaultError('KEYVAULT::UNAVAILABLE', this.unavailableReason || 'No key vault is available on this node', { provider: this.providerId });
        }
    }

    /** Live round trip against the vault — used by the orchestrator status command. */
    async checkHealth() {
        if (!this.provider) {
            return { ok: false, provider: null, displayName: null, keyRef: null, keyVersion: null, latencyMs: 0, error: this.unavailableReason };
        }

        this.lastHealth = await this.provider.health();
        return this.lastHealth;
    }

    /** Non-secret summary, safe for the admin panel, CLI and logs. */
    describe() {
        return {
            available: this.available,
            provider: this.providerId,
            displayName: this.provider?.displayName || null,
            mode: this.provider?.mode || null,
            keyRef: this.provider?.keyRef || null,
            capabilities: this.provider?.capabilities || null,
            clusterMode: this.clusterMode,
            reason: this.unavailableReason,
            lastHealth: this.lastHealth
        };
    }

    async close() {
        await this.provider?.close?.();
    }
}

export { KeyVaultManager, PROVIDER_REGISTRY, ALLOWED_PROVIDERS, REMOTE_CRYPTO_PROVIDERS };
