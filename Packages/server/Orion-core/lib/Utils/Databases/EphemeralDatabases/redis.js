import { createClient } from 'redis';
import { logger } from '../../logger.js';

class RedisService {
    constructor() {
        this.client = null;
        this.initialized = false;
        this.collectionName = 'orion-configs';
    }

    async initialize(cred) {
        try {
            if (!cred || typeof cred !== 'object' || !cred.password) {
                throw new Error('Missing or invalid Redis credentials object');
            }

            this.client = createClient({
                username: cred.username || 'default',
                password: cred.password,
                socket: {
                    host: cred.host || '127.0.0.1',
                    port: cred.port || 6379
                },
                pingInterval: 60000 // Send a PING every 60 seconds to prevent idle timeouts
            });

            this.client.on('error', err => logger.error('Redis Client Error:', err));
            this.client.on('connect', () => logger.info('✅ Redis connected successfully'));

            await this.client.connect();

            this.initialized = true;
            return true;
        } catch (err) {
            logger.error('Initialization Error:', err.message);
            return false;
        }
    }

    ensureInitialized() {
        if (!this.initialized || !this.client) {
            throw new Error('Redis is not initialized. Call initialize() first.');
        }
    }

    _key(id) {
        return `${this.collectionName}:${id}`;
    }

    async addData(id, data, ttl) {
        try {
            this.ensureInitialized();
            const key = this._key(id);
            const value = JSON.stringify(data);

            if (ttl !== undefined) {
                const now = Math.floor(Date.now() / 1000);
                const expiresIn = ttl - now;

                if (expiresIn <= 0) {
                    await this.client.del(key);
                    return { error: false, expired: true, completed: true };
                }

                await this.client.set(key, value, { EX: expiresIn });
            } else {
                await this.client.set(key, value);
            }

            return { error: false, completed: true };
        } catch (err) {
            logger.error('Add Error:', err.message);
            return { error: true, completed: false };
        }
    }

    async getData(id) {
        try {
            this.ensureInitialized();
            const res = await this.client.get(this._key(id));
            return {
                error: false,
                data: res ? JSON.parse(res) : undefined,
                completed: true
            };
        } catch (err) {
            logger.error('Get Error:', err.message);
            return { error: true, completed: false };
        }
    }

    async has(id) {
        const exists = await this.client.exists(this._key(id));
        return { error: false, data: Boolean(exists), completed: true };
    }

    async getTTL(id) {
        const ttl = await this.client.ttl(this._key(id));
        if (ttl === -2) return { error: false, expired: true, completed: true };
        if (ttl === -1) return { error: false, data: null, completed: true };
        return { error: false, data: ttl, completed: true };
    }

    async updateTTL(id, ttl) {
        const now = Math.floor(Date.now() / 1000);
        const expiresIn = ttl - now;

        if (expiresIn <= 0) {
            await this.client.del(this._key(id));
            return { error: false, expired: true, completed: true };
        }

        await this.client.expire(this._key(id), expiresIn);
        return { error: false, completed: true };
    }

    async removeTTL(id) {
        await this.client.persist(this._key(id));
        return { error: false, completed: true };
    }

    async deleteData(id) {
        const deleted = await this.client.del(this._key(id));
        return {
            error: false,
            expired: deleted === 0,
            completed: true
        };
    }

    async clear() {
        const keys = await this.client.keys(`${this.collectionName}:*`);
        if (keys.length) await this.client.del(keys);
        return { error: false, completed: true };
    }

    async size() {
        const keys = await this.client.keys(`${this.collectionName}:*`);
        return { error: false, data: keys.length, completed: true };
    }

    async keys() {
        const keys = await this.client.keys(`${this.collectionName}:*`);
        return {
            error: false,
            data: keys.map(k => k.replace(`${this.collectionName}:`, '')),
            completed: true
        };
    }

    async evalScript(script, keys = [], args = []) {
        try {
            this.ensureInitialized();
            // node-redis v4+ requires string arguments
            const cmdArgs = ['EVAL', script, keys.length.toString(), ...keys, ...args.map(String)];
            const result = await this.client.sendCommand(cmdArgs);
            return { error: false, data: result, completed: true };
        } catch (err) {
            logger.error('Eval Error:', err.message);
            return { error: true, completed: false, errorMessage: err.message };
        }
    }

    async close() {
        if (this.client) await this.client.disconnect();
        this.initialized = false;
        logger.info('Redis connection closed');
        return { error: false, completed: true };
    }
}

export { RedisService };
