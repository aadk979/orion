import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { ClusterHealth } from '../../../../Packages/server/Orion-Orchestrator/lib/ClusterHealth.js';
import { ClusterStates } from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';

const NOW = 1_784_000_000;

const node = (workerId, { online = true, etsLockdown = false, elmDegraded = false, statusAge = 10 } = {}) => ({
    workerId,
    online,
    lastStatus: { status: { etsLockdown, elmDegraded } },
    lastStatusAt: NOW - statusAge
});

describe('ClusterHealth — node health rules', () => {
    test('offline, lockdown, degraded, and stale-status nodes are unhealthy', () => {
        const h = new ClusterHealth({ statusMaxAgeSeconds: 300 });
        assert.equal(h.isNodeUnhealthy(node('W', { online: false }), NOW), 'offline');
        assert.equal(h.isNodeUnhealthy(node('W', { etsLockdown: true }), NOW), 'ets-lockdown');
        assert.equal(h.isNodeUnhealthy(node('W', { elmDegraded: true }), NOW), 'elm-degraded');
        assert.equal(h.isNodeUnhealthy(node('W', { statusAge: 301 }), NOW), 'status-stale');
        assert.equal(h.isNodeUnhealthy(node('W'), NOW), null);
    });

    test('statusMaxAgeSeconds 0 disables the staleness rule', () => {
        const h = new ClusterHealth({ statusMaxAgeSeconds: 0 });
        assert.equal(h.isNodeUnhealthy(node('W', { statusAge: 9999 }), NOW), null);
    });

    test('a node that never reported status is not stale-flagged (lastStatusAt null)', () => {
        const h = new ClusterHealth();
        const n = { workerId: 'W', online: true, lastStatus: null, lastStatusAt: null };
        assert.equal(h.isNodeUnhealthy(n, NOW), null);
    });
});

describe('ClusterHealth — state computation', () => {
    test('empty fleet is FORMING', () => {
        const h = new ClusterHealth();
        assert.equal(h.evaluate([], NOW).targetState, ClusterStates.FORMING);
    });

    test('all healthy is HEALTHY', () => {
        const h = new ClusterHealth();
        const result = h.evaluate([node('W1'), node('W2')], NOW);
        assert.equal(result.targetState, ClusterStates.HEALTHY);
        assert.equal(result.unhealthy.length, 0);
    });

    test('one sick node in a large fleet is DEGRADED, not INCIDENT', () => {
        const h = new ClusterHealth(); // incidentRatio 0.5, minUnhealthyForIncident 2
        const result = h.evaluate([node('W1', { etsLockdown: true }), node('W2'), node('W3'), node('W4')], NOW);
        assert.equal(result.targetState, ClusterStates.DEGRADED);
        assert.deepEqual(result.unhealthy, [{ workerId: 'W1', reason: 'ets-lockdown' }]);
    });

    test('half the fleet down (>=2 nodes) is an INCIDENT', () => {
        const h = new ClusterHealth();
        const result = h.evaluate([node('W1', { online: false }), node('W2', { etsLockdown: true }), node('W3'), node('W4')], NOW);
        assert.equal(result.targetState, ClusterStates.INCIDENT);
        assert.equal(result.ratio, 0.5);
    });

    test('minUnhealthyForIncident stops single-node clusters from jumping to INCIDENT', () => {
        const h = new ClusterHealth();
        const result = h.evaluate([node('W1', { online: false })], NOW); // ratio 1.0 but only 1 node
        assert.equal(result.targetState, ClusterStates.DEGRADED);
    });
});

describe('ClusterHealth — transitions', () => {
    test('transitionTo reports the previous state once and null on no-op', () => {
        const h = new ClusterHealth();
        assert.equal(h.transitionTo(ClusterStates.HEALTHY), ClusterStates.FORMING);
        assert.equal(h.transitionTo(ClusterStates.HEALTHY), null);
        assert.equal(h.transitionTo(ClusterStates.INCIDENT), ClusterStates.HEALTHY);
        assert.equal(h.getSnapshot().state, ClusterStates.INCIDENT);
    });
});
