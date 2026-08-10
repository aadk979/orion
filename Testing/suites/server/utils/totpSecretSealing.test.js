// logger.js must be evaluated before GlobalAccessPoint.js (circular; see fileResponse.test.js).
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { KeyVaultManager } from '../../../../Packages/server/Orion-core/lib/Utils/Core/KeyVault/KeyVaultManager.js';
import { EncryptionKeyManager, ENVELOPE_PREFIX, LEGACY_PREFIX } from '../../../../Packages/server/Orion-core/lib/Utils/Core/KeyVault/EncryptionKeyManager.js';

/**
 * Envelope encryption for field data.
 *
 * These tests drive EncryptionKeyManager against an in-memory stand-in for the
 * DEK ledger, so they exercise the real seal/open/rotate logic without needing
 * Postgres or a live vault.
 */

// ── In-memory orion_encryption_keys ──────────────────────────────────────────

const createFakeDatabase = () => {
    const rows = [];

    // Transaction bookkeeping, so tests can assert that multi-statement work is
    // actually wrapped rather than merely appearing to succeed.
    const transactions = { begun: 0, committed: 0, rolledBack: 0, released: 0, snapshot: null };

    const database = {
        rows,
        transactions,

        // The real PostgresService exposes a pool for transactional work; the
        // double has to model that or it silently diverges from production.
        getPool: () => ({
            connect: async () => ({
                query: (text, params) => database.query(text, params),
                release: () => {
                    transactions.released += 1;
                }
            })
        }),

        query: async (text, params = []) => {
            const sql = text.replace(/\s+/g, ' ').trim();

            // ROLLBACK genuinely restores the pre-transaction rows. A double that
            // counts rollbacks without undoing them would report failures real
            // Postgres never produces, and hide the ones it does.
            if (sql === 'BEGIN') {
                transactions.begun += 1;
                transactions.snapshot = rows.map(row => ({ ...row }));
                return { rows: [], rowCount: 0 };
            }
            if (sql === 'COMMIT') {
                transactions.committed += 1;
                transactions.snapshot = null;
                return { rows: [], rowCount: 0 };
            }
            if (sql === 'ROLLBACK') {
                transactions.rolledBack += 1;
                if (transactions.snapshot) {
                    rows.length = 0;
                    rows.push(...transactions.snapshot);
                    transactions.snapshot = null;
                }
                return { rows: [], rowCount: 0 };
            }

            if (sql.startsWith("SELECT * FROM orion_encryption_keys WHERE state = 'active'")) {
                return { rows: rows.filter(r => r.state === 'active').slice(-1), rowCount: 0 };
            }
            if (sql.startsWith('SELECT * FROM orion_encryption_keys WHERE version')) {
                return { rows: rows.filter(r => Number(r.version) === Number(params[0])) };
            }
            if (sql.includes('COALESCE(MAX(version), 0) + 1')) {
                return { rows: [{ version: rows.reduce((max, r) => Math.max(max, Number(r.version)), 0) + 1 }] };
            }
            if (sql.startsWith("UPDATE orion_encryption_keys SET state = 'retired'")) {
                rows.filter(r => r.state === 'active').forEach(r => (r.state = 'retired'));
                return { rows: [], rowCount: 0 };
            }
            if (sql.startsWith('INSERT INTO orion_encryption_keys')) {
                const row = {
                    version: params[0],
                    wrapped_key: params[1],
                    provider: params[2],
                    key_ref: params[3],
                    kek_version: params[4],
                    algorithm: params[5],
                    state: 'active'
                };
                rows.push(row);
                return { rows: [row], rowCount: 1 };
            }
            if (sql.startsWith('UPDATE orion_encryption_keys SET wrapped_key')) {
                const row = rows.find(r => Number(r.version) === Number(params[4]));
                if (row) Object.assign(row, { wrapped_key: params[0], key_ref: params[1], kek_version: params[2], algorithm: params[3] });
                return { rows: [], rowCount: 1 };
            }
            // Field re-encryption / inventory queries: no tables in this harness.
            return { rows: [], rowCount: 0 };
        }
    };

    return database;
};

const INLINE_KEY = 'unit-test-key-that-is-long-enough-to-pass-32';

// 'db' is a LOCKED GlobalAccessPoint key — it can only be set once per process.
// One shared fake, truncated per test, is therefore the only way to give each
// test a clean ledger.
const database = createFakeDatabase();
globalAccessPoint.setValue('db', database);

