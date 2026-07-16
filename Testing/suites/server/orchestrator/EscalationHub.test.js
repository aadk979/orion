import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { EscalationHub, HISTORY_LIMIT } from '../../../../Packages/server/Orion-Orchestrator/lib/EscalationHub.js';
import { silenceConsole } from '../../../helpers/mocks.js';

describe('EscalationHub — channels', () => {
    test('custom channels receive normalized records', async () => {
        const hub = new EscalationHub();
        const seen = [];
        hub.addChannel('capture', (e) => seen.push(e));

        await silenceConsole(async () => {
            await hub.raise({ type: 'x', severity: 'critical', message: 'boom', workerId: 'W1', details: { a: 1 } });
        });

        assert.equal(seen.length, 1);
        assert.equal(seen[0].type, 'x');
        assert.equal(seen[0].severity, 'critical');
        assert.equal(seen[0].workerId, 'W1');
        assert.ok(typeof seen[0].raisedAt === 'number');
    });

    test('unknown severities are clamped to info', async () => {
        const hub = new EscalationHub();
        const record = await silenceConsole(() => hub.raise({ type: 'x', severity: 'catastrophic', message: 'm' }));
        assert.equal(record.severity, 'info');
    });

    test('a failing channel never breaks the others or the caller', async () => {
        const hub = new EscalationHub();
        const seen = [];
        hub.addChannel('broken', () => { throw new Error('channel down'); });
        hub.addChannel('working', (e) => seen.push(e));

        await silenceConsole(() => hub.raise({ type: 'x', severity: 'warning', message: 'm' }));
        assert.equal(seen.length, 1);
    });

    test('channels can be removed', async () => {
        const hub = new EscalationHub();
        const seen = [];
        hub.addChannel('c', (e) => seen.push(e));
        hub.removeChannel('c');
        await silenceConsole(() => hub.raise({ type: 'x', severity: 'info', message: 'm' }));
        assert.equal(seen.length, 0);
    });

    test('non-function channel handlers are rejected', () => {
        const hub = new EscalationHub();
        assert.throws(() => hub.addChannel('bad', 'not-a-fn'), /must be a function/);
    });
});

describe('EscalationHub — history and counts', () => {
    test('history is capped and counts accumulate by severity', async () => {
        const hub = new EscalationHub();
        await silenceConsole(async () => {
            for (let i = 0; i < HISTORY_LIMIT + 20; i++) {
                await hub.raise({ type: `t-${i}`, severity: i % 2 === 0 ? 'warning' : 'critical', message: 'm' });
            }
        });

        assert.equal(hub.getHistory(HISTORY_LIMIT + 50).length, HISTORY_LIMIT);
        const counts = hub.getCounts();
        assert.equal(counts.warning + counts.critical, HISTORY_LIMIT + 20);
    });
});
