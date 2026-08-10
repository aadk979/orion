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

    /**
     * Records a failed sign-in and returns the resulting backoff state.
     *
     * Increment, window reset and deadline are computed in ONE statement so
     * concurrent attempts cannot race the counter. The window restarts if the
     * last failure is older than `windowSeconds`, so occasional typos never
     * accumulate into a penalty.
     *
     * @returns {{ failed_login_count: number, login_throttled_until: Date|null }}
     */
    async recordFailedLogin(uid, { windowSeconds = 900, threshold = 5, capSeconds = 900 } = {}) {
        const result = await query(
            `UPDATE users
                SET failed_login_window_start =
                        CASE WHEN failed_login_window_start IS NULL
                               OR failed_login_window_start < now() - ($2 || ' seconds')::INTERVAL
                             THEN now() ELSE failed_login_window_start END,
                    failed_login_count =
                        CASE WHEN failed_login_window_start IS NULL
                               OR failed_login_window_start < now() - ($2 || ' seconds')::INTERVAL
                             THEN 1 ELSE failed_login_count + 1 END,
                    login_throttled_until =
                        CASE WHEN (CASE WHEN failed_login_window_start IS NULL
                                          OR failed_login_window_start < now() - ($2 || ' seconds')::INTERVAL
                                        THEN 1 ELSE failed_login_count + 1 END) > $3
                             THEN now() + (LEAST(
                                    POWER(2, LEAST((CASE WHEN failed_login_window_start IS NULL
                                                          OR failed_login_window_start < now() - ($2 || ' seconds')::INTERVAL
                                                        THEN 1 ELSE failed_login_count + 1 END) - $3, 20)),
                                    $4) || ' seconds')::INTERVAL
                             ELSE login_throttled_until END,
                    updated_at = now()
              WHERE uid = $1
          RETURNING failed_login_count, login_throttled_until`,
            [uid, String(windowSeconds), threshold, capSeconds]
        );

        return result.rows[0] || { failed_login_count: 0, login_throttled_until: null };
    },

    /** Clears backoff state after a successful authentication. */
    async clearFailedLogins(uid) {
        await query(
            `UPDATE users
                SET failed_login_count = 0, failed_login_window_start = NULL, login_throttled_until = NULL, updated_at = now()
              WHERE uid = $1`,
            [uid]
        );
    },

    /**
     * @returns {{ throttled: boolean, until: Date|null }} current backoff state
     */
    async getLoginThrottle(uid) {
        const result = await query('SELECT login_throttled_until FROM users WHERE uid = $1', [uid]);
        const until = result.rows[0]?.login_throttled_until || null;

        return { throttled: !!until && new Date(until).getTime() > Date.now(), until };
    },

    /**
     * Records a failed SECOND-FACTOR submission (TOTP) and returns the backoff.
     *
     * Separate from the password counter because the two are guessed from
     * different places and mean different things: a wrong password is a
     * credential guess, a wrong TOTP is a challenge guess against an account
     * whose first factor may already be satisfied.
     *
     * This is a per-ACCOUNT ceiling on purpose. The per-challenge ceiling in
     * RequestModel.chargeFailedAttempt is reset by restarting the flow, and the
     * device-authorization and step-up TOTP paths create no challenge record at
     * all — so before this existed a 6-digit code accepted unlimited guesses.
     *
     * Same one-statement increment/window/deadline shape as recordFailedLogin,
     * so concurrent submissions cannot race the counter.
     *
     * @returns {{ second_factor_failed_count: number, second_factor_locked_until: Date|null }}
     */
    async recordFailedSecondFactor(uid, { windowSeconds = 900, threshold = 5, capSeconds = 900 } = {}) {
        const result = await query(
            `UPDATE users
                SET second_factor_window_start =
                        CASE WHEN second_factor_window_start IS NULL
                               OR second_factor_window_start < now() - ($2 || ' seconds')::INTERVAL
                             THEN now() ELSE second_factor_window_start END,
                    second_factor_failed_count =
                        CASE WHEN second_factor_window_start IS NULL
                               OR second_factor_window_start < now() - ($2 || ' seconds')::INTERVAL
                             THEN 1 ELSE second_factor_failed_count + 1 END,
                    second_factor_locked_until =
                        CASE WHEN (CASE WHEN second_factor_window_start IS NULL
                                          OR second_factor_window_start < now() - ($2 || ' seconds')::INTERVAL
                                        THEN 1 ELSE second_factor_failed_count + 1 END) > $3
                             THEN now() + (LEAST(
                                    POWER(2, LEAST((CASE WHEN second_factor_window_start IS NULL
                                                          OR second_factor_window_start < now() - ($2 || ' seconds')::INTERVAL
                                                        THEN 1 ELSE second_factor_failed_count + 1 END) - $3, 20)),
                                    $4) || ' seconds')::INTERVAL
                             ELSE second_factor_locked_until END,
                    updated_at = now()
              WHERE uid = $1
          RETURNING second_factor_failed_count, second_factor_locked_until`,
            [uid, String(windowSeconds), threshold, capSeconds]
        );

        return result.rows[0] || { second_factor_failed_count: 0, second_factor_locked_until: null };
    },

    /** Clears second-factor backoff after a successful verification. */
    async clearFailedSecondFactors(uid) {
        await query(
            `UPDATE users
                SET second_factor_failed_count = 0, second_factor_window_start = NULL, second_factor_locked_until = NULL, updated_at = now()
              WHERE uid = $1`,
            [uid]
        );
    },

    /**
     * @returns {{ throttled: boolean, until: Date|null }} current second-factor
     *   backoff. A `true` here means TOTP submissions are refused; the emailed
     *   one-time code path stays open so the owner is never locked out.
     */
    async getSecondFactorThrottle(uid) {
        const result = await query('SELECT second_factor_locked_until FROM users WHERE uid = $1', [uid]);
        const until = result.rows[0]?.second_factor_locked_until || null;

        return { throttled: !!until && new Date(until).getTime() > Date.now(), until };
    },

    async deleteUser(uid) {
        await query('DELETE FROM users WHERE uid = $1', [uid]);
    }
};
