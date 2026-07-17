import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { AuditLog } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/AuditLog.js';

/**
 * In-memory stand-in for the orch_admin_audit table: enough SQL awareness to
 * serve AuditLog's three query shapes (last-hash lookup, insert, full scan).
 * It also simulates JSONB's key-order normalization by round-tripping details
 * through sorted-key JSON — the exact property the canonical hash must survive.
 */
class FakeAuditDb {
    constructor() {
        this.rows = [];
        this._id = 0;
    }

    _jsonbRoundTrip(value) {
        const sort = (v) => {
            if (Array.isArray(v)) return v.map(sort);
            if (v && typeof v === 'object') {
                return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
            }
            return v;
        };
        return sort(value);
    }

    async query(text, params) {
        if (text.includes('ORDER BY id DESC LIMIT 1')) {
            const last = this.rows[this.rows.length - 1];
            return { rows: last ? [{ hash: last.hash }] : [] };
        }
        if (text.startsWith('SELECT * FROM orch_admin_audit') || text.includes('ORDER BY id ASC')) {
            return { rows: [...this.rows] };
        }
        if (text.includes('INSERT INTO orch_admin_audit')) {
            const [admin_id, admin_email, ip, method, path, action, resource, decision, status_code, details, prev_hash, hash] = params;
            const row = {
                id: ++this._id,
                admin_id, admin_email, ip, method, path, action, resource, decision, status_code,
                details: this._jsonbRoundTrip(JSON.parse(details)),
                prev_hash, hash
            };
            this.rows.push(row);
            return { rows: [row] };
        }
        throw new Error(`FakeAuditDb: unexpected query — ${text.slice(0, 60)}`);
    }
}

describe('AuditLog — hash chain', () => {
    test('rows chain: each prev_hash equals the previous row hash', async () => {
        const db = new FakeAuditDb();
        const log = new AuditLog(db);

        await log.write({ adminId: 'A1', adminEmail: 'a@x.io', action: 'auth:login-completed', decision: 'allow', details: { z: 1, a: 2 } });
        await log.write({ adminId: 'A1', adminEmail: 'a@x.io', action: 'cluster:read:status', resource: 'cluster', decision: 'allow', statusCode: 200 });
        await log.write({ adminId: 'A2', adminEmail: 'b@x.io', action: 'cluster:ops:lock', resource: 'cluster', decision: 'deny', statusCode: 403 });

        assert.equal(db.rows[0].prev_hash, null);
        assert.equal(db.rows[1].prev_hash, db.rows[0].hash);
        assert.equal(db.rows[2].prev_hash, db.rows[1].hash);
    });

    test('verifyChain accepts an intact chain even after JSONB key reordering', async () => {
        const db = new FakeAuditDb();
        const log = new AuditLog(db);

        // Deliberately unsorted keys in details — the fake db re-sorts them the
        // way Postgres JSONB does, and verification must still pass.
        await log.write({ action: 'a', decision: 'allow', details: { zebra: 1, alpha: { nested: [3, { b: 1, a: 2 }] } } });
        await log.write({ action: 'b', decision: 'deny', details: { m: 'x' } });

        const result = await log.verifyChain();
        assert.deepEqual(result, { valid: true, checked: 2, brokenAtId: null });
    });

    test('verifyChain pinpoints a tampered row', async () => {
        const db = new FakeAuditDb();
        const log = new AuditLog(db);

        await log.write({ action: 'a', decision: 'allow' });
        await log.write({ action: 'b', decision: 'allow' });
        await log.write({ action: 'c', decision: 'allow' });

        db.rows[1].decision = 'deny'; // post-hoc tampering

        const result = await log.verifyChain();
        assert.equal(result.valid, false);
        assert.equal(result.brokenAtId, 2);
    });

    test('concurrent writes serialize — the chain never forks', async () => {
        const db = new FakeAuditDb();
        const log = new AuditLog(db);

        await Promise.all(
            Array.from({ length: 25 }, (_, i) => log.write({ action: `evt-${i}`, decision: 'allow' }))
        );

        assert.equal(db.rows.length, 25);
        for (let i = 1; i < db.rows.length; i++) {
            assert.equal(db.rows[i].prev_hash, db.rows[i - 1].hash, `row ${i + 1} chains to row ${i}`);
        }
        assert.equal((await log.verifyChain()).valid, true);
    });

    test('a failed insert does not poison later writes', async () => {
        const db = new FakeAuditDb();
        const log = new AuditLog(db);

        const originalQuery = db.query.bind(db);
        let failNext = true;
        db.query = async (text, params) => {
            if (failNext && text.includes('INSERT')) {
                failNext = false;
                throw new Error('connection reset');
            }
            return originalQuery(text, params);
        };

        await assert.rejects(log.write({ action: 'doomed', decision: 'allow' }));
        await log.write({ action: 'survivor', decision: 'allow' });

        assert.equal(db.rows.length, 1);
        assert.equal(db.rows[0].action, 'survivor');
        assert.equal((await log.verifyChain()).valid, true);
    });
});
