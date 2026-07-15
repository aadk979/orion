import '../../../helpers/bootstrap.js';
import test, { describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryDB } from '../../../../Packages/server/Orion-core/lib/Utils/Databases/EphemeralDatabases/localMemoryDB.js';

describe('InMemoryDB — basic CRUD', () => {
    let db;
    beforeEach(() => {
        db = new InMemoryDB('test');
    });

    test('addData then getData returns the value and exist=true', () => {
        assert.deepEqual(db.addData('k', 'v'), { error: false, completed: true });
        const res = db.getData('k');
        assert.equal(res.error, false);
        assert.equal(res.exist, true);
        assert.equal(res.data, 'v');
    });

    test('getData for a missing key reports exist=false', () => {
        const res = db.getData('missing');
        assert.equal(res.exist, false);
        assert.equal(res.data, undefined);
    });

    test('has() reflects presence', () => {
        db.addData('k', 1);
        assert.equal(db.has('k').data, true);
        assert.equal(db.has('nope').data, false);
    });

    test('deleteData removes an entry', () => {
        db.addData('k', 1);
        assert.equal(db.deleteData('k').error, false);
        assert.equal(db.has('k').data, false);
        // deleting again reports expired/absent
        assert.equal(db.deleteData('k').expired, true);
    });

    test('size / keys reflect contents', () => {
        db.addData('a', 1);
        db.addData('b', 2);
        assert.equal(db.size().data, 2);
        assert.deepEqual(db.keys().data.sort(), ['a', 'b']);
    });

    test('clear empties the store', () => {
        db.addData('a', 1);
        db.clear();
        assert.equal(db.size().data, 0);
    });
});

describe('InMemoryDB — value isolation (structuredClone)', () => {
    test('stored objects are decoupled from the caller reference', () => {
        const db = new InMemoryDB();
        const original = { nested: { count: 1 } };
        db.addData('obj', original);

        original.nested.count = 999; // mutate after insert
        assert.equal(db.getData('obj').data.nested.count, 1);

        const readOut = db.getData('obj').data;
        readOut.nested.count = 555; // mutate the returned copy
        assert.equal(db.getData('obj').data.nested.count, 1);
    });
});

describe('InMemoryDB — TTL semantics', () => {
    afterEach(() => mock.timers.reset());

    test('inserting with an already-past ttl reports expired', () => {
        mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000_000 });
        const db = new InMemoryDB();
        const nowSec = Math.floor(Date.now() / 1000);
        const res = db.addData('k', 'v', nowSec - 1);
        assert.equal(res.expired, true);
    });

    test('entry survives until ttl then lazily + actively expires', () => {
        mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000_000 });
        const db = new InMemoryDB();
        const nowSec = Math.floor(Date.now() / 1000);

        db.addData('k', 'v', nowSec + 100);
        assert.equal(db.getData('k').exist, true);
        assert.equal(db.getTTL('k').data, 100);

        mock.timers.tick(101 * 1000); // fire the expiry timer + advance the clock
        assert.equal(db.getData('k').exist, false);
        assert.equal(db.has('k').data, false);
    });

    test('updateTTL and removeTTL manage expiry on an existing key', () => {
        mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10_000_000 });
        const db = new InMemoryDB();
        const nowSec = Math.floor(Date.now() / 1000);

        db.addData('k', 'v');
        assert.equal(db.getTTL('k').data, null); // no ttl yet

        db.updateTTL('k', nowSec + 50);
        assert.equal(db.getTTL('k').data, 50);

        db.removeTTL('k');
        assert.equal(db.getTTL('k').data, null);
        // value is retained after removing the ttl
        assert.equal(db.getData('k').exist, true);
    });

    test('updateTTL on a missing key reports expired/absent', () => {
        const db = new InMemoryDB();
        assert.equal(db.updateTTL('ghost', 999).expired, true);
    });
});
