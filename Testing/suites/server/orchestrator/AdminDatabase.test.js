import '../../../helpers/bootstrap.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { AdminDatabase } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/AdminDatabase.js';

/**
 * AdminDatabase — pool wiring and the migration runner.
 *
 * The constructor opens a real pg.Pool, so these tests build the instance with
 * `Object.create(AdminDatabase.prototype)` and inject a fake pool. That skips
 * exactly one line of production code (the Pool construction) and leaves the
 * part with actual logic — the migration loop — running verbatim.
 *
 * What the loop must get right, and what silently breaks a deployment if it
 * does not:
 *   - the advisory lock is taken BEFORE the ledger is read, or two orchestrators
 *     booting together both decide a migration is unapplied and both run it;
 *   - the lock is released even when a migration throws;
 *   - each migration is its own transaction, and a failure rolls back rather
 *     than leaving half a schema recorded as applied;
 *   - an already-applied file is skipped, so restarts are cheap and re-running
 *     DDL never happens;
 *   - editing an applied migration warns instead of silently diverging.
 */

const ORCH_DIR = join(import.meta.dirname, '..', '..', '..', '..', 'Packages', 'server', 'Orion-Orchestrator');
const MIGRATIONS_DIR = join(ORCH_DIR, 'lib', 'SystemAdmin', 'migrations');

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

/**
 * A pg client double. `fail` names a statement fragment that should throw, so a
 * test can make one migration blow up mid-loop.
 */
const fakeClient = ({ appliedRows = [], failOn = null } = {}) => ({
    statements: [],
    released: false,
    async query(text, params) {
        this.statements.push({ text: text.replace(/\s+/g, ' ').trim(), params });

        if (failOn && text.includes(failOn)) throw new Error('relation "orch_system_admins" already exists');
        if (/SELECT version, checksum FROM _orch_migrations/.test(text)) return { rows: appliedRows, rowCount: appliedRows.length };
        return { rows: [], rowCount: 0 };
    },
    release() {
        this.released = true;
    },
    /** Statement texts only, for order-sensitive assertions. */
    get texts() {
        return this.statements.map(s => s.text);
    }
});

/** Builds an AdminDatabase whose pool hands out `client`, without touching pg. */
const withClient = client => {
    const db = Object.create(AdminDatabase.prototype);
    db.pool = {
        queries: [],
        async connect() {
            return client;
        },
        async query(text, params) {
            this.queries.push({ text, params });
            return { rows: [], rowCount: 0 };
        },
        ended: false,
        async end() {
            this.ended = true;
        }
    };
    return db;
};

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

describe('AdminDatabase — the shipped migrations', () => {
    test('there is at least one migration and every file is ordered by name', () => {
        assert.ok(MIGRATION_FILES.length > 0, 'the plane cannot bootstrap with no migrations');
        // Numeric prefixes are what make the sort deterministic; a file named
        // without one would order unpredictably against the rest.
        for (const file of MIGRATION_FILES) {
            assert.match(file, /^\d{4}_[a-z0-9_]+\.sql$/, `${file} must be NNNN_snake_case.sql`);
        }
        assert.deepEqual([...MIGRATION_FILES].sort(), MIGRATION_FILES, 'readdir order must already be the apply order');
    });

    test('migration versions are unique', () => {
        const versions = MIGRATION_FILES.map(f => f.slice(0, 4));
        assert.equal(new Set(versions).size, versions.length, 'two migrations sharing a number apply in an undefined order');
    });

    test('every migration creates only orch-namespaced objects', () => {
        for (const file of MIGRATION_FILES) {
            const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
            const created = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9."]+)/gi)].map(m => m[1].replace(/"/g, ''));

            for (const table of created) {
                // The orchestrator shares a database with Orion-core workers.
                // A table without the prefix could collide with a core table.
                assert.match(table, /^(orch_|_orch_)/, `${file} creates "${table}" outside the orch_ namespace`);
            }
        }
    });

    test('no migration drops a table', () => {
        for (const file of MIGRATION_FILES) {
            const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
            assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, `${file} drops a table — migrations run automatically at boot`);
        }
    });
});

