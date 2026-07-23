import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'TokenModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

// expiry is stored as TIMESTAMPTZ but exposed to callers as unix seconds
// (float8 so pg parses it as a JS number, not an int8 string).
const TOKEN_COLUMNS = `
    token_id, user_uid, type,
    floor(EXTRACT(EPOCH FROM expiry))::FLOAT8 AS expiry,
    user_agent, link_code, security_tier, ip_range, hashed_fingerprint,
    view_type, max_retrievals, retrieval_count, created_at
`;

// updateToken interpolates column names into SQL — only these may ever appear.
const UPDATABLE_COLUMNS = new Set([
    'retrieval_count',
    'link_code',
    'user_agent',
    'ip_range',
    'hashed_fingerprint',
    'security_tier',
    'view_type',
    'max_retrievals'
]);

export const TokenModel = {
    /**
     * Insert a token row.
     * @param {{ expiry: number }} — expiry in unix seconds
     */
    async createToken({ tokenId, uid, type, expiry, userAgent, linkCode, securityTier, ipRange, hashedFingerprint, viewType, maxRetrievals }) {
        try {
            await query(
                `INSERT INTO tokens (token_id, user_uid, type, expiry, user_agent, link_code, security_tier, ip_range, hashed_fingerprint, view_type, max_retrievals)
                 VALUES ($1, $2, $3, to_timestamp($4), $5, $6, $7, $8, $9, $10, $11)`,
                [
                    tokenId,
                    uid,
                    type,
                    expiry,
                    userAgent || null,
                    linkCode || null,
                    securityTier || null,
                    ipRange || null,
                    hashedFingerprint || null,
                    viewType || null,
                    maxRetrievals || null
                ]
            );
            return { error: false };
        } catch (e) {
            return { error: true, errorCode: 'DATABASE::OPERATION-FAILED::A::i', message: e.message };
        }
    },

    /**
     * Get a token by ID. expiry is returned in unix seconds.
     */
    async getToken(tokenId) {
        const result = await query(`SELECT ${TOKEN_COLUMNS} FROM tokens WHERE token_id = $1`, [tokenId]);
        return result.rows[0] || null;
    },

    /**
     * Update whitelisted fields on a token.
     */
    async updateToken(tokenId, fields) {
        const entries = Object.entries(fields);
        if (entries.length === 0) return;

        for (const [key] of entries) {
            if (!UPDATABLE_COLUMNS.has(key)) {
                throw new Error(`TokenModel.updateToken: column '${key}' is not updatable`);
            }
        }

        const setClauses = entries.map(([key, _], i) => `${key} = $${i + 2}`);
        const values = entries.map(([_, val]) => val);

        await query(`UPDATE tokens SET ${setClauses.join(', ')} WHERE token_id = $1`, [tokenId, ...values]);
    },

    /**
     * Atomically consumes one retrieval from a resource token's budget.
     *
     * The check and the increment are one statement on purpose: a read-then-write
     * pair lets concurrent requests all observe the same pre-increment count and
     * every one of them pass, which defeats the whole point of max_retrievals.
     *
     * @returns {{ retrieval_count: number, max_retrievals: number } | null}
     *   null when the budget was already spent (no row satisfied the predicate).
     */
    async claimRetrieval(tokenId) {
        const result = await query(
            `UPDATE tokens
                SET retrieval_count = retrieval_count + 1
              WHERE token_id = $1
                AND max_retrievals IS NOT NULL
                AND retrieval_count < max_retrievals
          RETURNING retrieval_count, max_retrievals`,
            [tokenId]
        );
        return result.rows[0] || null;
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

    /**
     * Active (non-expired) token references for a user.
     * @returns {{ token_id: string, expiry: number }[]} expiry in unix seconds
     */
    async getActiveTokenRefs(uid) {
        const result = await query(
            `SELECT token_id, floor(EXTRACT(EPOCH FROM expiry))::FLOAT8 AS expiry
             FROM tokens WHERE user_uid = $1 AND expiry > now()`,
            [uid]
        );
        return result.rows;
    },

    /**
     * Active (non-expired) token rows for a user, newest first. Full rows —
     * the session listing / revocation surface needs link_code, user_agent
     * and created_at, not just refs.
     */
    async getActiveTokens(uid) {
        const result = await query(`SELECT ${TOKEN_COLUMNS} FROM tokens WHERE user_uid = $1 AND expiry > now() ORDER BY created_at DESC`, [uid]);
        return result.rows;
    },

    /**
     * Granular token deletion for the revocation system. Filters combine with
     * AND; at least one of uid / tokenId / linkCode is required so a bad call
     * can never wipe the whole table. Returns the deleted refs for auditing.
     *
     * @param {object} filters
     * @param {string} [filters.uid]              owner scope
     * @param {string} [filters.tokenId]          single token
     * @param {string} [filters.linkCode]         all tokens of one session pair
     * @param {string[]} [filters.types]          restrict to token types
     * @param {string[]} [filters.exceptTokenIds]  tokens to spare
     * @param {string[]} [filters.exceptLinkCodes] sessions to spare
     * @returns {{ token_id: string, user_uid: string, type: string, link_code: string|null }[]}
     */
    async deleteTokensWhere({ uid = null, tokenId = null, linkCode = null, types = null, exceptTokenIds = null, exceptLinkCodes = null } = {}) {
        if (!uid && !tokenId && !linkCode) {
            throw new Error('TokenModel.deleteTokensWhere: at least one of uid, tokenId, linkCode is required');
        }

        const clauses = [];
        const values = [];
        const add = (sql, value) => {
            values.push(value);
            clauses.push(sql.replace('?', `$${values.length}`));
        };

        if (uid) add('user_uid = ?', uid);
        if (tokenId) add('token_id = ?', tokenId);
        if (linkCode) add('link_code = ?', linkCode);
        if (types?.length) add('type = ANY(?)', types);
        if (exceptTokenIds?.length) add('token_id <> ALL(?)', exceptTokenIds);
        // NULL-safe: rows without a link code can never match an exception list
        if (exceptLinkCodes?.length) add('(link_code IS NULL OR link_code <> ALL(?))', exceptLinkCodes);

        const result = await query(`DELETE FROM tokens WHERE ${clauses.join(' AND ')} RETURNING token_id, user_uid, type, link_code`, values);
        return result.rows;
    },

    /**
     * Delete this user's expired token rows. The DatabaseJanitor system does
     * the same globally; this keeps hot users tidy between sweeps.
     */
    async removeExpiredTokens(uid) {
        await query('DELETE FROM tokens WHERE user_uid = $1 AND expiry <= now()', [uid]);
    },

    /**
     * Delete a single token, scoped to its owner.
     */
    async removeTokenRef(uid, tokenId) {
        await query('DELETE FROM tokens WHERE user_uid = $1 AND token_id = $2', [uid, tokenId]);
    }
};
