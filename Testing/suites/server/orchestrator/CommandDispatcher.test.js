import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { CommandDispatcher } from '../../../../Packages/server/Orion-Orchestrator/lib/CommandDispatcher.js';
import { ClusterEvents } from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';

let idCounter = 0;
const makeIdFn = () => () => `CMD-${++idCounter}`;

describe('CommandDispatcher — resolution', () => {
    test('resolves when the matching result arrives from the right worker', async () => {
        const sent = [];
        const d = new CommandDispatcher(async (...args) => { sent.push(args); }, makeIdFn());

        const promise = d.execute('W1', 'node:ping', { x: 1 }, 5000);
        assert.equal(d.pendingCount, 1);

        const [workerId, eventName, envelope] = sent[0];
        assert.equal(workerId, 'W1');
        assert.equal(eventName, ClusterEvents.COMMAND);
        assert.equal(envelope.action, 'node:ping');

        const matched = d.resolveResult('W1', { commandId: envelope.commandId, ok: true, result: { pong: true } });
        assert.equal(matched, true);

        const outcome = await promise;
        assert.equal(outcome.workerId, 'W1');
        assert.equal(outcome.ok, true);
        assert.equal(d.pendingCount, 0);
    });

    test('a result from a DIFFERENT worker cannot answer the command', async () => {
        const d = new CommandDispatcher(async () => {}, makeIdFn());
        const promise = d.execute('W1', 'node:ping', {}, 200);

        // Impersonation attempt: W2 replies with W1's commandId
        const envelopeId = `CMD-${idCounter}`;
        assert.equal(d.resolveResult('W2', { commandId: envelopeId, ok: true }), false);
        assert.equal(d.pendingCount, 1);

        await assert.rejects(promise, /timed out/);
    });

    test('unknown or late results are reported unmatched', () => {
        const d = new CommandDispatcher(async () => {}, makeIdFn());
        assert.equal(d.resolveResult('W1', { commandId: 'CMD-nope' }), false);
        assert.equal(d.resolveResult('W1', undefined), false);
    });
});

describe('CommandDispatcher — failure paths', () => {
    test('times out when no result arrives', async () => {
        const d = new CommandDispatcher(async () => {}, makeIdFn());
        await assert.rejects(d.execute('W1', 'node:ping', {}, 50), /timed out after 50ms/);
        assert.equal(d.pendingCount, 0);
    });

    test('fails fast when the transport send rejects', async () => {
        const d = new CommandDispatcher(async () => { throw new Error('tunnel down'); }, makeIdFn());
        const start = Date.now();
        await assert.rejects(d.execute('W1', 'node:ping', {}, 10_000), /tunnel down/);
        assert.ok(Date.now() - start < 5000, 'should not have waited for the timeout');
        assert.equal(d.pendingCount, 0);
    });

    test('clear() rejects every in-flight command', async () => {
        const d = new CommandDispatcher(async () => {}, makeIdFn());
        const p1 = d.execute('W1', 'a', {}, 60_000);
        const p2 = d.execute('W2', 'b', {}, 60_000);
        assert.equal(d.pendingCount, 2);

        d.clear('Shutting down');
        await assert.rejects(p1, /Shutting down/);
        await assert.rejects(p2, /Shutting down/);
        assert.equal(d.pendingCount, 0);
    });
});
