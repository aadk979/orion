import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'ConsumedRefreshTokenModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

/**
 * Retired refresh-token ids, kept for reuse detection.
 *
 * When a refresh token rotates, its row is deleted from `tokens` so it stops
 * validating. That alone makes a replay indistinguishable from a token that
 * never existed — which is exactly the signal worth having, because a replay of
 * a *retired* token means someone captured it and used it after the legitimate
 * holder had already rotated. Rows live until slightly past the token's natural
 * expiry; the DatabaseJanitor sweeps them.
 */
export const ConsumedRefreshTokenModel = {
    /**
     * @param {{ tokenId: string, uid: string, linkCode: string|null, expiresAt: number }} entry
     *   expiresAt in unix seconds
     */
    async record({ tokenId, uid, linkCode, expiresAt }) {
        await query(
            `INSERT INTO consumed_refresh_tokens (token_id, user_uid, link_code, expires_at)
             VALUES ($1, $2, $3, to_timestamp($4))
             ON CONFLICT (token_id) DO NOTHING`,
            [tokenId, uid, linkCode || null, expiresAt]
        );
    },

    /**
     * `consumed_at` is what lets the caller distinguish a genuine replay from a
     * client retrying a rotation whose response it never received — both arrive
     * as the same "retired token presented again" signal, and only their age
     * tells them apart.
     *
     * @returns {{ token_id, user_uid, link_code, consumed_at } | null} null when
     *   this id was never retired (i.e. an unknown token rather than a replay)
     */
    async find(tokenId) {
        const result = await query('SELECT token_id, user_uid, link_code, consumed_at FROM consumed_refresh_tokens WHERE token_id = $1', [tokenId]);
        return result.rows[0] || null;
    },

    /** TTL sweep. Returns the number of rows removed. */
    async removeExpired() {
        const result = await query('DELETE FROM consumed_refresh_tokens WHERE expires_at <= now()');
        return result.rowCount || 0;
    }
};
