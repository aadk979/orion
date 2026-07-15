import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'TOTPModel.js');


const query = (text, params) => dbModule.getModule().query(text, params);

export const TOTPModel = {
    async savePendingSecret(uid, secret) {
        await query(
            `INSERT INTO user_totp (user_uid, pending_secret)
             VALUES ($1, $2)
             ON CONFLICT (user_uid)
             DO UPDATE SET pending_secret = EXCLUDED.pending_secret, updated_at = NOW()`,
            [uid, secret]
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
            [uid, secret]
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
     * @returns {{ enabled, secret, pending_secret } | null}
     */
    async getTOTPConfig(uid) {
        const result = await query('SELECT * FROM user_totp WHERE user_uid = $1', [uid]);
        return result.rows[0] || null;
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
        return result.rows[0]?.secret || null;
    },

    async getPendingSecret(uid) {
        const result = await query(
            'SELECT pending_secret FROM user_totp WHERE user_uid = $1',
            [uid]
        );
        return result.rows[0]?.pending_secret || null;
    }
};
