import { globalAccessPoint } from '../../GlobalAccessPoint.js';

const query = (text, params) => globalAccessPoint.db().query(text, params);

export const UserProviderModel = {
    async addProvider(uid, providerName) {
        await query(
            `INSERT INTO user_providers (user_uid, provider_name)
             VALUES ($1, $2)
             ON CONFLICT (user_uid, provider_name) DO NOTHING`,
            [uid, providerName.trim().toUpperCase()]
        );
    },

    /**
     * @returns {string[]} Array of provider names, e.g. ['GOOGLE', 'GITHUB']
     */
    async getProviders(uid) {
        const result = await query(
            'SELECT provider_name FROM user_providers WHERE user_uid = $1',
            [uid]
        );
        return result.rows.map(r => r.provider_name);
    },

    async hasProvider(uid, providerName) {
        const result = await query(
            'SELECT 1 FROM user_providers WHERE user_uid = $1 AND provider_name = $2',
            [uid, providerName.trim().toUpperCase()]
        );
        return result.rows.length > 0;
    },

    async removeProvider(uid, providerName) {
        await query(
            'DELETE FROM user_providers WHERE user_uid = $1 AND provider_name = $2',
            [uid, providerName.trim().toUpperCase()]
        );
    }
};
