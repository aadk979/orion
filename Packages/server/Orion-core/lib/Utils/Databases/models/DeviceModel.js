import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'DeviceModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

// expiry is stored as TIMESTAMPTZ but exposed to callers as unix seconds
// (float8 so pg parses it as a JS number, not an int8 string).
const DEVICE_COLUMNS = `
    device_id, user_uid, device_code_hash, user_agent_hash,
    floor(EXTRACT(EPOCH FROM expiry))::FLOAT8 AS expiry,
    created_at
`;

export const DeviceModel = {
    /**
     * Store a recognized device.
     * @param {{ expiry: number }} — expiry in unix seconds
     */
    async createDevice({ deviceId, uid, deviceCodeHash, userAgentHash, expiry }) {
        await query(
            `INSERT INTO recognized_devices (device_id, user_uid, device_code_hash, user_agent_hash, expiry)
             VALUES ($1, $2, $3, $4, to_timestamp($5))`,
            [deviceId, uid, deviceCodeHash, userAgentHash, expiry]
        );
    },

    /**
     * Get device by ID. expiry is returned in unix seconds.
     * @returns {{ device_id, user_uid, device_code_hash, user_agent_hash, expiry } | null}
     */
    async getDevice(deviceId) {
        const result = await query(`SELECT ${DEVICE_COLUMNS} FROM recognized_devices WHERE device_id = $1`, [deviceId]);
        return result.rows[0] || null;
    },

    async deleteDevice(deviceId) {
        await query('DELETE FROM recognized_devices WHERE device_id = $1', [deviceId]);
    },

    async deleteAllUserDevices(uid) {
        await query('DELETE FROM recognized_devices WHERE user_uid = $1', [uid]);
    },

    /**
     * Active (non-expired) device references for a user.
     * @returns {{ device_id: string, expiry: number }[]} expiry in unix seconds
     */
    async getActiveDeviceRefs(uid) {
        const result = await query(
            `SELECT device_id, floor(EXTRACT(EPOCH FROM expiry))::FLOAT8 AS expiry
             FROM recognized_devices WHERE user_uid = $1 AND expiry > now()`,
            [uid]
        );
        return result.rows;
    },

    /**
     * Delete this user's expired device rows. The DatabaseJanitor system does
     * the same globally; this keeps hot users tidy between sweeps.
     */
    async removeExpiredDevices(uid) {
        await query('DELETE FROM recognized_devices WHERE user_uid = $1 AND expiry <= now()', [uid]);
    },

    /**
     * Delete a single device, scoped to its owner.
     */
    async removeDeviceRef(uid, deviceId) {
        await query('DELETE FROM recognized_devices WHERE user_uid = $1 AND device_id = $2', [uid, deviceId]);
    },

    /**
     * Get count of active (non-expired) devices.
     */
    async getActiveDeviceCount(uid) {
        const result = await query('SELECT COUNT(*)::int AS count FROM recognized_devices WHERE user_uid = $1 AND expiry > now()', [uid]);
        return result.rows[0]?.count || 0;
    }
};
