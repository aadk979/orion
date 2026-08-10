/**
 * EncryptionKeyManager — the data encryption key (DEK) lifecycle, and the
 * seal/open primitives every encryptable field uses.
 *
 * ┌─ vault ────────────┐        ┌─ orion_encryption_keys (postgres) ─┐
 * │ KEK (never leaves) │ wraps  │ version 3  wrapped_key  ACTIVE     │
 * └────────────────────┘ ─────► │ version 2  wrapped_key  retired    │
 *                               │ version 1  wrapped_key  retired    │
 *                               └────────────────────────────────────┘
 *                                          unwrapped in memory, per version
 *                                                      │
 *                                                      ▼
 *                                    enc.v2.<dekVersion>.<iv>.<tag>.<ct>
 *
 * Why a DEK at all, rather than asking the vault to encrypt each secret:
 *
 *   - every TOTP read would otherwise be a network round trip to the vault,
 *     on the login path;
 *   - vault rate limits and outages would become auth outages;
 *   - KEK rotation stays free (re-wrap ~1 small blob) while remaining fully
 *     effective, because the DEK is useless without it.
 *
 * Three envelope generations are readable, and each is upgraded on next write:
 *
 *   (none)     — pre-encryption plaintext rows
 *   enc.v1.…   — the original inline-key format, AES-256-GCM under
 *                sha256(utilities.dataEncryption.key)
 *   enc.v2.N.… — vault-backed, AES-256-GCM under DEK version N
 *
 * When no key vault is available, seal() REFUSES rather than silently writing
 * plaintext. That refusal is the mechanism behind "encryptable fields
 * deactivate": callers surface it as a disabled feature, and enrolled users
 * fall back to the email one-time code instead of being locked out.
 */

import crypto from 'crypto';
import { logger } from '../../logger.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { KeyVaultError, DEK_BYTES } from './KeyVaultProvider.js';
import { ENCRYPTED_FIELDS } from './EncryptedFieldRegistry.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'EncryptionKeyManager.js');
const query = (text, params) => dbModule.getModule().query(text, params);

const LEGACY_PREFIX = 'enc.v1.';
const ENVELOPE_PREFIX = 'enc.v2.';

/** Rows re-encrypted per statement during a DEK rotation. Bounds lock time. */
const REENCRYPT_BATCH_SIZE = 500;

class EncryptionKeyManager {
    constructor(vaultManager, { legacyKey = null } = {}) {
        this.vault = vaultManager;

        // Unwrapped DEKs, keyed by version. Memory only — never logged, never
        // persisted, never sent over the cluster link.
        this._deks = new Map();
        this._activeVersion = null;
        this._activeMeta = null;

        // sha256 of the pre-vault inline key, retained ONLY to read enc.v1. rows
        // written before this deployment adopted a vault. Rotation removes the
        // last of them, after which it can be dropped from config.
        this._legacyKey = legacyKey ? crypto.createHash('sha256').update(String(legacyKey)).digest() : null;

        this.ready = false;
        this.unavailableReason = null;
    }

    get available() {
        return this.ready === true;
    }

