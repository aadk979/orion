import { globalAccessPoint } from '../../GlobalAccessPoint.js';

const query = (text, params) => globalAccessPoint.db().query(text, params);

export const HealthCheckModel = {
    async write(key, data) {
        try {
            await query(
                `INSERT INTO _orion_health_check (id, data) VALUES ($1, $2)
                 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
                [key, JSON.stringify(data)]
            );
            return { error: false, passed: true };
        } catch (e) {
            return { error: true, message: e.message };
        }
    },

    async read(key) {
        try {
            const result = await query(
                'SELECT data FROM _orion_health_check WHERE id = $1',
                [key]
            );
            if (result.rows.length === 0) return { error: true };
            return { error: false, data: JSON.parse(result.rows[0].data) };
        } catch (e) {
            return { error: true, message: e.message };
        }
    },

    async remove(key) {
        try {
            await query('DELETE FROM _orion_health_check WHERE id = $1', [key]);
            return { error: false };
        } catch (e) {
            return { error: true, message: e.message };
        }
    }
};
