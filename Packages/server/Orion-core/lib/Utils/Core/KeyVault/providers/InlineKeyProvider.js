import { MaterialKeyVaultProvider, KeyVaultError } from '../KeyVaultProvider.js';

/**
 * INLINE_KEY — the legacy, vault-less mode: the key encryption key is a string
 * in `orion.config.js`.
 *
 * It is kept as a first-class provider (rather than a special case scattered
 * through the manager) so that a single-instance deployment travels the exact
 * same envelope-encryption code path as a vault-backed one. Moving from an
 * inline key to a real vault is then a config change plus a DEK re-wrap, not a
 * data migration.
 *
 * It is REFUSED in cluster mode. A shared symmetric key copied into every
 * node's config file is precisely the risk the vault work exists to remove:
 * it has no revocation story, no audit trail, no rotation, and it multiplies
 * across hosts, images and backups. Single-instance deployments may still use
 * it deliberately — see KeyVaultManager's cluster gate.
 */
class InlineKeyProvider extends MaterialKeyVaultProvider {
    static id = 'INLINE_KEY';
    static displayName = 'Inline configuration key';

    static configSchema = { required: ['key'] };

    get capabilities() {
        return { mode: 'material', rotateKek: false, keyVersions: false, aad: true };
    }

    get keyRef() {
        return 'config:utilities.dataEncryption.key';
    }

    async fetchKeyMaterial() {
        const key = this.config.key;

        if (!key) {
            throw new KeyVaultError('KEYVAULT::INVALID-CONFIG', 'Inline key mode requires utilities.dataEncryption.key', { provider: this.id });
        }

        if (String(key).length < 32) {
            throw new KeyVaultError(
                'KEYVAULT::WEAK-KEY-MATERIAL',
                'utilities.dataEncryption.key must be at least 32 characters. It is the root of all field encryption on this node — generate it with `openssl rand -base64 48`, do not hand-pick it.',
                { provider: this.id }
            );
        }

        return { material: key, version: null };
    }

    async rotateKek() {
        return {
            rotated: false,
            keyVersion: null,
            reason: 'The inline configuration key cannot be rotated through the API — change utilities.dataEncryption.key and restart, then rotate the DEK. Configure a key vault to rotate without a restart.'
        };
    }
}

export { InlineKeyProvider };