describe('AdminDatabase — migration runner', () => {
    let client;
    let db;

    beforeEach(() => {
        client = fakeClient();
        db = withClient(client);
    });

    test('the advisory lock is taken before the ledger is read and released at the end', async () => {
        await db._migrate();

        const lockIndex = client.texts.findIndex(t => t.includes('pg_advisory_lock'));
        const ledgerIndex = client.texts.findIndex(t => t.includes('SELECT version, checksum'));
        const unlockIndex = client.texts.findIndex(t => t.includes('pg_advisory_unlock'));

        assert.ok(lockIndex >= 0, 'no advisory lock was taken');
        assert.ok(lockIndex < ledgerIndex, 'the lock must precede the read, or two boots race');
        assert.ok(unlockIndex > ledgerIndex);
        assert.equal(client.released, true, 'the client must go back to the pool');
    });

    test('the advisory lock key is distinct from Orion-core migration lock 761003001', async () => {
        await db._migrate();

        const lock = client.statements.find(s => s.text.includes('pg_advisory_lock'));
        // Both packages may share one database; sharing a lock key would make
        // each block the other's unrelated DDL.
        assert.deepEqual(lock.params, [761003002]);
    });

    test('the ledger table is created before it is read', async () => {
        await db._migrate();

        const createIndex = client.texts.findIndex(t => t.includes('CREATE TABLE IF NOT EXISTS _orch_migrations'));
        const readIndex = client.texts.findIndex(t => t.includes('SELECT version, checksum'));

        assert.ok(createIndex >= 0 && createIndex < readIndex);
    });

    test('a fresh database applies every migration, each in its own transaction', async () => {
        await db._migrate();

        const begins = client.texts.filter(t => t === 'BEGIN').length;
        const commits = client.texts.filter(t => t === 'COMMIT').length;

        assert.equal(begins, MIGRATION_FILES.length);
        assert.equal(commits, MIGRATION_FILES.length);
        assert.equal(client.texts.filter(t => t === 'ROLLBACK').length, 0);
    });

    test('each applied migration is recorded with its checksum', async () => {
        await db._migrate();

        const inserts = client.statements.filter(s => s.text.startsWith('INSERT INTO _orch_migrations'));

        assert.equal(inserts.length, MIGRATION_FILES.length);
        inserts.forEach((insert, i) => {
            const file = MIGRATION_FILES[i];
            assert.deepEqual(insert.params, [file, sha256(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'))]);
        });
    });

    test('migrations are applied in filename order', async () => {
        await db._migrate();

        const applied = client.statements.filter(s => s.text.startsWith('INSERT INTO _orch_migrations')).map(s => s.params[0]);

        assert.deepEqual(applied, MIGRATION_FILES);
    });

    test('an already-applied migration is skipped entirely', async () => {
        const appliedRows = MIGRATION_FILES.map(file => ({ version: file, checksum: sha256(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')) }));
        const replayed = fakeClient({ appliedRows });

        await withClient(replayed)._migrate();

        // A restart must be a no-op: no transaction, no DDL, no ledger write.
        assert.equal(replayed.texts.filter(t => t === 'BEGIN').length, 0);
        assert.equal(replayed.texts.filter(t => t.startsWith('INSERT INTO _orch_migrations')).length, 0);
    });

    test('a partially-migrated database applies only what is missing', async () => {
        if (MIGRATION_FILES.length < 2) return; // nothing to be partial about

        const first = MIGRATION_FILES[0];
        const partial = fakeClient({ appliedRows: [{ version: first, checksum: sha256(readFileSync(join(MIGRATIONS_DIR, first), 'utf-8')) }] });

        await withClient(partial)._migrate();

        const applied = partial.statements.filter(s => s.text.startsWith('INSERT INTO _orch_migrations')).map(s => s.params[0]);

        assert.deepEqual(applied, MIGRATION_FILES.slice(1));
    });

    test('an edited-after-apply migration warns and is not re-run', async () => {
        const drifted = fakeClient({
            appliedRows: MIGRATION_FILES.map(file => ({ version: file, checksum: 'stale-checksum-from-an-earlier-edit' }))
        });

        await withClient(drifted)._migrate();

        // Re-running edited DDL against a live schema is worse than the drift;
        // the runner flags it and moves on.
        assert.equal(drifted.texts.filter(t => t === 'BEGIN').length, 0);
    });

    test('a failing migration rolls back, aborts the run and surfaces the file name', async () => {
        const target = MIGRATION_FILES[0];
        const body = readFileSync(join(MIGRATIONS_DIR, target), 'utf-8');
        // Pick a fragment unique to the first migration so only it fails.
        const failing = fakeClient({ failOn: body.slice(0, 60) });
        const failed = withClient(failing);

        await assert.rejects(() => failed._migrate(), err => {
            assert.match(err.message, new RegExp(`Migration ${target} failed`));
            return true;
        });

        assert.equal(failing.texts.filter(t => t === 'ROLLBACK').length, 1);
        assert.equal(failing.texts.filter(t => t === 'COMMIT').length, 0, 'nothing may commit once a migration failed');
        assert.equal(failing.texts.filter(t => t.startsWith('INSERT INTO _orch_migrations')).length, 0);
    });

    test('the lock is released and the client returned even when a migration throws', async () => {
        const body = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILES[0]), 'utf-8');
        const failing = fakeClient({ failOn: body.slice(0, 60) });

        await assert.rejects(() => withClient(failing)._migrate());

        // Without this, one bad migration wedges every future boot of every
        // orchestrator on the advisory lock.
        assert.ok(failing.texts.some(t => t.includes('pg_advisory_unlock')));
        assert.equal(failing.released, true);
    });

    test('a failure to unlock does not mask the migration error', async () => {
        const body = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILES[0]), 'utf-8');
        const client = fakeClient({ failOn: body.slice(0, 60) });
        const originalQuery = client.query.bind(client);
        client.query = async (text, params) => {
            if (text.includes('pg_advisory_unlock')) throw new Error('connection terminated');
            return originalQuery(text, params);
        };

        // The unlock is best-effort — teardown releases the lock anyway — so its
        // own failure must not replace the real diagnosis.
        await assert.rejects(() => withClient(client)._migrate(), /Migration \d{4}_.* failed/);
    });
});

describe('AdminDatabase — pool surface', () => {
    test('ready() resolves the migration promise captured at construction', async () => {
        const db = withClient(fakeClient());
        db._ready = db._migrate();

        await db.ready();
        // Awaiting twice must not re-run migrations — callers await it freely.
        await db.ready();

        const client = await db.pool.connect();
        assert.equal(client.texts.filter(t => t === 'BEGIN').length, MIGRATION_FILES.length);
    });

    test('ready() rejects when migrations failed, so boot stops', async () => {
        const body = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILES[0]), 'utf-8');
        const db = withClient(fakeClient({ failOn: body.slice(0, 60) }));
        db._ready = db._migrate().catch(err => Promise.reject(err));

        await assert.rejects(() => db.ready(), /Migration .* failed/);
    });

    test('query delegates straight to the pool', async () => {
        const db = withClient(fakeClient());

        await db.query('SELECT 1 FROM orch_system_admins WHERE id = $1', ['SAD_1']);

        assert.deepEqual(db.pool.queries, [{ text: 'SELECT 1 FROM orch_system_admins WHERE id = $1', params: ['SAD_1'] }]);
    });

    test('getPool exposes the pool and close ends it', async () => {
        const db = withClient(fakeClient());

        assert.equal(db.getPool(), db.pool);
        await db.close();
        assert.equal(db.pool.ended, true);
    });
});
