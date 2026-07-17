import crypto from 'crypto';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { logger } from '../../logger.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'TOTPModel.js');
const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'TOTPModel.js');


const query = (text, params) => dbModule.getModule().query(text, params);

// ─── Encryption at rest ──────────────────────────────────────────────────────
// TOTP secrets are sealed with AES-256-GCM before they touch the database, so
// a DB dump alone cannot compromise 2FA. The key comes from
// utilities.dataEncryption.key (any string; sha256-derived to 32 bytes).
// Without a configured key, secrets are stored plaintext with a one-time
// warning. Legacy plaintext rows always decrypt as-is and re-seal on next write.

const SEAL_PREFIX = 'enc.v1.';
let warnedNoKey = false;

const getSealKey = () => {
    const raw = systemConfigModule.probeModule()?.utilities?.dataEncryption?.key;
    if (!raw) return null;
    return crypto.createHash('sha256').update(String(raw)).digest();
};

const seal = (plain) => {
    if (plain === null || plain === undefined) return plain;

    const key = getSealKey();
    if (!key) {
        if (!warnedNoKey) {
            warnedNoKey = true;
            logger.warn('TOTPModel: utilities.dataEncryption.key is not configured — TOTP secrets are stored unencrypted');
        }
        return plain;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${SEAL_PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
};

const open = (stored) => {
    if (stored === null || stored === undefined) return stored;
    if (!String(stored).startsWith(SEAL_PREFIX)) return stored; // legacy plaintext

    const key = getSealKey();
    if (!key) {
        throw new Error('TOTPModel: found an encrypted TOTP secret but utilities.dataEncryption.key is not configured');
    }

    const [ivB64, tagB64, ctB64] = String(stored).slice(SEAL_PREFIX.length).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
};

// ─── Model ───────────────────────────────────────────────────────────────────

export const TOTPModel = {
    async savePendingSecret(uid, secret) {
        await query(
            `INSERT INTO user_totp (user_uid, pending_secret)
             VALUES ($1, $2)
             ON CONFLICT (user_uid)
             DO UPDATE SET pending_secret = EXCLUDED.pending_secret, updated_at = NOW()`,
            [uid, seal(secret)]
        );
    },

    /**
     * Promote the pending secret to active, enable TOTP.
     */
    async enableTOTP(uid, secret) {
        await query(
            `INSERT INTO user_totp (user_uid, enabled, secret, pending_secret)
             VALUES ($1, true, $2, NULL)
             ON CONFLICT (user_uid)
             DO UPDATE SET enabled = true, secret = EXCLUDED.secret, pending_secret = NULL, updated_at = NOW()`,
            [uid, seal(secret)]
        );
    },

    async disableTOTP(uid) {
        await query(
            `UPDATE user_totp SET enabled = false, secret = NULL, pending_secret = NULL, updated_at = NOW()
             WHERE user_uid = $1`,
            [uid]
        );
    },

    /**
     * @returns {{ enabled, secret, pending_secret } | null} secrets are decrypted
     */
    async getTOTPConfig(uid) {
        const result = await query('SELECT * FROM user_totp WHERE user_uid = $1', [uid]);
        const row = result.rows[0];
        if (!row) return null;

        row.secret = open(row.secret);
        row.pending_secret = open(row.pending_secret);
        return row;
    },

    async isEnabled(uid) {
        const result = await query(
            'SELECT enabled FROM user_totp WHERE user_uid = $1',
            [uid]
        );
        return result.rows[0]?.enabled || false;
    },

    async getSecret(uid) {
        const result = await query(
            'SELECT secret FROM user_totp WHERE user_uid = $1',
            [uid]
        );
        return open(result.rows[0]?.secret || null);
    },

    async getPendingSecret(uid) {
        const result = await query(
            'SELECT pending_secret FROM user_totp WHERE user_uid = $1',
            [uid]
        );
        return open(result.rows[0]?.pending_secret || null);
    }
};

// Exported for unit tests only.
export const __sealing = { seal, open, SEAL_PREFIX };
