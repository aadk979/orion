import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'RequestModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

// chargeFailedAttempt interpolates a table name into SQL — only these may appear.
const CHALLENGE_TABLES = new Set([
    'password_reset_requests',
    'step_up_auth_requests',
    'device_authorization_requests',
    'two_fa_removal_requests'
]);

export const RequestModel = {
    // ─── Device Authorization Requests ───────────────────────────────────────

    /**
     * Charges one failed attempt against a challenge record and reports whether
     * the record survives.
     *
     * Every code-based challenge in the system (password reset, step-up, device
     * authorization, 2FA removal) issues a 6-digit code and previously returned
     * early on a wrong guess WITHOUT touching the record — so the same request id
     * accepted unlimited guesses for the full lifetime of the challenge. This is
     * the shared ceiling: the increment and the limit test are one statement, so
     * concurrent guesses cannot race past it, and the caller deletes the record
     * once it is exhausted.
     *
     * @param {string} table  one of the *_requests tables
     * @param {string} reqId
     * @returns {{ attempts: number, maxAttempts: number, exhausted: boolean }}
     */
    async chargeFailedAttempt(table, reqId) {
        if (!CHALLENGE_TABLES.has(table)) {
            throw new Error(`RequestModel.chargeFailedAttempt: "${table}" is not a challenge table`);
        }

        const result = await query(
            `UPDATE ${table}
                SET attempts = attempts + 1
              WHERE request_id = $1
          RETURNING attempts, max_attempts`,
            [reqId]
        );

        const row = result.rows[0];
        if (!row) return { attempts: 0, maxAttempts: 0, exhausted: true };

        return {
            attempts: row.attempts,
            maxAttempts: row.max_attempts,
            exhausted: row.attempts >= row.max_attempts
        };
    },

    async createDeviceAuthRequest(reqId, { codeHash, hashedFlowSecret, ip, userAgentHash, email }) {
        await query(
            `INSERT INTO device_authorization_requests (request_id, code_hash, hashed_flow_secret, ip_range, user_agent_hash, email)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [reqId, codeHash, hashedFlowSecret, ip, userAgentHash, email]
        );
    },

    async getDeviceAuthRequest(reqId) {
        const result = await query('SELECT * FROM device_authorization_requests WHERE request_id = $1', [reqId]);
        return result.rows[0] || null;
    },

    async deleteDeviceAuthRequest(reqId) {
        await query('DELETE FROM device_authorization_requests WHERE request_id = $1', [reqId]);
    },

    // ─── OAuth Requests ─────────────────────────────────────────────────────

    async createOAuthRequest(reqId, { hashedFlowSecret, hashedChallenge, ipRange, providerName, nonce, codeVerifier }) {
        await query(
            `INSERT INTO oauth_requests (request_id, hashed_flow_secret, hashed_challenge, ip_range, provider_name, nonce, code_verifier)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [reqId, hashedFlowSecret, hashedChallenge, ipRange, providerName, nonce || null, codeVerifier || null]
        );
    },

    async getOAuthRequest(reqId) {
        const result = await query('SELECT * FROM oauth_requests WHERE request_id = $1', [reqId]);
        return result.rows[0] || null;
    },

    async deleteOAuthRequest(reqId) {
        await query('DELETE FROM oauth_requests WHERE request_id = $1', [reqId]);
    },

    // ─── Step-Up Auth Requests ──────────────────────────────────────────────

    async createStepUpAuthRequest(reqId, { codeHash, hashedFlowSecret, uid, ip, userAgentHash }) {
        await query(
            `INSERT INTO step_up_auth_requests (request_id, code_hash, hashed_flow_secret, user_uid, ip_range, user_agent_hash)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [reqId, codeHash, hashedFlowSecret, uid, ip, userAgentHash]
        );
    },

    async getStepUpAuthRequest(reqId) {
        const result = await query('SELECT * FROM step_up_auth_requests WHERE request_id = $1', [reqId]);
        return result.rows[0] || null;
    },

    async deleteStepUpAuthRequest(reqId) {
        await query('DELETE FROM step_up_auth_requests WHERE request_id = $1', [reqId]);
    },

    /**
     * Drops every outstanding step-up challenge for a user, and reports the ids
     * so the caller can cancel their scheduled cleanup tasks.
     *
     * Re-initiating used to leave the previous challenge alive for its full
     * 10-minute TTL, each with its own independent attempt budget. Since the
     * caller keeps the request ids it was issued, that made the per-challenge
     * ceiling resettable at will: N initiations bought N × maxAttempts guesses
     * at a 6-digit code. Only the newest challenge is valid now.
     *
     * @returns {Promise<string[]>} request ids that were removed
     */
    async deleteStepUpAuthRequestsForUser(uid) {
        const result = await query('DELETE FROM step_up_auth_requests WHERE user_uid = $1 RETURNING request_id', [uid]);
        return result.rows.map(row => row.request_id);
    },

    // ─── 2FA Removal Requests ───────────────────────────────────────────────

    async create2FARemovalRequest(reqId, { codeHash, fingerprintHash, ip, userAgent, email, uid, method }) {
        await query(
            `INSERT INTO two_fa_removal_requests (request_id, code_hash, fingerprint_hash, ip_range, user_agent, email, user_uid, method)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [reqId, codeHash, fingerprintHash, ip, userAgent, email, uid, method]
        );
    },

    async get2FARemovalRequest(reqId) {
        const result = await query('SELECT * FROM two_fa_removal_requests WHERE request_id = $1', [reqId]);
        return result.rows[0] || null;
    },

    async delete2FARemovalRequest(reqId) {
        await query('DELETE FROM two_fa_removal_requests WHERE request_id = $1', [reqId]);
    },

    // ─── Password Reset Requests ────────────────────────────────────────────

    /**
     * @param {{ expiry: number }} — expiry in unix seconds
     */
    async createPasswordResetRequest(reqId, { email, uid, codeHash, ipRange, userAgentHash, expiry }) {
        await query(
            `INSERT INTO password_reset_requests (request_id, email, user_uid, code_hash, ip_range, user_agent_hash, expiry)
             VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))`,
            [reqId, email, uid, codeHash, ipRange, userAgentHash, expiry]
        );
    },

    /**
     * expiry is returned in unix seconds.
     */
    async getPasswordResetRequest(reqId) {
        const result = await query(
            `SELECT request_id, email, user_uid, code_hash, ip_range, user_agent_hash,
                    floor(EXTRACT(EPOCH FROM expiry))::FLOAT8 AS expiry, created_at
             FROM password_reset_requests WHERE request_id = $1`,
            [reqId]
        );
        return result.rows[0] || null;
    },

    async deletePasswordResetRequest(reqId) {
        await query('DELETE FROM password_reset_requests WHERE request_id = $1', [reqId]);
    },

    // ─── No-Auth Token Transactions ─────────────────────────────────────────

    async createNoAuthTransaction(txnId, { ipRange, fingerprint, userAgent, captchaCode, captchaVersion, serverCreatedAt }) {
        await query(
            `INSERT INTO no_auth_token_transactions (transaction_id, ip_range, fingerprint, user_agent, captcha_code, captcha_version, server_created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [txnId, ipRange, fingerprint, userAgent, captchaCode, captchaVersion, serverCreatedAt]
        );
    },

    async getNoAuthTransaction(txnId) {
        const result = await query('SELECT * FROM no_auth_token_transactions WHERE transaction_id = $1', [txnId]);
        return result.rows[0] || null;
    },

    async deleteNoAuthTransaction(txnId) {
        await query('DELETE FROM no_auth_token_transactions WHERE transaction_id = $1', [txnId]);
    }
};
