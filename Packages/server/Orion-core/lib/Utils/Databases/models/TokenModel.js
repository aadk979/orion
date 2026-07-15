import { getCurrentUnixTime } from '../../Date&Time.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'TokenModel.js');


const query = (text, params) => dbModule.getModule().query(text, params);

export const TokenModel = {
    /**
     * Insert a token row.
     */
    async createToken({ tokenId, uid, type, expiry, userAgent, linkCode, securityTier, ipRange, hashedFingerprint, viewType, maxRetrievals }) {
        try {
            await query(
                `INSERT INTO tokens (token_id, user_uid, type, expiry, user_agent, link_code, security_tier, ip_range, hashed_fingerprint, view_type, max_retrievals)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [tokenId, uid, type, expiry, userAgent || null, linkCode || null, securityTier || null, ipRange || null, hashedFingerprint || null, viewType || null, maxRetrievals || null]
            );
            return { error: false };
        } catch (e) {
            return { error: true, errorCode: 'DATABASE::OPERATION-FAILED::A::i', message: e.message };
        }
    },

    /**
     * Get a token by ID.
     */
    async getToken(tokenId) {
        const result = await query('SELECT * FROM tokens WHERE token_id = $1', [tokenId]);
        return result.rows[0] || null;
    },

    /**
     * Update specific fields on a token.
     */
    async updateToken(tokenId, fields) {
        const entries = Object.entries(fields);
        if (entries.length === 0) return;

        const setClauses = entries.map(([key, _], i) => `${key} = $${i + 2}`);
        const values = entries.map(([_, val]) => val);

        await query(
            `UPDATE tokens SET ${setClauses.join(', ')} WHERE token_id = $1`,
            [tokenId, ...values]
        );
    },

    async deleteToken(tokenId) {
        await query('DELETE FROM tokens WHERE token_id = $1', [tokenId]);
    },

    /**
     * Delete all tokens for a user.
     */
    async deleteAllUserTokens(uid) {
        await query('DELETE FROM tokens WHERE user_uid = $1', [uid]);
    },

    // ─── Token References on User ────────────────────────────────────────────

    async addTokenRef(uid, tokenId, expiry) {
        await query(
            'INSERT INTO user_active_token_refs (user_uid, token_id, expiry) VALUES ($1, $2, $3)',
            [uid, tokenId, expiry]
        );
    },

    /**
     * @returns {{ token_id, expiry }[]}
     */
    async getActiveTokenRefs(uid) {
        const now = getCurrentUnixTime();
        const result = await query(
            'SELECT token_id, expiry FROM user_active_token_refs WHERE user_uid = $1 AND expiry > $2',
            [uid, now]
        );
        return result.rows;
    },

    async getAllTokenRefs(uid) {
        const result = await query(
            'SELECT token_id, expiry FROM user_active_token_refs WHERE user_uid = $1',
            [uid]
        );
        return result.rows;
    },

    /**
     * Remove expired token refs AND delete the corresponding token rows.
     */
    async removeExpiredTokens(uid) {
        const now = getCurrentUnixTime();
        const client = await dbModule.getModule().getPool().connect();

        try {
            await client.query('BEGIN');
            
            // Get expired token IDs
            const expired = await client.query(
                'SELECT token_id FROM user_active_token_refs WHERE user_uid = $1 AND expiry <= $2',
                [uid, now]
            );

            // Delete the actual token rows
            for (const row of expired.rows) {
                await client.query('DELETE FROM tokens WHERE token_id = $1', [row.token_id]).catch(() => {});
            }

            // Delete the expired refs
            await client.query(
                'DELETE FROM user_active_token_refs WHERE user_uid = $1 AND expiry <= $2',
                [uid, now]
            );
            
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    async removeTokenRef(uid, tokenId) {
        await query(
            'DELETE FROM user_active_token_refs WHERE user_uid = $1 AND token_id = $2',
            [uid, tokenId]
        );
    },

    async clearAllTokenRefs(uid) {
        await query('DELETE FROM user_active_token_refs WHERE user_uid = $1', [uid]);
    }
};
