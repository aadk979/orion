import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    PROTOCOL_VERSION,
    ClusterEvents,
    ClusterCommands,
    ClusterAlerts,
    ALERT_SEVERITIES,
    buildCommandEnvelope,
    buildCommandResult,
    buildAlert,
    isKnownCommand
} from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';

describe('Cluster protocol — contract stability', () => {
    test('event names are orion-namespaced and unique', () => {
        const names = Object.values(ClusterEvents);
        assert.ok(names.every(n => n.startsWith('orion:')));
        assert.equal(new Set(names).size, names.length);
    });

    test('command actions are unique', () => {
        const actions = Object.values(ClusterCommands);
        assert.equal(new Set(actions).size, actions.length);
    });

    test('none of the reserved r-sync event names are used', () => {
        // system:flush is r-sync's built-in worker wipe — the protocol must
        // never collide with it.
        assert.ok(!Object.values(ClusterEvents).includes('system:flush'));
    });

    test('isKnownCommand matches the allowlist exactly', () => {
        for (const action of Object.values(ClusterCommands)) {
            assert.equal(isKnownCommand(action), true, `expected known: ${action}`);
        }
        assert.equal(isKnownCommand('system:flush'), false);
        assert.equal(isKnownCommand('made-up'), false);
        assert.equal(isKnownCommand(undefined), false);
    });
});

describe('Cluster protocol — envelope builders', () => {
    test('command envelope carries protocol version, id, action, args, issuedBy', () => {
        const env = buildCommandEnvelope('CMD-1', ClusterCommands.PING, { a: 1 });
        assert.deepEqual(env, {
            protocolVersion: PROTOCOL_VERSION,
            commandId: 'CMD-1',
            action: ClusterCommands.PING,
            args: { a: 1 },
            issuedBy: { type: 'system', id: null, email: null }
        });
    });

    test('command envelope attributes an admin principal when given', () => {
        const env = buildCommandEnvelope('CMD-2', ClusterCommands.PING, {}, {
            type: 'admin', id: 'SAD-1', email: 'ops@example.com'
        });
        assert.deepEqual(env.issuedBy, { type: 'admin', id: 'SAD-1', email: 'ops@example.com' });
    });

    test('command envelope coerces unknown principal types to system', () => {
        const env = buildCommandEnvelope('CMD-3', ClusterCommands.PING, {}, { type: 'evil', id: 'x' });
        assert.equal(env.issuedBy.type, 'system');
    });

    test('successful result nests payload under result', () => {
        const res = buildCommandResult('CMD-1', 'x', true, { pong: true });
        assert.equal(res.ok, true);
        assert.deepEqual(res.result, { pong: true });
        assert.equal(res.error, undefined);
    });

    test('failed result nests payload under error', () => {
        const res = buildCommandResult('CMD-1', 'x', false, { code: 'E' });
        assert.equal(res.ok, false);
        assert.deepEqual(res.error, { code: 'E' });
        assert.equal(res.result, undefined);
    });

    test('alert builder clamps unknown severities to info', () => {
        assert.equal(buildAlert(ClusterAlerts.NODE_STALE, 'critical').severity, 'critical');
        assert.equal(buildAlert(ClusterAlerts.NODE_STALE, 'not-a-severity').severity, 'info');
        assert.ok(ALERT_SEVERITIES.includes(buildAlert('x', undefined).severity));
    });
});
