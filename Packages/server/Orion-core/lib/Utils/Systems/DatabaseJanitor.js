import { logger } from '../logger.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'DatabaseJanitor.js');

// Cluster-wide mutex: pg_try_advisory_lock means at most one node sweeps at a
// time; the others skip the cycle instead of queueing behind it.
const JANITOR_ADVISORY_LOCK_KEY = 761003002;

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;
const DEFAULT_BATCH_SIZE = 5000;

// Table/column pairs are internal constants — never user input — so they can
// be interpolated into the DELETE statements safely.
const SWEEP_TARGETS = [
    { table: 'tokens', column: 'expiry' },
    { table: 'recognized_devices', column: 'expiry' },
    { table: 'password_reset_requests', column: 'expiry' },
    { table: 'device_authorization_requests', column: 'expires_at' },
    { table: 'oauth_requests', column: 'expires_at' },
    { table: 'step_up_auth_requests', column: 'expires_at' },
    { table: 'two_fa_removal_requests', column: 'expires_at' },
    { table: 'no_auth_token_transactions', column: 'expires_at' },
    // Retired refresh-token ids kept for reuse detection. They only need to
    // outlive the token itself; past that they are pure noise.
    { table: 'consumed_refresh_tokens', column: 'expires_at' },
    // Consumed and abandoned WebAuthn ceremonies alike — neither has value past expiry.
    { table: 'webauthn_ceremonies', column: 'expires_at' }
];

/**
 * DatabaseJanitor — global TTL sweeper for expired rows.
 *
 * Per-user cleanup (TokenModel.removeExpiredTokens etc.) only fires when a
 * user comes back; this system is what guarantees rows for users who never
 * return — and abandoned auth flows — still get reaped. Deletes run in ctid
 * batches so a large backlog never holds long row locks.
 *
 * Config (utilities.databaseJanitor): { enabled, intervalMs, batchSize, initialDelayMs }
 */
class DatabaseJanitor {
    constructor(config = {}) {
        this.enabled = config.enabled ?? true;
        this.intervalMs = Number(config.intervalMs) || DEFAULT_INTERVAL_MS;
        this.batchSize = Number(config.batchSize) || DEFAULT_BATCH_SIZE;
        this.initialDelayMs = Number(config.initialDelayMs) || DEFAULT_INITIAL_DELAY_MS;

        this._timer = null;
        this._initialTimer = null;
        this._sweeping = false;
    }

    start() {
        if (!this.enabled) {
            logger.info('DatabaseJanitor: disabled by configuration');
            return;
        }

        // Timers are unref'd so a pending sweep never keeps the process alive.
        this._initialTimer = setTimeout(() => this._runSweep(), this.initialDelayMs);
        this._initialTimer.unref();

        this._timer = setInterval(() => this._runSweep(), this.intervalMs);
        this._timer.unref();

        logger.info(`DatabaseJanitor: started — sweeping every ${Math.round(this.intervalMs / 1000)}s`);
    }

    stop() {
        if (this._initialTimer) clearTimeout(this._initialTimer);
        if (this._timer) clearInterval(this._timer);
        this._initialTimer = null;
        this._timer = null;
    }

    async _runSweep() {
        if (this._sweeping) return;
        this._sweeping = true;

        try {
            await this.sweepNow();
        } catch (e) {
            logger.warn(`DatabaseJanitor: sweep failed — ${e.message}`);
        } finally {
            this._sweeping = false;
        }
    }

    /**
     * Runs one sweep cycle immediately. Returns per-table deletion counts,
     * or null when another node holds the sweep lock.
     */
    async sweepNow() {
        const db = dbModule.probeModule();
        if (!db) return null;

        const client = await db.getPool().connect();

        try {
            const lock = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [JANITOR_ADVISORY_LOCK_KEY]);
            if (!lock.rows[0]?.locked) {
                return null; // another node is sweeping
            }

            const deleted = {};

            for (const { table, column } of SWEEP_TARGETS) {
                deleted[table] = await this._sweepTable(client, table, column);
            }

            const total = Object.values(deleted).reduce((a, b) => a + b, 0);
            if (total > 0) {
                logger.info(`DatabaseJanitor: reaped ${total} expired rows — ${JSON.stringify(deleted)}`);
            }

            return deleted;
        } finally {
            try {
                await client.query('SELECT pg_advisory_unlock($1)', [JANITOR_ADVISORY_LOCK_KEY]);
            } catch (_) {
                /* connection teardown releases the lock anyway */
            }
            client.release();
        }
    }

    async _sweepTable(client, table, column) {
        let total = 0;
        let batch;

        do {
            const result = await client.query(
                `DELETE FROM ${table} WHERE ctid IN (
                    SELECT ctid FROM ${table} WHERE ${column} <= now() LIMIT $1
                 )`,
                [this.batchSize]
            );
            batch = result.rowCount;
            total += batch;
        } while (batch === this.batchSize);

        return total;
    }
}

export { DatabaseJanitor };
