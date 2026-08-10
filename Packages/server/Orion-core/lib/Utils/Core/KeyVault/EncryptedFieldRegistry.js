/**
 * EncryptedFieldRegistry — the single, declarative list of every column in the
 * Orion schema that holds vault-encrypted data.
 *
 * Everything that operates across encrypted data reads this list rather than
 * hard-coding table names:
 *
 *   - DEK rotation walks it to find rows that still carry an older envelope;
 *   - the orchestrator's wipe action walks it to clear unrecoverable data;
 *   - the key-vault status report walks it to count sealed rows;
 *   - a new encryptable field becomes a registry entry plus a model that calls
 *     the key manager, with no changes to any of the above.
 *
 * `deactivates` names the feature that must switch off when encryption is
 * unavailable. It is what makes "future encryptable fields are deactivated"
 * mechanical instead of a promise: each entry declares its own blast radius.
 */

const ENCRYPTED_FIELDS = Object.freeze([
    Object.freeze({
        id: 'totp-secrets',
        label: 'TOTP 2FA secrets',
        table: 'user_totp',
        primaryKey: 'user_uid',
        columns: Object.freeze(['secret', 'pending_secret']),

        /** Feature disabled when these values cannot be decrypted. */
        deactivates: 'totp',

        /**
         * Clearing TOTP must also drop the enabled flag, otherwise accounts are
         * left claiming a second factor whose secret no longer exists.
         */
        wipeStatement: `UPDATE user_totp
                           SET enabled = false, secret = NULL, pending_secret = NULL, updated_at = NOW()
                         WHERE secret IS NOT NULL OR pending_secret IS NOT NULL OR enabled = true`,

        /**
         * Applied alongside the wipe: the account-level 2FA flag lives on a
         * different table and would otherwise disagree with user_totp.
         */
        wipeCompanionStatements: Object.freeze([
            `UPDATE user_security
                SET two_fa_enabled = false
              WHERE user_uid IN (SELECT user_uid FROM user_totp)
                AND NOT EXISTS (SELECT 1 FROM user_passkeys WHERE user_passkeys.user_uid = user_security.user_uid)`
        ]),

        wipeDescription: 'Every user with TOTP enabled loses it and must re-enroll an authenticator app on next sign-in.'
    })
]);

/** @returns {object|null} */
const getEncryptedField = id => ENCRYPTED_FIELDS.find(field => field.id === id) || null;

/** Features that deactivate when encryption is unavailable, de-duplicated. */
const deactivatedFeatures = () => [...new Set(ENCRYPTED_FIELDS.map(field => field.deactivates).filter(Boolean))];

export { ENCRYPTED_FIELDS, getEncryptedField, deactivatedFeatures };
