import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { PolicyEngine, DEFAULT_POLICIES } from '../../../../Packages/server/Orion-Orchestrator/lib/PolicyEngine.js';
import { ClusterAlerts, ClusterCommands } from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';

const makeExecutors = () => {
    const calls = { escalations: [], commands: [], consensus: [] };
    return {
        calls,
        executors: {
            escalate: async e => {
                calls.escalations.push(e);
                return e;
            },
            command: async (workerId, action, args) => {
                calls.commands.push({ workerId, action, args });
                return { workerId, ok: true, result: { etsLockdown: true, safeMode: true } };
            },
            consensus: async (topic, params, options) => {
                calls.consensus.push({ topic, params, options });
                return { topic, decided: true, accepted: false, ratio: 0.2 };
            }
        }
    };
};

const alert = (type, severity = 'critical') => ({ type, severity, details: {} });

describe('PolicyEngine — defaults', () => {
    test('every protocol alert type a node or the orch can raise has a matching default rule', () => {
        const covered = new Set(DEFAULT_POLICIES.flatMap(r => r.on));
        const expected = [
            ClusterAlerts.ETS_LOCKDOWN_ENGAGED,
            ClusterAlerts.ETS_LOCKDOWN_LIFTED,
            ClusterAlerts.EVENT_LOOP_DEGRADED,
            ClusterAlerts.EVENT_LOOP_RECOVERED,
            ClusterAlerts.MEMORY_PRESSURE,
            ClusterAlerts.MEMORY_RECOVERED,
            ClusterAlerts.SERVER_LOCKED,
            ClusterAlerts.SERVER_UNLOCKED,
            ClusterAlerts.TUNNEL_RESYNCED,
            ClusterAlerts.NODE_STALE,
            ClusterAlerts.NODE_RECOVERED
        ];
        for (const type of expected) {
            assert.ok(covered.has(type), `no default policy covers ${type}`);
        }
    });

    test('ets lockdown alert verifies status THEN escalates critical with the snapshot attached', async () => {
        const { calls, executors } = makeExecutors();
        const engine = new PolicyEngine(executors);

        const outcomes = await engine.handleAlert('W1', alert(ClusterAlerts.ETS_LOCKDOWN_ENGAGED), { hello: { appName: 'A', serviceID: 's1' } });

        assert.equal(outcomes.length, 1);
        assert.ok(outcomes[0].actions.every(a => a.ok));
        // verify-status ran against the alerting node
        assert.deepEqual(calls.commands[0], { workerId: 'W1', action: 'status:get', args: {} });
        // escalation carries confirmed state, node identity, and severity
        assert.equal(calls.escalations.length, 1);
        assert.equal(calls.escalations[0].severity, 'critical');
        assert.equal(calls.escalations[0].workerId, 'W1');
        assert.equal(calls.escalations[0].details.verifiedStatus.etsLockdown, true);
        assert.equal(calls.escalations[0].details.appName, 'A');
    });
});

describe('PolicyEngine — cooldowns and matching', () => {
    test('cooldown suppresses re-execution per node but not other nodes', async () => {
        const { calls, executors } = makeExecutors();
        const engine = new PolicyEngine(executors, {
            useDefaults: false,
            rules: [{ id: 'r1', on: [ClusterAlerts.NODE_STALE], cooldownSec: 300, actions: [{ type: 'escalate' }] }]
        });

        await engine.handleAlert('W1', alert(ClusterAlerts.NODE_STALE));
        await engine.handleAlert('W1', alert(ClusterAlerts.NODE_STALE)); // suppressed
        await engine.handleAlert('W2', alert(ClusterAlerts.NODE_STALE)); // different node — runs

        assert.equal(calls.escalations.length, 2);
        assert.deepEqual(
            calls.escalations.map(e => e.workerId),
            ['W1', 'W2']
        );
    });

    test('minSeverity filters below-threshold alerts', async () => {
        const { calls, executors } = makeExecutors();
        const engine = new PolicyEngine(executors, {
            useDefaults: false,
            rules: [{ id: 'r1', on: ['x'], minSeverity: 'critical', actions: [{ type: 'escalate' }] }]
        });

        await engine.handleAlert('W1', { type: 'x', severity: 'warning' });
        assert.equal(calls.escalations.length, 0);
        await engine.handleAlert('W1', { type: 'x', severity: 'critical' });
        assert.equal(calls.escalations.length, 1);
    });

    test('unmatched alert types run nothing', async () => {
        const { calls, executors } = makeExecutors();
        const engine = new PolicyEngine(executors, { useDefaults: false, rules: [{ id: 'r1', on: ['a'], actions: [{ type: 'escalate' }] }] });
        const outcomes = await engine.handleAlert('W1', alert('b'));
        assert.equal(outcomes.length, 0);
        assert.equal(calls.escalations.length, 0);
    });
});