const buildManagers = async ({ legacyKey = null, provider = { provider: 'INLINE_KEY', key: INLINE_KEY }, clusterMode = false } = {}) => {
    database.rows.length = 0;
    Object.assign(database.transactions, { begun: 0, committed: 0, rolledBack: 0, released: 0, snapshot: null });

    const vault = new KeyVaultManager(provider, { clusterMode });
    await vault.initialize();

    const keys = new EncryptionKeyManager(vault, { legacyKey });
    await keys.initialize();

    return { vault, keys, database };
};

/** Seals a value the way the pre-vault release did, for compatibility tests. */
const legacySeal = (plain, key) => {
    const derived = crypto.createHash('sha256').update(String(key)).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', derived, iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);

    return `${LEGACY_PREFIX}${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
};

describe('Field encryption — envelope sealing', () => {
    test('the inline provider passes its wrap/unwrap round trip and yields a usable DEK', async () => {
        const { vault, keys } = await buildManagers();

        assert.equal(vault.available, true);
        assert.equal(keys.available, true);
        assert.equal(keys.activeVersion, 1);
    });

    test('seal → open round-trips and stamps the active DEK version', async () => {
        const { keys } = await buildManagers();

        const sealed = await keys.seal('JBSWY3DPEHPK3PXP');

        assert.ok(sealed.startsWith(`${ENVELOPE_PREFIX}1.`), 'envelope names the DEK version that produced it');
        assert.notEqual(sealed, 'JBSWY3DPEHPK3PXP');
        assert.equal(await keys.open(sealed), 'JBSWY3DPEHPK3PXP');
    });

    test('sealing is non-deterministic (fresh IV per call)', async () => {
        const { keys } = await buildManagers();

        assert.notEqual(await keys.seal('JBSWY3DPEHPK3PXP'), await keys.seal('JBSWY3DPEHPK3PXP'));
    });

    test('null / undefined pass through both directions', async () => {
        const { keys } = await buildManagers();

        assert.equal(await keys.seal(null), null);
        assert.equal(await keys.open(null), null);
        assert.equal(await keys.seal(undefined), undefined);
        assert.equal(await keys.open(undefined), undefined);
    });

    test('pre-encryption plaintext rows pass through open() untouched', async () => {
        const { keys } = await buildManagers();

        assert.equal(await keys.open('LEGACYPLAINTEXTSECRET'), 'LEGACYPLAINTEXTSECRET');
    });

    test('tampered ciphertext fails GCM authentication and reports unreadable, never plaintext', async () => {
        const { keys } = await buildManagers();

        const sealed = await keys.seal('JBSWY3DPEHPK3PXP');
        const [version, iv, tag, ct] = sealed.slice(ENVELOPE_PREFIX.length).split('.');

        const corrupted = Buffer.from(ct, 'base64');
        corrupted[0] ^= 0xff;

        assert.equal(await keys.open(`${ENVELOPE_PREFIX}${version}.${iv}.${tag}.${corrupted.toString('base64')}`), null);
    });

    test('the DEK version is authenticated — re-pointing an envelope at another version fails', async () => {
        const { keys } = await buildManagers();

        const sealed = await keys.seal('JBSWY3DPEHPK3PXP');
        const parts = sealed.slice(`${ENVELOPE_PREFIX}1.`.length);

        // Version 2 does not exist; the point is that the AAD binding means the
        // version cannot be edited in the database to select a different key.
        assert.equal(await keys.open(`${ENVELOPE_PREFIX}2.${parts}`), null);
    });

    test('open() returns null rather than throwing when a value cannot be decrypted', async () => {
        const { keys } = await buildManagers();

        // A well-formed envelope from a foreign key. Callers depend on null so a
        // key problem degrades the login path instead of 500ing it.
        const foreign = `${ENVELOPE_PREFIX}1.${Buffer.alloc(12).toString('base64')}.${Buffer.alloc(16).toString('base64')}.${Buffer.alloc(20).toString('base64')}`;

        assert.equal(await keys.open(foreign), null);
    });
});

describe('Field encryption — legacy enc.v1 compatibility', () => {
    test('rows sealed by the pre-vault release are readable when the old key is supplied', async () => {
        const { keys } = await buildManagers({ legacyKey: 'the-original-inline-key' });

        assert.equal(await keys.open(legacySeal('JBSWY3DPEHPK3PXP', 'the-original-inline-key')), 'JBSWY3DPEHPK3PXP');
    });

    test('a legacy row without its key reports unreadable instead of throwing', async () => {
        const { keys } = await buildManagers({ legacyKey: null });

        assert.equal(await keys.open(legacySeal('JBSWY3DPEHPK3PXP', 'some-other-key')), null);
    });

    test('legacy and plaintext values are both flagged for upgrade on next write', async () => {
        const { keys } = await buildManagers({ legacyKey: 'the-original-inline-key' });

        assert.equal(keys.needsUpgrade(legacySeal('X', 'the-original-inline-key')), true);
        assert.equal(keys.needsUpgrade('PLAINTEXT'), true);
        assert.equal(keys.needsUpgrade(await keys.seal('X')), false);
    });
});

describe('Field encryption — unavailable vault', () => {
    test('seal() REFUSES rather than silently storing plaintext', async () => {
        const { keys } = await buildManagers({ provider: {} });

        assert.equal(keys.available, false);

        // The pre-vault release fell back to plaintext with a warning here.
        // That silent downgrade of at-rest protection is what this rejection
        // exists to prevent.
        await assert.rejects(() => keys.seal('JBSWY3DPEHPK3PXP'), error => error.code === 'KEYVAULT::UNAVAILABLE');
    });

    test('an unconfigured vault explains itself instead of failing silently', async () => {
        const vault = new KeyVaultManager({}, { clusterMode: false });

        assert.equal(await vault.initialize(), false);
        assert.match(vault.unavailableReason, /utilities\.dataEncryption is not configured/);
    });

    test('an inline key is REFUSED in cluster mode', async () => {
        const vault = new KeyVaultManager({ provider: 'INLINE_KEY', key: INLINE_KEY }, { clusterMode: true });

        assert.equal(await vault.initialize(), false);
        assert.match(vault.unavailableReason, /refused in cluster mode/);
    });

    test('an inline key is ACCEPTED on a single instance', async () => {
        const vault = new KeyVaultManager({ provider: 'INLINE_KEY', key: INLINE_KEY }, { clusterMode: false });

        assert.equal(await vault.initialize(), true);
    });
});

describe('Field encryption — SQL safety', () => {
    test('creating a DEK retires and inserts inside ONE transaction', async () => {
        const { database } = await buildManagers();

        // Split across two autocommits, a crash between them leaves the ledger
        // with no active row and a concurrent node minting a second key.
        assert.equal(database.transactions.begun, 1);
        assert.equal(database.transactions.committed, 1);
        assert.equal(database.transactions.rolledBack, 0);
        assert.equal(database.transactions.released, 1, 'the client is returned to the pool');
    });

    test('losing the creation race rolls back rather than leaving the winner retired', async () => {
        const { keys, database } = await buildManagers();

        const before = { ...database.transactions };

        // Simulate another node having already inserted this version.
        const originalQuery = database.query;
        database.query = async (text, params) => {
            if (text.replace(/\s+/g, ' ').trim().startsWith('INSERT INTO orion_encryption_keys')) {
                return { rows: [], rowCount: 0 };
            }
            return originalQuery(text, params);
        };

        try {
            await keys.rotateDek({ reencrypt: false });
        } finally {
            database.query = originalQuery;
        }

        assert.equal(database.transactions.rolledBack, before.rolledBack + 1, 'the losing transaction rolled back');
        assert.equal(database.transactions.committed, before.committed, 'nothing was committed');
    });

    test('every DEK ledger write binds its values rather than interpolating them', async () => {
        const seen = [];
        const { keys, database } = await buildManagers();

        const originalQuery = database.query;
        database.query = async (text, params) => {
            seen.push({ text, params });
            return originalQuery(text, params);
        };

        try {
            await keys.rotateKek();
        } finally {
            database.query = originalQuery;
        }

        const writes = seen
            .map(entry => ({ ...entry, text: entry.text.replace(/\s+/g, ' ').trim() }))
            .filter(entry => /INSERT INTO orion_encryption_keys|UPDATE orion_encryption_keys SET wrapped_key/.test(entry.text));

        assert.ok(writes.length > 0, `no ledger writes captured from: ${seen.map(e => e.text.slice(0, 30)).join(' | ')}`);

        for (const { text, params } of writes) {
            // Wrapped key material and provider metadata must arrive as bind
            // values; a blob interpolated into SQL text would be both an
            // injection surface and a query-plan cache poisoner.
            assert.ok(Array.isArray(params) && params.length > 0, `${text.slice(0, 40)}… binds parameters`);
            assert.doesNotMatch(text, /\$\{/, 'no template interpolation survives into SQL text');
        }
    });

    test('the wipe runs as one transaction so companion tables cannot desync', async () => {
        const { keys, database } = await buildManagers();
        const before = { ...database.transactions };

        await keys.wipeEncryptedFields(null);

        assert.equal(database.transactions.begun, before.begun + 1);
        assert.equal(database.transactions.committed, before.committed + 1);
        assert.equal(database.transactions.released, before.released + 1);
    });

    test('a failing wipe rolls back instead of half-clearing', async () => {
        const { keys, database } = await buildManagers();
        const before = { ...database.transactions };

        const originalQuery = database.query;
        database.query = async (text, params) => {
            if (/UPDATE user_security/.test(text)) throw new Error('companion statement failed');
            return originalQuery(text, params);
        };

        try {
            await assert.rejects(() => keys.wipeEncryptedFields(null), /companion statement failed/);
        } finally {
            database.query = originalQuery;
        }

        assert.equal(database.transactions.rolledBack, before.rolledBack + 1);
        assert.equal(database.transactions.committed, before.committed, 'a partial wipe was never committed');
    });

    test('re-encryption guards every write with the value it read', async () => {
        const { keys, database } = await buildManagers();

        const sealed = await keys.seal('JBSWY3DPEHPK3PXP');
        const seen = [];

        const originalQuery = database.query;
        database.query = async (text, params) => {
            const sql = text.replace(/\s+/g, ' ').trim();

            // One stale row to re-encrypt, then nothing.
            if (sql.startsWith('SELECT user_uid, secret')) {
                const first = seen.some(entry => entry.startsWith('UPDATE user_totp'));
                return first ? { rows: [], rowCount: 0 } : { rows: [{ user_uid: 'u1', secret: sealed, pending_secret: null }], rowCount: 1 };
            }

            seen.push(sql);
            if (sql.startsWith('UPDATE user_totp')) return { rows: [], rowCount: 1 };
            return originalQuery(text, params);
        };

        try {
            await keys.rotateDek({ reencrypt: true });
        } finally {
            database.query = originalQuery;
        }

        const update = seen.find(sql => sql.startsWith('UPDATE user_totp'));

        assert.ok(update, 'the stale row was re-encrypted');
        // Without this guard, a user enrolling TOTP between the SELECT and the
        // UPDATE would have their new secret overwritten by a re-sealed copy of
        // the old one.
        assert.match(update, /IS NOT DISTINCT FROM/, 'the update is a compare-and-swap on the value that was read');
    });
});

describe('Field encryption — DEK rotation', () => {
    test('rotation activates a new version while old envelopes stay readable', async () => {
        const { keys } = await buildManagers();

        const sealedUnderV1 = await keys.seal('JBSWY3DPEHPK3PXP');

        const outcome = await keys.rotateDek({ reencrypt: false });

        assert.equal(outcome.previousVersion, 1);
        assert.equal(outcome.version, 2);
        assert.equal(keys.activeVersion, 2);

        // New writes use v2 …
        assert.ok((await keys.seal('NEWSECRET')).startsWith(`${ENVELOPE_PREFIX}2.`));
        // … and nothing sealed under v1 was stranded.
        assert.equal(await keys.open(sealedUnderV1), 'JBSWY3DPEHPK3PXP');
    });

    test('KEK rotation re-wraps the DEK without changing the data envelope', async () => {
        const { keys } = await buildManagers();

        const sealed = await keys.seal('JBSWY3DPEHPK3PXP');
        const result = await keys.rotateKek();

        assert.equal(result.rewrapped, true);
        assert.equal(result.dekVersion, 1);
        // The inline provider cannot rotate its own key material, and says so
        // rather than pretending it did.
        assert.equal(result.kekRotated, false);
        assert.match(result.reason, /cannot be rotated/i);

        assert.equal(await keys.open(sealed), 'JBSWY3DPEHPK3PXP');
    });
});
