// logger.js must be evaluated before GlobalAccessPoint.js (circular; see fileResponse.test.js).
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { KeyVaultManager, PROVIDER_REGISTRY, ALLOWED_PROVIDERS } from '../../../../Packages/server/Orion-core/lib/Utils/Core/KeyVault/KeyVaultManager.js';
import { MaterialKeyVaultProvider, KeyVaultProvider, DEK_BYTES } from '../../../../Packages/server/Orion-core/lib/Utils/Core/KeyVault/KeyVaultProvider.js';
import { ENCRYPTED_FIELDS, getEncryptedField, deactivatedFeatures } from '../../../../Packages/server/Orion-core/lib/Utils/Core/KeyVault/EncryptedFieldRegistry.js';

const INLINE_KEY = 'unit-test-key-that-is-long-enough-to-pass-32';

describe('KeyVaultManager — provider registry', () => {
    test('every service named in the configuration guide is registered', () => {
        for (const id of [
            'INLINE_KEY',
            'AWS_KMS',
            'GCP_KMS',
            'AZURE_KEY_VAULT',
            'HASHICORP_VAULT',
            'HCP_VAULT',
            'OPENBAO',
            'HCP_VAULT_SECRETS',
            'AKEYLESS',
            'INFISICAL'
        ]) {
            assert.ok(PROVIDER_REGISTRY[id], `${id} is registered`);
        }
    });

    test('every registered provider implements the normalized contract', () => {
        for (const [id, ProviderClass] of Object.entries(PROVIDER_REGISTRY)) {
            assert.ok(ProviderClass.prototype instanceof KeyVaultProvider, `${id} extends KeyVaultProvider`);

            for (const method of ['initialize', 'wrapKey', 'unwrapKey', 'rotateKek', 'health']) {
                assert.equal(typeof ProviderClass.prototype[method], 'function', `${id}.${method} exists`);
            }
        }
    });

    test('HCP_VAULT is an alias of the Vault transit implementation', () => {
        // HCP Vault Dedicated runs the same API; the separate id exists so
        // config reads like the product the operator actually bought.
        assert.equal(PROVIDER_REGISTRY.HCP_VAULT, PROVIDER_REGISTRY.HASHICORP_VAULT);
    });
});

describe('KeyVaultManager — gating', () => {
    test('providers outside the verified allowlist are disabled without explicitAllow', async () => {
        const gated = Object.keys(PROVIDER_REGISTRY).filter(id => !ALLOWED_PROVIDERS.includes(id));
        assert.ok(gated.length > 0, 'there is at least one gated provider to test');

        for (const id of gated) {
            const vault = new KeyVaultManager({ provider: id }, { clusterMode: false });

            assert.equal(await vault.initialize(), false, `${id} is refused by default`);
            assert.match(vault.unavailableReason, /disabled in this release/);
            assert.match(vault.unavailableReason, /explicitAllow/);
        }
    });

    test('explicitAllow lets a gated provider past the allowlist (and it then fails on its own config)', async () => {
        const vault = new KeyVaultManager({ provider: 'AKEYLESS', explicitAllow: true }, { clusterMode: false });

        assert.equal(await vault.initialize(), false);
        // Past the gate: the complaint is now about missing credentials rather
        // than about the provider being disabled.
        assert.doesNotMatch(vault.unavailableReason, /disabled in this release/);
        assert.match(vault.unavailableReason, /required/i);
    });

    test('an unknown provider names the supported set instead of failing vaguely', async () => {
        const vault = new KeyVaultManager({ provider: 'MY_HOMEMADE_VAULT' }, { clusterMode: false });

        assert.equal(await vault.initialize(), false);
        assert.match(vault.unavailableReason, /not a supported provider/);
        assert.match(vault.unavailableReason, /AWS_KMS/);
    });

    test('a bare key with no provider is read as INLINE_KEY (pre-vault configs keep working)', async () => {
        const vault = new KeyVaultManager({ key: INLINE_KEY }, { clusterMode: false });

        assert.equal(await vault.initialize(), true);
        assert.equal(vault.providerId, 'INLINE_KEY');
    });

    test('an inline key shorter than 32 characters is refused', async () => {
        const vault = new KeyVaultManager({ provider: 'INLINE_KEY', key: 'too-short' }, { clusterMode: false });

        assert.equal(await vault.initialize(), false);
        assert.match(vault.unavailableReason, /at least 32 characters/);
    });

    test('describe() reports status without leaking key material', async () => {
        const vault = new KeyVaultManager({ provider: 'INLINE_KEY', key: INLINE_KEY }, { clusterMode: false });
        await vault.initialize();

        const described = JSON.stringify(vault.describe());

        assert.match(described, /INLINE_KEY/);
        assert.ok(!described.includes(INLINE_KEY), 'the configured key never appears in the status payload');
    });
});