describe('PolicyEngine — action types', () => {
    test('consensus action attaches the vote outcome to context', async () => {
        const { calls, executors } = makeExecutors();
        const engine = new PolicyEngine(executors, {
            useDefaults: false,
            rules: [
                {
                    id: 'r1',
                    on: ['x'],
                    actions: [
                        { type: 'consensus', topic: 'node-healthy' },
                        { type: 'escalate', severity: 'critical' }
                    ]
                }
            ]
        });

        await engine.handleAlert('W1', alert('x'));
        assert.equal(calls.consensus[0].topic, 'node-healthy');
        assert.equal(calls.escalations[0].details.consensus.accepted, false);
    });

    test('action failures are captured per-action, not thrown', async () => {
        const { executors } = makeExecutors();
        executors.command = async () => {
            throw new Error('node unreachable');
        };
        const engine = new PolicyEngine(executors, {
            useDefaults: false,
            rules: [{ id: 'r1', on: ['x'], actions: [{ type: 'verify-status' }, { type: 'escalate' }] }]
        });

        const [outcome] = await engine.handleAlert('W1', alert('x'));
        assert.equal(outcome.actions[0].ok, false);
        assert.match(outcome.actions[0].error, /unreachable/);
        assert.equal(outcome.actions[1].ok, true); // later actions still run
    });

    test('schedule-command fires only if the status flag still holds', async () => {
        const { calls, executors } = makeExecutors();
        let flagValue = true;
        executors.command = async (workerId, action, args) => {
            calls.commands.push({ workerId, action, args });
            if (action === 'status:get') return { ok: true, result: { etsLockdown: flagValue } };
            return { ok: true, result: { applied: true } };
        };

        const engine = new PolicyEngine(executors, {
            useDefaults: false,
            rules: [
                {
                    id: 'auto-clear',
                    on: ['x'],
                    actions: [{ type: 'schedule-command', delaySec: 0.05, action: ClusterCommands.CLEAR_ETS_LOCKDOWN, onlyIfStatusFlag: 'etsLockdown' }]
                }
            ]
        });

        // Case 1: flag still true → command fires
        await engine.handleAlert('W1', alert('x'));
        await new Promise(r => setTimeout(r, 150));
        assert.deepEqual(
            calls.commands.map(c => c.action),
            ['status:get', ClusterCommands.CLEAR_ETS_LOCKDOWN]
        );

        // Case 2: flag resolved in the meantime → command skipped
        calls.commands.length = 0;
        flagValue = false;
        await engine.handleAlert('W2', alert('x'));
        await new Promise(r => setTimeout(r, 150));
        assert.deepEqual(
            calls.commands.map(c => c.action),
            ['status:get']
        );
    });

    test('stop() cancels pending scheduled commands', async () => {
        const { calls, executors } = makeExecutors();
        const engine = new PolicyEngine(executors, {
            useDefaults: false,
            rules: [{ id: 'r1', on: ['x'], actions: [{ type: 'schedule-command', delaySec: 0.05, action: 'server:unlock' }] }]
        });

        await engine.handleAlert('W1', alert('x'));
        engine.stop();
        await new Promise(r => setTimeout(r, 150));
        assert.equal(calls.commands.length, 0);
    });
});

describe('PolicyEngine — rule validation', () => {
    test('duplicate ids, empty matchers, and empty actions are rejected', () => {
        const { executors } = makeExecutors();
        assert.throws(
            () =>
                new PolicyEngine(executors, {
                    useDefaults: false,
                    rules: [
                        { id: 'a', on: ['x'], actions: [{ type: 'escalate' }] },
                        { id: 'a', on: ['y'], actions: [{ type: 'escalate' }] }
                    ]
                }),
            /unique ids/
        );
        assert.throws(
            () => new PolicyEngine(executors, { useDefaults: false, rules: [{ id: 'a', on: [], actions: [{ type: 'escalate' }] }] }),
            /non-empty "on"/
        );
        assert.throws(() => new PolicyEngine(executors, { useDefaults: false, rules: [{ id: 'a', on: ['x'], actions: [] }] }), /non-empty action/);
    });

    test('unknown action types surface as failed actions', async () => {
        const { executors } = makeExecutors();
        const engine = new PolicyEngine(executors, { useDefaults: false, rules: [{ id: 'r1', on: ['x'], actions: [{ type: 'nope' }] }] });
        const [outcome] = await engine.handleAlert('W1', alert('x'));
        assert.equal(outcome.actions[0].ok, false);
        assert.match(outcome.actions[0].error, /Unknown policy action/);
    });
});
