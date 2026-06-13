import { globalAccessPoint } from '../../GlobalAccessPoint.js';

const query = (text, params) => globalAccessPoint.db().query(text, params);

export const UserSecurityModel = {
    async getOrCreate(uid) {
        await query(
            `INSERT INTO user_security (user_uid) VALUES ($1) ON CONFLICT DO NOTHING`,
            [uid]
        );
        const result = await query('SELECT * FROM user_security WHERE user_uid = $1', [uid]);
        return result.rows[0];
    },

    async setTwoFAEnabled(uid, enabled) {
        await query(
            `INSERT INTO user_security (user_uid, two_fa_enabled)
             VALUES ($1, $2)
             ON CONFLICT (user_uid)
             DO UPDATE SET two_fa_enabled = EXCLUDED.two_fa_enabled, updated_at = NOW()`,
            [uid, enabled]
        );
    },

    async getTwoFAEnabled(uid) {
        const result = await query(
            'SELECT two_fa_enabled FROM user_security WHERE user_uid = $1',
            [uid]
        );
        return result.rows[0]?.two_fa_enabled || false;
    },

    async setRevocationDate(uid, date) {
        await query(
            `UPDATE user_security SET revocation_date = $1, updated_at = NOW() WHERE user_uid = $2`,
            [date, uid]
        );
    },

    async getRevocationDate(uid) {
        const result = await query(
            'SELECT revocation_date FROM user_security WHERE user_uid = $1',
            [uid]
        );
        return result.rows[0]?.revocation_date || null;
    }
};
