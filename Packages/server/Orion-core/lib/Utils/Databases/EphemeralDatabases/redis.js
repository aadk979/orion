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

    // Atomic SET NX — data:true when this caller created the key, data:false when
    // it already existed. Usable as a lightweight distributed lock/leader claim.
    async setIfAbsent(id, data, ttl) {
        try {
            this.ensureInitialized();
            const key = this._key(id);
            const value = JSON.stringify(data);
            const options = { NX: true };

            if (ttl !== undefined) {
                const now = Math.floor(Date.now() / 1000);
                const expiresIn = ttl - now;
                if (expiresIn <= 0) return { error: false, data: false, expired: true, completed: true };
                options.EX = expiresIn;
            }

            const res = await this.client.set(key, value, options);
            return { error: false, data: res === 'OK', completed: true };
        } catch (err) {
            logger.error('SetIfAbsent Error:', err.message);
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

    // Cursor-based SCAN instead of KEYS: KEYS is O(entire keyspace) and blocks
    // the Redis thread, which is unsafe on a shared production instance.
    async _scanKeys(pattern) {
        const found = new Set();
        for await (const batch of this.client.scanIterator({ MATCH: pattern, COUNT: 500 })) {
            for (const key of Array.isArray(batch) ? batch : [batch]) found.add(key);
        }
        return [...found];
    }

    async clear() {
        const keys = await this._scanKeys(`${this.collectionName}:*`);
        if (keys.length) await this.client.del(keys);
        return { error: false, completed: true };
    }

    async size() {
        const keys = await this._scanKeys(`${this.collectionName}:*`);
        return { error: false, data: keys.length, completed: true };
    }

    async keys(prefix = '') {
        const keys = await this._scanKeys(`${this.collectionName}:${prefix}*`);
        return {
            error: false,
            data: keys.map(k => k.replace(`${this.collectionName}:`, '')),
            completed: true
        };
    }

    async hashSet(id, fields, ttl) {
        try {
            this.ensureInitialized();
            const entries = Object.entries(fields || {});
            if (entries.length === 0) return { error: false, completed: true };

            const key = this._key(id);
            const serialized = {};
            for (const [field, value] of entries) serialized[field] = JSON.stringify(value);

            await this.client.hSet(key, serialized);
            // Hash fields have no individual TTL; callers pass a whole-hash expiry
            // (absolute unix seconds) as a safety net, refreshed on every write.
            if (ttl !== undefined) await this.client.expireAt(key, ttl);

            return { error: false, completed: true };
        } catch (err) {
            logger.error('Hash Set Error:', err.message);
            return { error: true, completed: false };
        }
    }

    async hashGet(id, field) {
        try {
            this.ensureInitialized();
            const res = await this.client.hGet(this._key(id), field);
            return {
                error: false,
                data: res ? JSON.parse(res) : undefined,
                completed: true
            };
        } catch (err) {
            logger.error('Hash Get Error:', err.message);
            return { error: true, completed: false };
        }
    }

    async hashGetAll(id) {
        try {
            this.ensureInitialized();
            const res = await this.client.hGetAll(this._key(id));
            const data = {};
            for (const [field, value] of Object.entries(res || {})) data[field] = JSON.parse(value);
            return { error: false, data, completed: true };
        } catch (err) {
            logger.error('Hash Get All Error:', err.message);
            return { error: true, completed: false };
        }
    }

    async hashDelete(id, fields) {
        try {
            this.ensureInitialized();
            const list = Array.isArray(fields) ? fields : [fields];
            if (list.length === 0) return { error: false, data: 0, completed: true };
            const removed = await this.client.hDel(this._key(id), list);
            return { error: false, data: removed, completed: true };
        } catch (err) {
            logger.error('Hash Delete Error:', err.message);
            return { error: true, completed: false };
        }
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
        if (this.client) await this.client.close();
        this.initialized = false;
        logger.info('Redis connection closed');
        return { error: false, completed: true };
    }
}

export { RedisService };
