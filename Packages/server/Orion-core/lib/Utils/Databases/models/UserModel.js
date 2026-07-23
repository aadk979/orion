import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'UserModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

export const UserModel = {
    /**
     * Create a new user row + associated security row.
     */
    async createUser({ uid, email, passwordHash, role = 'USER' }) {
        const client = await dbModule.getModule().getPool().connect();
        try {
            await client.query('BEGIN');

            await client.query(`INSERT INTO users (uid, email, password_hash, role) VALUES ($1, $2, $3, $4)`, [uid, email, passwordHash || null, role]);

            await client.query(`INSERT INTO user_security (user_uid) VALUES ($1) ON CONFLICT DO NOTHING`, [uid]);

            await client.query('COMMIT');
            return { error: false };
        } catch (e) {
            await client.query('ROLLBACK');
            return { error: true, errorCode: 'DATABASE::OPERATION-FAILED::A::i', message: e.message };
        } finally {
            client.release();
        }
    },

    /**
     * Get core user fields by UID.
     * @returns {{ uid, email, password_hash, role, disabled, email_verified, created_at, updated_at } | undefined}
     */
    async getUserByUid(uid) {
        const result = await query('SELECT * FROM users WHERE uid = $1', [uid]);
        return result.rows[0] || undefined;
    },

    /**
     * Get core user fields by email (case-insensitive; served by the
     * users_email_lower_key functional index).
     */
    async getUserByEmail(email) {
        const result = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
        return result.rows[0] || undefined;
    },

    /**
     * Lightweight UID lookup by email (case-insensitive). Returns uid string or null.
     */
    async getUidByEmail(email) {
        const result = await query('SELECT uid FROM users WHERE lower(email) = lower($1)', [email]);
        return result.rows[0]?.uid || null;
    },

    /**
     * Check if email is already registered (case-insensitive).
     */
    async emailExists(email) {
        const result = await query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
        return result.rows.length > 0;
    },

    /**
     * Check if UID exists.
     */
    async uidExists(uid) {
        const result = await query('SELECT 1 FROM users WHERE uid = $1', [uid]);
        return result.rows.length > 0;
    },

    /**
     * Moves the session-invalidity watermark to now, killing every token issued
     * before this instant. Deleting token rows cannot do this alone — tier 1 is
     * stateless and has no rows — so this is the authoritative kill switch.
     *
     * Called automatically by the credential/authorization mutations below; call
     * it directly for any other event that must end a user's sessions.
     */
    async invalidateSessionsNow(uid) {
        await query('UPDATE users SET sessions_valid_from = NOW(), updated_at = NOW() WHERE uid = $1', [uid]);
    },

    /**
     * Session-invalidity watermark as unix seconds (0 when never bumped).
     */
    async getSessionsValidFrom(uid) {
        const result = await query('SELECT floor(EXTRACT(EPOCH FROM sessions_valid_from))::FLOAT8 AS valid_from FROM users WHERE uid = $1', [uid]);
        return result.rows[0]?.valid_from ?? null;
    },

    // A password change ends every existing session, in one statement so the
    // credential and the watermark can never disagree.
    async updatePassword(uid, hash) {
        await query('UPDATE users SET password_hash = $1, sessions_valid_from = NOW(), updated_at = NOW() WHERE uid = $2', [hash, uid]);
    },

    async getPasswordHash(uid) {
        const result = await query('SELECT password_hash FROM users WHERE uid = $1', [uid]);
        return result.rows[0]?.password_hash || null;
    },

    // A role change must not survive in already-issued tokens.
    async updateRole(uid, role) {
        await query('UPDATE users SET role = $1, sessions_valid_from = NOW(), updated_at = NOW() WHERE uid = $2', [role, uid]);
    },

    // Disabling an account has to end its live sessions to be worth anything as
    // an incident-response action.
    async setDisabled(uid, disabled) {
        await query('UPDATE users SET disabled = $1, sessions_valid_from = NOW(), updated_at = NOW() WHERE uid = $2', [disabled, uid]);
    },

    async setEmailVerified(uid, verified) {
        await query('UPDATE users SET email_verified = $1, updated_at = NOW() WHERE uid = $2', [verified, uid]);
    },

    async deleteUser(uid) {
        await query('DELETE FROM users WHERE uid = $1', [uid]);
    }
};
