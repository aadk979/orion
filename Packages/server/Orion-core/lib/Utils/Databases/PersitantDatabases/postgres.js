import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * PostgresService — Connection pool + schema migration for Orion Alpine.
 *
 * All data access goes through model files that import this service
 * via globalAccessPoint.db().query() or globalAccessPoint.db().getPool().
 */
class PostgresService {
    constructor(credentials) {
        const { user, password, host, port, database, ...rest } = credentials;

        this.pool = new pg.Pool({
            user,
            password,
            host,
            port: port || 5432,
            database,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            ...rest
        });

        this._ready = this._migrate();
    }

    /**
     * Runs the DDL from schema.sql. All statements use IF NOT EXISTS.
     */
    async _migrate() {
        const schemaPath = join(__dirname, '..', 'schema.sql');
        const sql = readFileSync(schemaPath, 'utf-8');
        const client = await this.pool.connect();
        try {
            await client.query(sql);
        } finally {
            client.release();
        }
    }

    /**
     * Await this to guarantee schema is applied before any queries.
     */
    async ready() {
        return this._ready;
    }

    /**
     * Execute a parameterized query.
     * @param {string} text  SQL with $1, $2, ... placeholders
     * @param {Array}  params  Bind values
     * @returns {import('pg').QueryResult}
     */
    async query(text, params) {
        return this.pool.query(text, params);
    }

    /**
     * Returns the underlying pg.Pool.
     */
    getPool() {
        return this.pool;
    }
}

export { PostgresService };
