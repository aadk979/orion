import pkg from 'pg';
const { Pool } = pkg;
import { logger } from '../../logger.js';

class PostgresService {
    constructor() {
        this.pool = null;
        this.initialized = false;
    }

    initialize(cred) {
        try {
            if (!cred || typeof cred !== 'object') {
                throw new Error('Missing or invalid Postgres credentials object');
            }

            const { user, password, host, port, database } = cred;
            if (!user || !password || !host || !port || !database) {
                throw new Error('Incomplete Postgres credentials');
            }

            this.pool = new Pool({
                user,
                password,
                host,
                port,
                database,
                max: 5,
                idleTimeoutMillis: 30000
            });

            this.initialized = true;
            logger.info('✅ Postgres (NoSQL) connected successfully');
            return true;
        } catch (err) {
            logger.error('Initialization Error:', err.message);
            return false;
        }
    }

    ensureInitialized() {
        if (!this.initialized || !this.pool) {
            throw new Error('Postgres is not initialized. Call initialize() first.');
        }
    }

    async createTableIfNeeded(collectionName) {
        const query = `
      CREATE TABLE IF NOT EXISTS ${collectionName} (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `;
        await this.pool.query(query);
    }

    async addData(collectionName, docId, data) {
        try {
            this.ensureInitialized();
            await this.createTableIfNeeded(collectionName);

            const query = `
        INSERT INTO ${collectionName} (id, data)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET data = $2;
      `;
            await this.pool.query(query, [docId, data]);

            return { completed: true, error: false };
        } catch (err) {
            logger.error('Add Error:', err.message);
            return { error: true, context: 'DB-FAIL', errorArray: [err.message] };
        }
    }

    async getData(collectionName, docId) {
        try {
            this.ensureInitialized();
            await this.createTableIfNeeded(collectionName);

            const query = `SELECT data FROM ${collectionName} WHERE id = $1;`;
            const result = await this.pool.query(query, [docId]);

            if (result.rows.length === 0) {
                return { error: false, data: undefined, completed: true };
            }

            return { error: false, data: result.rows[0].data || undefined, completed: true };
        } catch (err) {
            logger.error('Get Error:', err.message);
            return { error: true, context: 'DB-FAIL', errorArray: [err.message] };
        }
    }

    async deleteData(collectionName, docId) {
        try {
            this.ensureInitialized();
            await this.createTableIfNeeded(collectionName);

            const query = `DELETE FROM ${collectionName} WHERE id = $1;`;
            const result = await this.pool.query(query, [docId]);

            if (result.rowCount === 0) throw new Error('Document not found!');

            return { completed: true, error: false };
        } catch (err) {
            logger.error('Delete Error:', err.message);
            return { error: true, context: 'DB-FAIL', errorArray: [err.message] };
        }
    }

    async close() {
        try {
            if (this.pool) await this.pool.end();
            this.initialized = false;
            logger.info('Postgres connection closed');
        } catch (err) {
            logger.error('Close Error:', err.message);
        }
    }
}

export { PostgresService };
