/**
 * Key vault subsystem — encryption at rest for Orion's encryptable fields.
 *
 * Read KeyVaultManager.js first: it documents the two gates (internal
 * allowlist + explicitAllow, and single-instance vs. cluster) that decide
 * whether encryption is available at all. EncryptionKeyManager.js documents
 * the envelope format and the DEK lifecycle sitting on top of it.
 */

export { KeyVaultManager, PROVIDER_REGISTRY, ALLOWED_PROVIDERS, REMOTE_CRYPTO_PROVIDERS } from './KeyVaultManager.js';
export { EncryptionKeyManager, ENVELOPE_PREFIX, LEGACY_PREFIX } from './EncryptionKeyManager.js';
export { ENCRYPTED_FIELDS, getEncryptedField, deactivatedFeatures } from './EncryptedFieldRegistry.js';
export { validateDataEncryptionConfig } from './configSchema.js';
export { KeyVaultProvider, MaterialKeyVaultProvider, KeyVaultError, DEK_BYTES } from './KeyVaultProvider.js';
