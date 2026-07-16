import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { NodeRegistry, ALERT_HISTORY_LIMIT } from '../../../../Packages/server/Orion-Orchestrator/lib/NodeRegistry.js';

const T0 = 1_784_000_000;

describe('NodeRegistry — lifecycle tracking', () => {
    test('hello registers the node online with identity', () => {
        const r = new NodeRegistry();
        const node = r.recordHello('W1', { serviceID: 's1' }, T0);
        assert.equal(node.online, true);
        assert.equal(node.hello.serviceID, 's1');
        assert.equal(r.getNode('W1').lastSeen, T0);
    });

    test('status updates lastStatus and liveness', () => {
        const r = new NodeRegistry();
        r.recordStatus('W1', { etsLockdown: false }, T0);
        const node = r.getNode('W1');
        assert.deepEqual(node.lastStatus, { etsLockdown: false });
        assert.equal(node.lastStatusAt, T0);
        assert.equal(node.online, true);
    });

    test('markOffline flips liveness with a reason and a later touch recovers', () => {
        const r = new NodeRegistry();
        r.recordHello('W1', {}, T0);
        r.markOffline('W1', 'graceful-shutdown');
        assert.equal(r.getNode('W1').online, false);
        assert.equal(r.getNode('W1').offlineReason, 'graceful-shutdown');

        r.touch('W1', T0 + 10);
        assert.equal(r.getNode('W1').online, true);
        assert.equal(r.getNode('W1').offlineReason, null);
    });

    test('alert history is capped', () => {
        const r = new NodeRegistry();
        for (let i = 0; i < ALERT_HISTORY_LIMIT + 10; i++) {
            r.recordAlert('W1', { type: `a-${i}` }, T0 + i);
        }
        const alerts = r.getNode('W1').alerts;
        assert.equal(alerts.length, ALERT_HISTORY_LIMIT);
        // Oldest entries were dropped, newest kept
        assert.equal(alerts.at(-1).type, `a-${ALERT_HISTORY_LIMIT + 9}`);
    });
});

describe('NodeRegistry — stale sweep', () => {
    test('flags silent nodes exactly once per outage', () => {
        const r = new NodeRegistry();
        r.recordHello('W1', {}, T0);
        r.recordHello('W2', {}, T0 + 100);

        // W1 is 120s silent, W2 only 20s
        const flipped = r.sweepStale(60, T0 + 120);
        assert.deepEqual(flipped.map(n => n.workerId), ['W1']);
        assert.equal(r.getNode('W1').online, false);
        assert.equal(r.getNode('W1').offlineReason, 'stale');
        assert.equal(r.getNode('W2').online, true);

        // Second sweep must not re-flag the same outage
        assert.equal(r.sweepStale(60, T0 + 240).length, 1); // now W2 flips, W1 does not
        assert.equal(r.sweepStale(60, T0 + 300).length, 0);
    });

    test('summarize counts online/offline', () => {
        const r = new NodeRegistry();
        r.recordHello('W1', {}, T0);
        r.recordHello('W2', {}, T0);
        r.markOffline('W2', 'stale');
        assert.deepEqual(r.summarize(), { total: 2, online: 1, offline: 1 });
    });
});

describe('NodeRegistry — hydration (orchestrator restart)', () => {
    test('restored nodes keep identity but come back OFFLINE until they prove liveness', () => {
        const r = new NodeRegistry();
        r.hydrate([
            { workerId: 'W1', hello: { serviceID: 's1' }, lastSeen: T0, lastStatusAt: T0, alerts: [{ type: 'a' }] },
            { workerId: 'W2', hello: null }
        ]);

        const w1 = r.getNode('W1');
        assert.equal(w1.online, false);
        assert.equal(w1.offlineReason, 'orch-restart');
        assert.equal(w1.hello.serviceID, 's1');
        assert.equal(w1.lastStatus, null); // stale status snapshots are never restored as truth
        assert.equal(w1.alerts.length, 1);

        r.touch('W1', T0 + 100);
        assert.equal(r.getNode('W1').online, true);
    });

    test('hydration never clobbers a live record and tolerates junk', () => {
        const r = new NodeRegistry();
        r.recordHello('W1', { serviceID: 'live' }, T0);
        r.hydrate([{ workerId: 'W1', hello: { serviceID: 'stale' } }, null, { noWorkerId: true }]);
        assert.equal(r.getNode('W1').hello.serviceID, 'live');
        assert.equal(r.getNode('W1').online, true);
        assert.equal(r.getNodes().length, 1);
    });
});
