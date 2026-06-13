import { globalAccessPoint } from '../../GlobalAccessPoint.js';

const query = (text, params) => globalAccessPoint.db().query(text, params);

export const PasskeyModel = {
    /**
     * Save a WebAuthn credential for a user.
     * @param {string} uid
     * @param {{ id: string, publicKey: Uint8Array|Buffer, counter: number, deviceType?: string, backedUp?: boolean, transports?: string[] }} cred
     */
    async savePasskey(uid, cred) {
        const client = await globalAccessPoint.db().getPool().connect();
        try {
            await client.query('BEGIN');
            
            await client.query(
                `INSERT INTO user_passkeys (credential_id, user_uid, public_key, counter, device_type, backed_up)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (credential_id)
                 DO UPDATE SET public_key = EXCLUDED.public_key, counter = EXCLUDED.counter,
                               device_type = EXCLUDED.device_type, backed_up = EXCLUDED.backed_up`,
                [cred.id, uid, Buffer.from(cred.publicKey), cred.counter, cred.deviceType || null, cred.backedUp || false]
            );

            if (cred.transports && cred.transports.length > 0) {
                await client.query(
                    'DELETE FROM user_passkey_transports WHERE passkey_credential_id = $1',
                    [cred.id]
                );
                for (const transport of cred.transports) {
                    await client.query(
                        'INSERT INTO user_passkey_transports (passkey_credential_id, transport) VALUES ($1, $2)',
                        [cred.id, transport]
                    );
                }
            }
            
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    },

    /**
     * Get the passkey credential for a user (returns first found).
     * @returns {{ credential_id, public_key, counter, device_type, backed_up, transports[] } | null}
     */
    async getPasskey(uid) {
        const result = await query(
            'SELECT * FROM user_passkeys WHERE user_uid = $1 LIMIT 1',
            [uid]
        );
        if (result.rows.length === 0) return null;

        const passkey = result.rows[0];
        const transportsResult = await query(
            'SELECT transport FROM user_passkey_transports WHERE passkey_credential_id = $1',
            [passkey.credential_id]
        );
        passkey.transports = transportsResult.rows.map(r => r.transport);

        return passkey;
    },

    /**
     * Get passkey by credential ID.
     */
    async getPasskeyByCredentialId(credentialId) {
        const result = await query(
            'SELECT * FROM user_passkeys WHERE credential_id = $1',
            [credentialId]
        );
        if (result.rows.length === 0) return null;

        const passkey = result.rows[0];
        const transportsResult = await query(
            'SELECT transport FROM user_passkey_transports WHERE passkey_credential_id = $1',
            [credentialId]
        );
        passkey.transports = transportsResult.rows.map(r => r.transport);

        return passkey;
    },

    async updateCounter(credentialId, counter) {
        await query(
            'UPDATE user_passkeys SET counter = $1 WHERE credential_id = $2',
            [counter, credentialId]
        );
    },

    async deletePasskey(credentialId) {
        await query('DELETE FROM user_passkeys WHERE credential_id = $1', [credentialId]);
    },

    async deleteAllForUser(uid) {
        await query('DELETE FROM user_passkeys WHERE user_uid = $1', [uid]);
    },

    async hasPasskey(uid) {
        const result = await query(
            'SELECT 1 FROM user_passkeys WHERE user_uid = $1 LIMIT 1',
            [uid]
        );
        return result.rows.length > 0;
    }
};