describe('KeyVaultProvider — health round trip', () => {
    /** A vault that authenticates and answers, but returns the wrong key back. */
    class LyingProvider extends MaterialKeyVaultProvider {
        static id = 'LYING_VAULT';
        static displayName = 'Lying vault';

        get keyRef() {
            return 'test:lying';
        }

        async fetchKeyMaterial() {
            return { material: INLINE_KEY, version: '1' };
        }

        async unwrapKey() {
            return crypto.randomBytes(DEK_BYTES);
        }
    }

    test('health() catches a vault that returns different material than it was given', async () => {
        // The whole point of making the boot check a real wrap/unwrap round trip
        // rather than a metadata read: a vault can answer GET /key perfectly and
        // still be unable to return your data.
        const provider = new LyingProvider({ key: INLINE_KEY });
        await provider.initialize();

        const health = await provider.health();

        assert.equal(health.ok, false);
        assert.match(health.error, /round-trip mismatch/);
    });

    test('health() passes for a provider that round-trips correctly', async () => {
        class HonestProvider extends LyingProvider {
            static id = 'HONEST_VAULT';
            static displayName = 'Honest vault';

            async unwrapKey(blob, metadata) {
                return MaterialKeyVaultProvider.prototype.unwrapKey.call(this, blob, metadata);
            }
        }

        const provider = new HonestProvider({ key: INLINE_KEY });
        await provider.initialize();

        const health = await provider.health();

        assert.equal(health.ok, true, health.error || '');
        assert.equal(health.provider, 'HONEST_VAULT');
    });

    test('material providers reject weak stored key material', async () => {
        class WeakProvider extends LyingProvider {
            async fetchKeyMaterial() {
                return { material: 'short', version: null };
            }
        }

        await assert.rejects(() => new WeakProvider({}).initialize(), error => error.code === 'KEYVAULT::WEAK-KEY-MATERIAL');
    });
});

describe('EncryptedFieldRegistry', () => {
    test('every entry declares the feature it deactivates and how to wipe itself', () => {
        for (const field of ENCRYPTED_FIELDS) {
            assert.ok(field.id, 'has an id');
            assert.ok(field.table, `${field.id} names its table`);
            assert.ok(field.primaryKey, `${field.id} names its primary key`);
            assert.ok(Array.isArray(field.columns) && field.columns.length > 0, `${field.id} lists its columns`);
            assert.ok(field.deactivates, `${field.id} declares its blast radius`);
            assert.ok(field.wipeStatement, `${field.id} knows how to clear itself`);
            assert.ok(field.wipeDescription, `${field.id} can explain the consequence to an operator`);
        }
    });

    test('the TOTP entry clears the enabled flag alongside the secrets', () => {
        const totp = getEncryptedField('totp-secrets');

        assert.ok(totp);
        // Nulling secrets without clearing `enabled` would leave accounts
        // claiming a second factor whose secret no longer exists.
        assert.match(totp.wipeStatement, /enabled\s*=\s*false/);
        assert.match(totp.wipeStatement, /secret\s*=\s*NULL/);
    });

    test('deactivatedFeatures() reports TOTP', () => {
        assert.deepEqual(deactivatedFeatures(), ['totp']);
    });
});
