import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'UserProviderModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

export const UserProviderModel = {
    /**
     * Links a provider to an account, recording the provider's stable subject id.
     *
     * `subject` is what identity is actually keyed on — the email a provider
     * asserts is a mutable attribute and, for several providers, one the account
     * holder can set themselves. Passing it is strongly preferred; the parameter
     * is optional only so pre-existing callers keep working during rollout.
     */
    async addProvider(uid, providerName, subject = null) {
        await query(
            `INSERT INTO user_providers (user_uid, provider_name, provider_subject)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_uid, provider_name)
             DO UPDATE SET provider_subject = COALESCE(user_providers.provider_subject, EXCLUDED.provider_subject)`,
            [uid, providerName.trim().toUpperCase(), subject]
        );
    },

    /**
     * Resolves a local account from a provider identity — the ONLY safe lookup
     * for OAuth sign-in.
     *
     * @returns {string | null} the owning uid, or null when this provider
     *   identity has never been seen before.
     */
    async findUidBySubject(providerName, subject) {
        if (!subject) return null;

        const result = await query('SELECT user_uid FROM user_providers WHERE provider_name = $1 AND provider_subject = $2', [
            providerName.trim().toUpperCase(),
            subject
        ]);
        return result.rows[0]?.user_uid || null;
    },

    /**
     * Adopts a subject onto a link that predates subject recording (migration
     * 0004 backfills the column as NULL, since the subject is not derivable
     * retroactively). Only ever fills a NULL — it can never repoint an existing
     * binding at a different provider account.
     *
     * @returns {boolean} true when a row was adopted
     */
    async adoptSubjectIfUnbound(uid, providerName, subject) {
        if (!subject) return false;

        const result = await query(
            `UPDATE user_providers
                SET provider_subject = $3
              WHERE user_uid = $1
                AND provider_name = $2
                AND provider_subject IS NULL`,
            [uid, providerName.trim().toUpperCase(), subject]
        );
        return (result.rowCount || 0) > 0;
    },

    /**
     * @returns {string[]} Array of provider names, e.g. ['GOOGLE', 'GITHUB']
     */
    async getProviders(uid) {
        const result = await query('SELECT provider_name FROM user_providers WHERE user_uid = $1', [uid]);
        return result.rows.map(r => r.provider_name);
    },

    async hasProvider(uid, providerName) {
        const result = await query('SELECT 1 FROM user_providers WHERE user_uid = $1 AND provider_name = $2', [uid, providerName.trim().toUpperCase()]);
        return result.rows.length > 0;
    },

    async removeProvider(uid, providerName) {
        await query('DELETE FROM user_providers WHERE user_uid = $1 AND provider_name = $2', [uid, providerName.trim().toUpperCase()]);
    }
};
