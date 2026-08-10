// logger.js must be evaluated before GlobalAccessPoint.js (circular; see fileResponse.test.js).
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { validateDataEncryptionConfig, COMMON_KEYS, knownKeysFor } from '../../../../Packages/server/Orion-core/lib/Utils/Core/KeyVault/configSchema.js';
import { PROVIDER_REGISTRY, ALLOWED_PROVIDERS } from '../../../../Packages/server/Orion-core/lib/Utils/Core/KeyVault/KeyVaultManager.js';

/**
 * Structural config validation.
 *
 * The property under test throughout: an operator MISTAKE must be reported as a
 * mistake, not absorbed into "encryption unavailable". A typo will never fix
 * itself, so it has to stop the boot.
 */

const AWS = { provider: 'AWS_KMS', region: 'eu-west-1', keyId: 'arn:aws:kms:eu-west-1:1:key/abc' };
const INLINE = { provider: 'INLINE_KEY', key: 'a-key-that-is-at-least-32-characters-long' };

const clearedEnv = [];

const setEnv = (name, value) => {
    clearedEnv.push(name);
    process.env[name] = value;
};

afterEach(() => {
    for (const name of clearedEnv.splice(0)) delete process.env[name];
});

describe('dataEncryption schema — provider coverage', () => {
    test('every registered provider declares a config schema', () => {
        // The drift guard. A new provider without a schema would silently accept
        // any key, which is exactly the hole this validation closes.
        for (const [id, ProviderClass] of Object.entries(PROVIDER_REGISTRY)) {
            assert.ok(ProviderClass.configSchema, `${id} declares a static configSchema`);

            const schema = ProviderClass.configSchema;
            const hasRequirements = (schema.required?.length || 0) > 0 || (schema.oneOf?.length || 0) > 0;

            assert.ok(hasRequirements, `${id} declares at least one required key or either/or group`);
        }
    });

    test('a valid config for every non-gated provider passes', () => {
        const valid = {
            INLINE_KEY: INLINE,
            AWS_KMS: AWS,
            GCP_KMS: { provider: 'GCP_KMS', projectId: 'p', location: 'global', keyRing: 'r', keyName: 'k' },
            AZURE_KEY_VAULT: { provider: 'AZURE_KEY_VAULT', vaultUrl: 'https://v.vault.azure.net', keyName: 'k' },
            HASHICORP_VAULT: { provider: 'HASHICORP_VAULT', address: 'https://vault:8200', keyName: 'k', token: 't' },
            HCP_VAULT: { provider: 'HCP_VAULT', address: 'https://vault:8200', keyName: 'k', token: 't', namespace: 'admin' },
            OPENBAO: { provider: 'OPENBAO', address: 'https://bao:8200', keyName: 'k', roleId: 'r', secretId: 's' }
        };

        for (const id of ALLOWED_PROVIDERS) {
            const result = validateDataEncryptionConfig(valid[id], { clusterMode: false });
            assert.equal(result.valid, true, `${id}: ${result.errors.join('; ')}`);
            assert.equal(result.providerId, id);
        }
    });
});

describe('dataEncryption schema — typo detection', () => {
    test('the reported gap: a misspelled key is rejected, not silently ignored', () => {
        // Previously this degraded to plaintext-with-a-warning; now it is caught.
        const result = validateDataEncryptionConfig({ provider: 'INLINE_KEY', secret: 'oops' }, { clusterMode: false });

        assert.equal(result.valid, false);
        assert.ok(result.errors.some(error => error.includes('secret') && error.includes('not a recognized key')));
    });

    test('a near-miss key names the correction', () => {
        const result = validateDataEncryptionConfig({ ...AWS, keyid: 'x' }, { clusterMode: false });

        assert.equal(result.valid, false);
        assert.ok(
            result.errors.some(error => error.includes('did you mean "keyId"')),
            result.errors.join('; ')
        );
    });

    test('a wrong-case key is corrected', () => {
        const result = validateDataEncryptionConfig({ provider: 'AWS_KMS', Region: 'eu-west-1', keyId: 'k' }, { clusterMode: false });

        assert.ok(result.errors.some(error => error.includes('did you mean "region"')));
    });

    test('a key valid for ANOTHER provider is rejected for this one', () => {
        // vaultUrl is real, just not an AWS concept — the sort of copy-paste
        // error that otherwise looks like a working config.
        const result = validateDataEncryptionConfig({ ...AWS, vaultUrl: 'https://v.vault.azure.net' }, { clusterMode: false });

        assert.equal(result.valid, false);
        assert.ok(result.errors.some(error => error.includes('vaultUrl')));
    });

    test('a misspelled provider name is caught even before a provider resolves', () => {
        const result = validateDataEncryptionConfig({ providor: 'AWS_KMS' }, { clusterMode: false });

        assert.equal(result.valid, false);
        assert.ok(result.errors.some(error => error.includes('did you mean "provider"')));
    });

    test('an unknown provider value suggests the closest real one', () => {
        const result = validateDataEncryptionConfig({ provider: 'AWS_KSM' }, { clusterMode: false });

        assert.equal(result.valid, false);
        assert.ok(
            result.errors.some(error => error.includes('did you mean "AWS_KMS"')),
            result.errors.join('; ')
        );
    });

    test('legitimate optional keys are accepted', () => {
        assert.equal(validateDataEncryptionConfig({ ...AWS, endpoint: 'https://kms.local', timeoutMs: 5000 }, {}).valid, true);
    });
});

