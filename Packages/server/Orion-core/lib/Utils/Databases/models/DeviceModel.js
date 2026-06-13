import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { getCurrentUnixTime } from '../../Date&Time.js';

const query = (text, params) => globalAccessPoint.db().query(text, params);

export const DeviceModel = {
    /**
     * Store a recognized device.
     */
    async createDevice({ deviceId, uid, deviceCodeHash, userAgentHash, expiry }) {
        await query(
            `INSERT INTO recognized_devices (device_id, user_uid, device_code_hash, user_agent_hash, expiry)
             VALUES ($1, $2, $3, $4, $5)`,
            [deviceId, uid, deviceCodeHash, userAgentHash, expiry]
        );
    },

    /**
     * Get device by ID.
     * @returns {{ device_id, user_uid, device_code_hash, user_agent_hash, expiry } | null}
     */
    async getDevice(deviceId) {
        const result = await query(
            'SELECT * FROM recognized_devices WHERE device_id = $1',
            [deviceId]
        );
        return result.rows[0] || null;
    },

    async deleteDevice(deviceId) {
        await query('DELETE FROM recognized_devices WHERE device_id = $1', [deviceId]);
    },

    async deleteAllUserDevices(uid) {
        await query('DELETE FROM recognized_devices WHERE user_uid = $1', [uid]);
    },

    // ─── Device References on User ───────────────────────────────────────────

    async addDeviceRef(uid, deviceId, expiry) {
        await query(
            'INSERT INTO user_recognized_device_refs (user_uid, device_id, expiry) VALUES ($1, $2, $3)',
            [uid, deviceId, expiry]
        );
    },

    /**
     * Get all device refs (including expired).
     */
    async getAllDeviceRefs(uid) {
        const result = await query(
            'SELECT device_id, expiry FROM user_recognized_device_refs WHERE user_uid = $1',
            [uid]
        );
        return result.rows;
    },

    /**
     * Get only non-expired device refs.
     */
    async getActiveDeviceRefs(uid) {
        const now = getCurrentUnixTime();
        const result = await query(
            'SELECT device_id, expiry FROM user_recognized_device_refs WHERE user_uid = $1 AND expiry > $2',
            [uid, now]
        );
        return result.rows;
    },

    /**
     * Remove expired device refs AND delete the corresponding device rows.
     */
    async removeExpiredDevices(uid) {
        const now = getCurrentUnixTime();
        const client = await globalAccessPoint.db().getPool().connect();

        try {
            await client.query('BEGIN');
            
            const expired = await client.query(
                'SELECT device_id FROM user_recognized_device_refs WHERE user_uid = $1 AND expiry <= $2',
                [uid, now]
            );

            for (const row of expired.rows) {
                // Ignore delete errors for individual devices, but process them inside the transaction
                await client.query('DELETE FROM recognized_devices WHERE device_id = $1', [row.device_id]).catch(() => {});
            }

            await client.query(
                'DELETE FROM user_recognized_device_refs WHERE user_uid = $1 AND expiry <= $2',
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

    async removeDeviceRef(uid, deviceId) {
        await query(
            'DELETE FROM user_recognized_device_refs WHERE user_uid = $1 AND device_id = $2',
            [uid, deviceId]
        );
    },

    /**
     * Get count of active (non-expired) device refs.
     */
    async getActiveDeviceCount(uid) {
        const now = getCurrentUnixTime();
        const result = await query(
            'SELECT COUNT(*)::int AS count FROM user_recognized_device_refs WHERE user_uid = $1 AND expiry > $2',
            [uid, now]
        );
        return result.rows[0]?.count || 0;
    },

    async clearAllDeviceRefs(uid) {
        await query('DELETE FROM user_recognized_device_refs WHERE user_uid = $1', [uid]);
    }
};
