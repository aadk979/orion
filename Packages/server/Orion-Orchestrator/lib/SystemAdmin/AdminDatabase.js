import pg from 'pg';
import crypto from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from 'r-sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, 'migrations');

// Distinct from Orion-core's migration lock (761003001) — both packages may
// share one Postgres database, and each serializes only its own DDL.
const MIGRATION_ADVISORY_LOCK_KEY = 761003002;

const DEFAULT_POOL_MAX = 10;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

/**
 * AdminDatabase — the orchestrator's OWN Postgres pool + versioned migrations
 * for the system-admin control plane (admins, policies, groups, magic links,
 * sessions, immutable audit).
 *
 * Deployment model: this connects to the same Postgres database the Orion-core
 * workers use, but with the ORCHESTRATOR's credentials. Workers are expected to
 * be granted SELECT-only on the orch_* tables (see sql/worker-grants.example.sql)
 * — the orchestrator is the single writer of system-admin data.
 *
 * Migrations live in ./migrations as ordered .sql files, recorded in
 * _orch_migrations, each applied in its own transaction under a cluster-wide
 * advisory lock (separate key from Orion-core's migration lock).
 */
class AdminDatabase {
    constructor(credentials = {}) {
        const { user, password, host, port, database, poolMax, statementTimeoutMs, ...rest } = credentials;

        this.pool = new pg.Pool({
            user,
            password,
            host,
            port: port || 5432,
            database,
            max: Number(poolMax) || DEFAULT_POOL_MAX,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            statement_timeout: Number(statementTimeoutMs) || DEFAULT_STATEMENT_TIMEOUT_MS,
            application_name: 'orion-orch',
            ...rest
        });

        // An errored idle client emits 'error' on the pool; without a handler
        // that becomes an uncaught exception and kills the orchestrator.
        this.pool.on('error', err => {
            logger.error(`AdminDatabase: idle client error — ${err.message}`);
        });

        this._ready = this._migrate();
    }

    async _migrate() {
        const files = readdirSync(MIGRATIONS_DIR)
            .filter(f => f.endsWith('.sql'))
            .sort();

        const client = await this.pool.connect();
        try {
            await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY]);

            await client.query(`
                CREATE TABLE IF NOT EXISTS _orch_migrations (
                    version     TEXT PRIMARY KEY,
                    checksum    TEXT NOT NULL,
                    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
                )
            `);

            const appliedResult = await client.query('SELECT version, checksum FROM _orch_migrations');
            const applied = new Map(appliedResult.rows.map(r => [r.version, r.checksum]));

            for (const file of files) {
                const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
                const checksum = crypto.createHash('sha256').update(sql).digest('hex');

                if (applied.has(file)) {
                    if (applied.get(file) !== checksum) {
                        logger.warn(
                            `AdminDatabase: migration ${file} was modified after being applied ` +
                                `(checksum mismatch) — applied migrations must never be edited; add a new migration instead`
                        );
                    }
                    continue;
                }

                try {
                    await client.query('BEGIN');
                    await client.query(sql);
                    await client.query('INSERT INTO _orch_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
                    await client.query('COMMIT');
                    logger.info(`AdminDatabase: applied migration ${file}`);
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

    /** Await this to guarantee schema is applied before any queries. */
    async ready() {
        return this._ready;
    }

    async query(text, params) {
        return this.pool.query(text, params);
    }

    getPool() {
        return this.pool;
    }

    async close() {
        await this.pool.end();
    }
}

export { AdminDatabase };