describe('dataEncryption schema — required keys and either/or groups', () => {
    test('a missing required key is named', () => {
        const result = validateDataEncryptionConfig({ provider: 'AWS_KMS', region: 'eu-west-1' }, {});

        assert.equal(result.valid, false);
        assert.ok(result.errors.some(error => error.includes('keyId') && error.includes('required')));
    });

    test('an environment variable satisfies a required key', () => {
        setEnv('AWS_REGION', 'eu-west-1');

        assert.equal(validateDataEncryptionConfig({ provider: 'AWS_KMS', keyId: 'arn:…' }, {}).valid, true);
    });

    test('a missing required key mentions the env var that would satisfy it', () => {
        const result = validateDataEncryptionConfig({ provider: 'AWS_KMS', keyId: 'arn:…' }, {});

        assert.ok(result.errors.some(error => error.includes('AWS_REGION')));
    });

    test('Vault accepts either a token or AppRole, but demands one', () => {
        const base = { provider: 'HASHICORP_VAULT', address: 'https://vault:8200', keyName: 'k' };

        assert.equal(validateDataEncryptionConfig({ ...base, token: 't' }, {}).valid, true);
        assert.equal(validateDataEncryptionConfig({ ...base, roleId: 'r', secretId: 's' }, {}).valid, true);

        const neither = validateDataEncryptionConfig(base, {});
        assert.equal(neither.valid, false);
        assert.ok(neither.errors.some(error => error.includes('needs one of')));
    });

    test('a half-filled either/or group names exactly what is missing', () => {
        // The specific mistake — "I set roleId and forgot secretId" — deserves a
        // better message than "needs one of".
        const result = validateDataEncryptionConfig({ provider: 'HASHICORP_VAULT', address: 'https://vault:8200', keyName: 'k', roleId: 'r' }, {});

        assert.equal(result.valid, false);
        assert.ok(
            result.errors.some(error => error.includes('roleId') && error.includes('secretId') && error.includes('missing')),
            result.errors.join('; ')
        );
    });

    test('GCP accepts a full resource name or the four parts', () => {
        assert.equal(validateDataEncryptionConfig({ provider: 'GCP_KMS', cryptoKey: 'projects/p/locations/l/keyRings/r/cryptoKeys/k' }, {}).valid, true);

        const partial = validateDataEncryptionConfig({ provider: 'GCP_KMS', projectId: 'p', location: 'l' }, {});
        assert.equal(partial.valid, false);
        assert.ok(partial.errors.some(error => error.includes('keyRing')));
    });
});

describe('dataEncryption schema — gates are fatal, not degrading', () => {
    test('INLINE_KEY in cluster mode is a configuration error', () => {
        const result = validateDataEncryptionConfig(INLINE, { clusterMode: true });

        assert.equal(result.valid, false);
        assert.ok(result.errors.some(error => error.includes('refused in cluster mode')));
    });

    test('INLINE_KEY on a single instance is fine', () => {
        assert.equal(validateDataEncryptionConfig(INLINE, { clusterMode: false }).valid, true);
    });

    test('a gated provider without explicitAllow is a configuration error', () => {
        const result = validateDataEncryptionConfig({ provider: 'AKEYLESS', keyName: 'k', accessId: 'a', accessKey: 'b' }, {});

        assert.equal(result.valid, false);
        assert.ok(result.errors.some(error => error.includes('explicitAllow')));
    });

    test('explicitAllow clears the gate', () => {
        assert.equal(validateDataEncryptionConfig({ provider: 'AKEYLESS', explicitAllow: true, keyName: 'k', accessId: 'a', accessKey: 'b' }, {}).valid, true);
    });
});

describe('dataEncryption schema — absence and shared keys', () => {
    test('an absent block is not an error — that decision belongs to the caller', () => {
        for (const value of [undefined, null, {}]) {
            const result = validateDataEncryptionConfig(value, {});
            assert.equal(result.valid, true);
            assert.equal(result.providerId, null);
        }
    });

    test('a bare key with no provider resolves to INLINE_KEY', () => {
        const result = validateDataEncryptionConfig({ key: 'a-key-that-is-at-least-32-characters-long' }, {});

        assert.equal(result.valid, true);
        assert.equal(result.providerId, 'INLINE_KEY');
    });

    test('a non-object block is rejected', () => {
        assert.equal(validateDataEncryptionConfig('AWS_KMS', {}).valid, false);
        assert.equal(validateDataEncryptionConfig([], {}).valid, false);
    });

    test('shared keys are type-checked', () => {
        assert.equal(validateDataEncryptionConfig({ ...AWS, timeoutMs: 'soon' }, {}).valid, false);
        assert.equal(validateDataEncryptionConfig({ ...AWS, explicitAllow: 'yes' }, {}).valid, false);
        assert.equal(validateDataEncryptionConfig({ ...AWS, required: 'yes' }, {}).valid, false);
    });

    test('a legacy inline key alongside a vault warns but does not fail', () => {
        const result = validateDataEncryptionConfig({ ...AWS, key: 'the-old-inline-key' }, {});

        assert.equal(result.valid, true);
        assert.ok(result.warnings.some(warning => warning.includes('legacyKey')));
    });

    test('legacyKey alongside a vault is silent — it is the documented migration path', () => {
        assert.equal(validateDataEncryptionConfig({ ...AWS, legacyKey: 'the-old-inline-key' }, {}).warnings.length, 0);
    });

    test('common keys are accepted by every provider', () => {
        for (const [id, ProviderClass] of Object.entries(PROVIDER_REGISTRY)) {
            const known = knownKeysFor(ProviderClass.configSchema || {});

            for (const key of COMMON_KEYS) {
                assert.ok(known.includes(key), `${id} accepts the shared key "${key}"`);
            }
        }
    });
});
