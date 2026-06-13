import { globalAccessPoint } from '../../GlobalAccessPoint.js';

const query = (text, params) => globalAccessPoint.db().query(text, params);

export const UserModel = {
    /**
     * Create a new user row + associated security row.
     */
    async createUser({ uid, email, passwordHash, role = 'USER' }) {
        const client = await globalAccessPoint.db().getPool().connect();
        try {
            await client.query('BEGIN');
            
            await client.query(
                `INSERT INTO users (uid, email, password_hash, role) VALUES ($1, $2, $3, $4)`,
                [uid, email, passwordHash || null, role]
            );
            
            await client.query(
                `INSERT INTO user_security (user_uid) VALUES ($1) ON CONFLICT DO NOTHING`,
                [uid]
            );
            
            await client.query('COMMIT');
            return { error: false };
        } catch (e) {
            await client.query('ROLLBACK');
            return { error: true, errorCode: 'DATABASE-ERROR', message: e.message };
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
     * Get core user fields by email.
     */
    async getUserByEmail(email) {
        const result = await query('SELECT * FROM users WHERE email = $1', [email]);
        return result.rows[0] || undefined;
    },

    /**
     * Lightweight UID lookup by email. Returns uid string or null.
     */
    async getUidByEmail(email) {
        const result = await query('SELECT uid FROM users WHERE email = $1', [email]);
        return result.rows[0]?.uid || null;
    },

    /**
     * Check if email is already registered.
     */
    async emailExists(email) {
        const result = await query('SELECT 1 FROM users WHERE email = $1', [email]);
        return result.rows.length > 0;
    },

    /**
     * Check if UID exists.
     */
    async uidExists(uid) {
        const result = await query('SELECT 1 FROM users WHERE uid = $1', [uid]);
        return result.rows.length > 0;
    },

    async updatePassword(uid, hash) {
        await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE uid = $2', [hash, uid]);
    },

    async getPasswordHash(uid) {
        const result = await query('SELECT password_hash FROM users WHERE uid = $1', [uid]);
        return result.rows[0]?.password_hash || null;
    },

    async updateRole(uid, role) {
        await query('UPDATE users SET role = $1, updated_at = NOW() WHERE uid = $2', [role, uid]);
    },

    async setDisabled(uid, disabled) {
        await query('UPDATE users SET disabled = $1, updated_at = NOW() WHERE uid = $2', [disabled, uid]);
    },

    async setEmailVerified(uid, verified) {
        await query('UPDATE users SET email_verified = $1, updated_at = NOW() WHERE uid = $2', [verified, uid]);
    },

    async deleteUser(uid) {
        await query('DELETE FROM users WHERE uid = $1', [uid]);
    }
};
