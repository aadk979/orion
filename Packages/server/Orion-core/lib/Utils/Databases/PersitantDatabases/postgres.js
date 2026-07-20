import pg from 'pg';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

// Cluster-wide mutex so only one node runs DDL at a time. CREATE TABLE IF NOT
// EXISTS is not concurrency-safe in Postgres — parallel boots race on catalog
// inserts without this lock.
const MIGRATION_ADVISORY_LOCK_KEY = 761003001;

const DEFAULT_POOL_MAX = 20;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * PostgresService — Connection pool + versioned schema migrations for Orion Alpine.
 *
 * Migrations live in ../migrations as ordered .sql files (0001_*.sql, 0002_*.sql, …).
 * Applied versions are recorded in _orion_migrations; each pending migration runs
 * inside its own transaction, and the whole run is serialized cluster-wide via a
 * Postgres advisory lock.
 *
 * All data access goes through model files that import this service
 * via dbModule.getModule().query() or dbModule.getModule().getPool().
 */
class PostgresService {
    constructor(credentials) {
        const { user, password, host, port, database, poolMax, statementTimeoutMs, ...rest } = credentials;

        this.pool = new pg.Pool({
            user,
            password,
            host,
            port: port || 5432,
            database,
            max: Number(poolMax) || DEFAULT_POOL_MAX,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
            statement_timeout: Number(statementTimeoutMs) || DEFAULT_STATEMENT_TIMEOUT_MS,
            application_name: 'orion-core',
            ...rest
        });

        // An errored idle client emits 'error' on the pool; without a handler
        // that becomes an uncaught exception and kills the process.
        this.pool.on('error', err => {
            logger.error(`PostgresService: idle client error — ${err.message}`);
        });

        this._ready = this._migrate();
    }

    /**
     * Applies pending migrations from MIGRATIONS_DIR in filename order.
     */
    async _migrate() {
        const files = readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql'))
            .sort();

        const client = await this.pool.connect();
        try {
            await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);

            await client.query(`
                CREATE TABLE IF NOT EXISTS _orion_migrations (
                    version     TEXT PRIMARY KEY,
                    checksum    TEXT NOT NULL,
                    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            `);

            const appliedResult = await client.query('SELECT version, checksum FROM _orion_migrations');
            const applied = new Map(appliedResult.rows.map(r => [r.version, r.checksum]));

            for (const file of files) {
                const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
                const checksum = crypto.createHash('sha256').update(sql).digest('hex');

                if (applied.has(file)) {
                    if (applied.get(file) !== checksum) {
                        logger.warn(
                            `PostgresService: migration ${file} was modified after being applied ` +
                                `(checksum mismatch) — applied migrations must never be edited; add a new migration instead`
                        );
                    }
                    continue;
                }

                try {
                    await client.query('BEGIN');
                    await client.query(sql);
                    await client.query('INSERT INTO _orion_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
                    await client.query('COMMIT');
                    logger.info(`PostgresService: applied migration ${file}`);
                } catch (e) {
                    await client.query('ROLLBACK');
                    throw new Error(`Migration ${file} failed: ${e.message}`);
                }
            }
        } finally {
            try {
                await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);
            } catch (_) {
                /* connection teardown releases the lock anyway */
            }
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

    /**
     * Drains and closes the pool. Called by GracefulShutdownSystem.
     */
    async close() {
        await this.pool.end();
    }
}

export { PostgresService };