    get activeVersion() {
        return this._activeVersion;
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /**
     * Loads (or creates) the active DEK. Never throws: an unavailable vault
     * deactivates encryptable fields, it does not stop the node.
     *
     * @returns {Promise<boolean>} whether sealing is available
     */
    async initialize() {
        if (!this.vault?.available) {
            this.ready = false;
            this.unavailableReason = this.vault?.unavailableReason || 'No key vault is configured on this node';
            return false;
        }

        try {
            const active = await this._loadActiveRecord();

            if (active) {
                this._deks.set(active.version, await this._unwrap(active));
                this._activeVersion = active.version;
                this._activeMeta = active;
                logger.info(`EncryptionKeyManager: data encryption key v${active.version} loaded (wrapped by ${active.provider})`);
            } else {
                const created = await this._createDek();
                logger.warn(`EncryptionKeyManager: no data encryption key existed — generated v${created.version} and wrapped it with ${created.provider}`);
            }

            this.ready = true;
            this.unavailableReason = null;
            return true;
        } catch (error) {
            this.ready = false;
            this.unavailableReason = error instanceof KeyVaultError ? error.message : `Data encryption key could not be prepared: ${error.message}`;
            logger.error(`EncryptionKeyManager: ${this.unavailableReason}`);
            return false;
        }
    }

    async _loadActiveRecord() {
        const result = await query(`SELECT * FROM orion_encryption_keys WHERE state = 'active' ORDER BY version DESC LIMIT 1`);
        return result.rows[0] ? this._toRecord(result.rows[0]) : null;
    }

    async _loadRecord(version) {
        const result = await query('SELECT * FROM orion_encryption_keys WHERE version = $1', [version]);
        return result.rows[0] ? this._toRecord(result.rows[0]) : null;
    }

    _toRecord(row) {
        return {
            version: Number(row.version),
            wrappedKey: row.wrapped_key,
            provider: row.provider,
            keyRef: row.key_ref,
            kekVersion: row.kek_version,
            algorithm: row.algorithm,
            state: row.state
        };
    }

    async _unwrap(record) {
        // A DEK wrapped by a DIFFERENT provider than the one now configured
        // cannot be unwrapped — say so precisely instead of surfacing a generic
        // decrypt failure, because the fix (point the config back, or wipe) is
        // entirely different from a transient vault error.
        if (record.provider !== this.vault.providerId) {
            throw new KeyVaultError(
                'KEYVAULT::PROVIDER-MISMATCH',
                `Data encryption key v${record.version} was wrapped by ${record.provider} (${record.keyRef}) but this node is configured for ${this.vault.providerId}. ` +
                    'Point utilities.dataEncryption back at the original vault, or wipe the encrypted fields from the orchestrator and let users re-enroll.',
                { provider: this.vault.providerId }
            );
        }

        return this.vault.unwrapKey(record.wrappedKey, { keyRef: record.keyRef, keyVersion: record.kekVersion });
    }

    /**
     * Generates, wraps and persists a fresh DEK, retiring whatever was active.
     *
     * The retire and the insert are ONE transaction. Split across two
     * autocommits, a crash in between leaves the ledger with no active row at
     * all, and — worse — a concurrently booting node would see that gap and mint
     * a second key. Wrapping happens before BEGIN so a slow vault call never
     * holds a write transaction open.
     */
    async _createDek() {
        const dek = crypto.randomBytes(DEK_BYTES);
        const wrapped = await this.vault.wrapKey(dek);

        const client = await dbModule.getModule().getPool().connect();
        let inserted;

        try {
            await client.query('BEGIN');

            const next = await client.query('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM orion_encryption_keys');
            const version = Number(next.rows[0].version);

            // Retire first: the partial unique index permits exactly one active
            // row, so this ordering is what makes concurrent creation safe rather
            // than deadlocked — a loser sees the winner's row and adopts it.
            await client.query(`UPDATE orion_encryption_keys SET state = 'retired', retired_at = NOW() WHERE state = 'active'`);

            inserted = await client.query(
                `INSERT INTO orion_encryption_keys (version, wrapped_key, provider, key_ref, kek_version, algorithm, state)
                 VALUES ($1, $2, $3, $4, $5, $6, 'active')
                 ON CONFLICT (version) DO NOTHING
                 RETURNING *`,
                [version, wrapped.blob, this.vault.providerId, wrapped.keyRef, wrapped.keyVersion, wrapped.algorithm]
            );

            // A no-op insert means another node won; roll back so its active row
            // is not left retired by this transaction's UPDATE.
            await client.query(inserted.rowCount === 0 ? 'ROLLBACK' : 'COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        if (inserted.rowCount === 0) {
            // Another node won the race — adopt its key rather than fighting it.
            const active = await this._loadActiveRecord();
            if (!active) throw new KeyVaultError('KEYVAULT::KEY-RACE', 'Lost a data-encryption-key creation race but no active key is present');

            this._deks.set(active.version, await this._unwrap(active));
            this._activeVersion = active.version;
            this._activeMeta = active;
            return active;
        }

        const record = this._toRecord(inserted.rows[0]);
        this._deks.set(record.version, dek);
        this._activeVersion = record.version;
        this._activeMeta = record;

        return record;
    }

    /** Unwraps and caches a historical DEK on demand. */
    async _dekFor(version) {
        if (this._deks.has(version)) return this._deks.get(version);

        const record = await this._loadRecord(version);

        if (!record) {
            throw new KeyVaultError('KEYVAULT::UNKNOWN-KEY-VERSION', `Data encryption key v${version} is referenced by stored data but no longer exists`);
        }

        const dek = await this._unwrap(record);
        this._deks.set(version, dek);
        return dek;
    }

    // ── Seal / open ──────────────────────────────────────────────────────────

    /**
     * Encrypts a value for storage.
     * @throws {KeyVaultError} when encryption is unavailable — callers treat
     *         this as "this feature is deactivated", never as "store plaintext".
     */
    async seal(plain) {
        if (plain === null || plain === undefined) return plain;

        if (!this.ready) {
            throw new KeyVaultError('KEYVAULT::UNAVAILABLE', this.unavailableReason || 'Field encryption is unavailable on this node');
        }

        const dek = this._deks.get(this._activeVersion);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);

        // The DEK version is authenticated, so a stored envelope cannot be
        // re-pointed at a different key version by editing the database.
        cipher.setAAD(Buffer.from(`${ENVELOPE_PREFIX}${this._activeVersion}`, 'utf8'));

        const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();

        return `${ENVELOPE_PREFIX}${this._activeVersion}.${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
    }

    /**
     * Decrypts a stored value across all three envelope generations.
     *
     * @returns {Promise<string|null>} the plaintext, or null when the value
     *          exists but cannot be decrypted on this node. Callers MUST treat
     *          null as "unavailable" and degrade — throwing here would turn a
     *          key problem into a 500 on the login path.
     */
    async open(stored) {
        if (stored === null || stored === undefined) return stored;

        const value = String(stored);

        // Pre-encryption plaintext. Re-sealed on the next write.
        if (!value.startsWith(LEGACY_PREFIX) && !value.startsWith(ENVELOPE_PREFIX)) return value;

        try {
            return value.startsWith(LEGACY_PREFIX) ? this._openLegacy(value) : await this._openEnvelope(value);
        } catch (error) {
            logger.error(`EncryptionKeyManager: a stored encrypted value could not be decrypted — ${error.message}`);
            return null;
        }
    }

    _openLegacy(value) {
        if (!this._legacyKey) {
            throw new KeyVaultError(
                'KEYVAULT::LEGACY-KEY-MISSING',
                'Found a value sealed with the pre-vault inline key, but utilities.dataEncryption.legacyKey is not set. ' +
                    'Set it to the original key so these rows can be read and re-sealed, or wipe the affected fields.'
            );
        }

        const [ivB64, tagB64, ctB64] = value.slice(LEGACY_PREFIX.length).split('.');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this._legacyKey, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

        return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
    }

    async _openEnvelope(value) {
        const [versionPart, ivB64, tagB64, ctB64] = value.slice(ENVELOPE_PREFIX.length).split('.');
        const version = Number(versionPart);

        if (!Number.isInteger(version) || !ivB64 || !tagB64 || !ctB64) {
            throw new KeyVaultError('KEYVAULT::MALFORMED-ENVELOPE', 'Stored value is not a well-formed enc.v2 envelope');
        }

        const dek = await this._dekFor(version);
        const decipher = crypto.createDecipheriv('aes-256-gcm', dek, Buffer.from(ivB64, 'base64'));
        decipher.setAAD(Buffer.from(`${ENVELOPE_PREFIX}${version}`, 'utf8'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

        return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
    }

    /** True when a stored value is sealed with something other than the active DEK. */
    needsUpgrade(stored) {
        if (stored === null || stored === undefined) return false;
        const value = String(stored);
        if (value.startsWith(LEGACY_PREFIX)) return true;
        if (!value.startsWith(ENVELOPE_PREFIX)) return true; // plaintext legacy row
        return Number(value.slice(ENVELOPE_PREFIX.length).split('.')[0]) !== this._activeVersion;
    }

    // ── Rotation ─────────────────────────────────────────────────────────────

    /**
     * Rotates the KEK inside the vault and re-wraps the active DEK under it.
     * Stored field data is untouched — the DEK has not changed, only its
     * wrapper — so this is fast and safe to run on a schedule.
     */
    async rotateKek() {
        if (!this.ready) throw new KeyVaultError('KEYVAULT::UNAVAILABLE', this.unavailableReason || 'Field encryption is unavailable on this node');

        const outcome = await this.vault.rotateKek();
        const dek = this._deks.get(this._activeVersion);
        const rewrapped = await this.vault.wrapKey(dek);

        await query(
            `UPDATE orion_encryption_keys
                SET wrapped_key = $1, key_ref = $2, kek_version = $3, algorithm = $4, rewrapped_at = NOW()
              WHERE version = $5`,
            [rewrapped.blob, rewrapped.keyRef, rewrapped.keyVersion, rewrapped.algorithm, this._activeVersion]
        );

        this._activeMeta = { ...this._activeMeta, wrappedKey: rewrapped.blob, keyRef: rewrapped.keyRef, kekVersion: rewrapped.keyVersion };

        logger.warn(`EncryptionKeyManager: KEK rotation ${outcome.rotated ? 'completed' : 'skipped'} — DEK v${this._activeVersion} re-wrapped`);

        return {
            kekRotated: outcome.rotated === true,
            kekVersion: outcome.keyVersion,
            reason: outcome.reason,
            dekVersion: this._activeVersion,
            rewrapped: true
        };
    }

    /**
     * Rotates the DEK: a new key becomes active and every registered encrypted
     * column is re-encrypted under it in bounded batches. Retired DEKs are kept
     * so rows missed by a partial run (or written by a node mid-rollout) stay
     * readable — nothing is ever stranded by a rotation.
     */
    async rotateDek({ batchSize = REENCRYPT_BATCH_SIZE, reencrypt = true } = {}) {
        if (!this.ready) throw new KeyVaultError('KEYVAULT::UNAVAILABLE', this.unavailableReason || 'Field encryption is unavailable on this node');

        const previousVersion = this._activeVersion;
        const created = await this._createDek();

        const fields = [];

        if (reencrypt) {
            for (const field of ENCRYPTED_FIELDS) {
                fields.push(await this._reencryptField(field, batchSize));
            }
        }

        logger.warn(`EncryptionKeyManager: data encryption key rotated v${previousVersion} → v${created.version}`);

        return {
            previousVersion,
            version: created.version,
            provider: created.provider,
            fields,
            reencrypted: reencrypt
        };
    }

    /**
     * Re-seals one registered field's rows under the active DEK.
     *
     * Table and column names are interpolated rather than bound, because SQL
     * identifiers cannot be parameters. They are safe here for a structural
     * reason, not a hopeful one: every value comes from ENCRYPTED_FIELDS, a
     * frozen module-level constant that no request, config file or cluster
     * command can reach. The only caller-supplied value is batchSize, which is
     * coerced to a bounded integer below.
     */
    async _reencryptField(field, batchSize) {
        const stale = field.columns.map(column => `(${column} IS NOT NULL AND ${column} NOT LIKE '${ENVELOPE_PREFIX}${this._activeVersion}.%')`).join(' OR ');

        // Belt and braces: the orchestrator already validates this as an integer
        // ≤ 5000, but this is the point where it reaches SQL text.
        const limit = Math.min(Math.max(Number.parseInt(batchSize, 10) || REENCRYPT_BATCH_SIZE, 1), 5000);

        let processed = 0;
        let failed = 0;
        let skipped = 0;

        for (;;) {
            const batch = await query(
                `SELECT ${field.primaryKey}, ${field.columns.join(', ')}
                   FROM ${field.table}
                  WHERE ${stale}
                  LIMIT ${limit}`
            );

            if (batch.rows.length === 0) break;

            let progressed = false;

            for (const row of batch.rows) {
                const updates = [];

                for (const column of field.columns) {
                    if (row[column] === null || row[column] === undefined) continue;

                    const plain = await this.open(row[column]);

                    // Unreadable values are left exactly as they are. Overwriting
                    // them would destroy the only evidence of what happened, and
                    // the operator's recovery path (restore the old key, or wipe
                    // deliberately) needs that evidence.
                    if (plain === null) {
                        failed += 1;
                        continue;
                    }

                    updates.push({ column, next: await this.seal(plain), previous: row[column] });
                }

                if (updates.length === 0) continue;

                // Compare-and-swap on the value this pass actually read.
                //
                // Re-encryption is a read-decrypt-seal-write cycle across a live
                // database. Without this guard, a user completing TOTP enrollment
                // between the SELECT above and this UPDATE would have their brand
                // new secret overwritten by a re-sealed copy of the OLD one — a
                // silent corruption that only surfaces when their authenticator
                // stops matching. IS NOT DISTINCT FROM so NULLs compare properly.
                const params = [row[field.primaryKey]];
                const assignments = [];
                const guards = [];

                for (const { column, next, previous } of updates) {
                    params.push(next);
                    assignments.push(`${column} = $${params.length}`);
                    params.push(previous);
                    guards.push(`${column} IS NOT DISTINCT FROM $${params.length}`);
                }

                const updated = await query(
                    `UPDATE ${field.table}
                        SET ${assignments.join(', ')}
                      WHERE ${field.primaryKey} = $1 AND ${guards.join(' AND ')}`,
                    params
                );

                // rowCount 0 means the row changed underneath us. Whoever wrote it
                // sealed with the ACTIVE key, so it is already current and simply
                // drops out of the stale selection on the next pass.
                if (updated.rowCount === 0) {
                    skipped += 1;
                    continue;
                }

                processed += 1;
                progressed = true;
            }

            // Nothing in the batch could be advanced — every row was unreadable
            // or was rewritten underneath us. Another pass would select the same
            // rows forever.
            if (!progressed) break;
        }

        return { field: field.id, table: field.table, reencrypted: processed, unreadable: failed, skippedConcurrent: skipped };
    }

    // ── Reporting ────────────────────────────────────────────────────────────

    /** Per-field counts of sealed rows and how many still carry an old envelope. */
    async inventory() {
        const fields = [];

        for (const field of ENCRYPTED_FIELDS) {
            const sealed = field.columns.map(column => `${column} IS NOT NULL`).join(' OR ');
            const stale = field.columns.map(column => `(${column} IS NOT NULL AND ${column} NOT LIKE '${ENVELOPE_PREFIX}${this._activeVersion}.%')`).join(' OR ');

            try {
                const result = await query(
                    `SELECT COUNT(*) FILTER (WHERE ${sealed})  AS sealed,
                            COUNT(*) FILTER (WHERE ${stale})   AS stale
                       FROM ${field.table}`
                );

                fields.push({
                    field: field.id,
                    label: field.label,
                    table: field.table,
                    deactivates: field.deactivates,
                    sealedRows: Number(result.rows[0].sealed),
                    staleRows: Number(result.rows[0].stale)
                });
            } catch (error) {
                fields.push({ field: field.id, label: field.label, table: field.table, deactivates: field.deactivates, error: error.message });
            }
        }

        return fields;
    }

    /** DEK ledger — versions and their wrapping metadata, never key material. */
    async keyHistory() {
        const result = await query(
            `SELECT version, provider, key_ref, kek_version, algorithm, state,
                    floor(EXTRACT(EPOCH FROM created_at))::FLOAT8   AS created_at,
                    floor(EXTRACT(EPOCH FROM retired_at))::FLOAT8   AS retired_at,
                    floor(EXTRACT(EPOCH FROM rewrapped_at))::FLOAT8 AS rewrapped_at
               FROM orion_encryption_keys
              ORDER BY version DESC`
        );

        return result.rows.map(row => ({
            version: Number(row.version),
            provider: row.provider,
            keyRef: row.key_ref,
            kekVersion: row.kek_version,
            algorithm: row.algorithm,
            state: row.state,
            createdAt: row.created_at,
            retiredAt: row.retired_at,
            rewrappedAt: row.rewrapped_at
        }));
    }

    /**
     * Clears encrypted data that can no longer be read (or that an operator has
     * decided to discard). Destructive and irreversible by design — the
     * orchestrator gates it behind role, typed confirmation and fleet consensus.
     *
     * @param {string[]|null} fieldIds registry ids to wipe; null wipes all
     */
    async wipeEncryptedFields(fieldIds = null) {
        const targets = fieldIds ? ENCRYPTED_FIELDS.filter(field => fieldIds.includes(field.id)) : [...ENCRYPTED_FIELDS];

        if (targets.length === 0) {
            throw new KeyVaultError('KEYVAULT::UNKNOWN-FIELD', `No encrypted field matches ${JSON.stringify(fieldIds)}`);
        }

        const client = await dbModule.getModule().getPool().connect();
        const results = [];

        // One transaction for the whole wipe. The companion statements exist to
        // keep other tables consistent with the wiped one — clearing
        // user_totp without clearing user_security.two_fa_enabled would leave
        // accounts claiming a second factor whose secret no longer exists. A
        // partial wipe is therefore worse than no wipe, so it is all or nothing.
        try {
            await client.query('BEGIN');

            for (const field of targets) {
                const wiped = await client.query(field.wipeStatement);

                for (const companion of field.wipeCompanionStatements || []) {
                    await client.query(companion);
                }

                results.push({ field: field.id, label: field.label, table: field.table, rowsWiped: wiped.rowCount, deactivates: field.deactivates });
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        for (const result of results) {
            const field = targets.find(target => target.id === result.field);
            logger.warn(`EncryptionKeyManager: wiped ${result.rowsWiped} row(s) of ${result.label} — ${field.wipeDescription}`);
        }

        return results;
    }
}

export { EncryptionKeyManager, ENVELOPE_PREFIX, LEGACY_PREFIX, REENCRYPT_BATCH_SIZE };
