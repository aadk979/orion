import { globalAccessPoint } from '../../GlobalAccessPoint.js';

const query = (text, params) => globalAccessPoint.db().query(text, params);

export const RequestModel = {
    // ─── Device Authorization Requests ───────────────────────────────────────

    async createDeviceAuthRequest(reqId, { codeHash, hashedFlowSecret, ip, userAgentHash, email }) {
        await query(
            `INSERT INTO device_authorization_requests (request_id, code_hash, hashed_flow_secret, ip_range, user_agent_hash, email)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [reqId, codeHash, hashedFlowSecret, ip, userAgentHash, email]
        );
    },

    async getDeviceAuthRequest(reqId) {
        const result = await query(
            'SELECT * FROM device_authorization_requests WHERE request_id = $1',
            [reqId]
        );
        return result.rows[0] || null;
    },

    async deleteDeviceAuthRequest(reqId) {
        await query('DELETE FROM device_authorization_requests WHERE request_id = $1', [reqId]);
    },

    // ─── OAuth Requests ─────────────────────────────────────────────────────

    async createOAuthRequest(reqId, { hashedFlowSecret, hashedChallenge, ipRange, providerName, nonce }) {
        await query(
            `INSERT INTO oauth_requests (request_id, hashed_flow_secret, hashed_challenge, ip_range, provider_name, nonce)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [reqId, hashedFlowSecret, hashedChallenge, ipRange, providerName, nonce || null]
        );
    },

    async getOAuthRequest(reqId) {
        const result = await query(
            'SELECT * FROM oauth_requests WHERE request_id = $1',
            [reqId]
        );
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
        const result = await query(
            'SELECT * FROM step_up_auth_requests WHERE request_id = $1',
            [reqId]
        );
        return result.rows[0] || null;
    },

    async deleteStepUpAuthRequest(reqId) {
        await query('DELETE FROM step_up_auth_requests WHERE request_id = $1', [reqId]);
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
        const result = await query(
            'SELECT * FROM two_fa_removal_requests WHERE request_id = $1',
            [reqId]
        );
        return result.rows[0] || null;
    },

    async delete2FARemovalRequest(reqId) {
        await query('DELETE FROM two_fa_removal_requests WHERE request_id = $1', [reqId]);
    },

    // ─── Password Reset Requests ────────────────────────────────────────────

    async createPasswordResetRequest(reqId, { email, uid, codeHash, ipRange, userAgentHash, expiry }) {
        await query(
            `INSERT INTO password_reset_requests (request_id, email, user_uid, code_hash, ip_range, user_agent_hash, expiry)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [reqId, email, uid, codeHash, ipRange, userAgentHash, expiry]
        );
    },

    async getPasswordResetRequest(reqId) {
        const result = await query(
            'SELECT * FROM password_reset_requests WHERE request_id = $1',
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
        const result = await query(
            'SELECT * FROM no_auth_token_transactions WHERE transaction_id = $1',
            [txnId]
        );
        return result.rows[0] || null;
    },

    async deleteNoAuthTransaction(txnId) {
        await query('DELETE FROM no_auth_token_transactions WHERE transaction_id = $1', [txnId]);
    }
};
