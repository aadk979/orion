import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { RegistryStore } from '../../../../Packages/server/Orion-Orchestrator/lib/RegistryStore.js';
import { silenceConsole } from '../../../helpers/mocks.js';

// bootstrap.js has chdir'd into a per-process scratch dir, so file writes are hermetic
let fileCounter = 0;
const makeStore = (config = {}) => new RegistryStore({ fileName: `registry-${++fileCounter}.json`, debounceMs: 10, ...config });

const sampleNodes = [
    {
        workerId: 'W1',
        hello: { serviceID: 's1', appName: 'A' },
        lastStatus: { status: { etsLockdown: false } }, // must NOT be persisted
        lastStatusAt: 100,
        lastSeen: 120,
        online: true,
        alerts: Array.from({ length: 30 }, (_, i) => ({ type: `a-${i}` }))
    }
];

describe('RegistryStore — persistence round trip', () => {
    test('first boot loads empty', async () => {
        const store = makeStore();
        assert.deepEqual(await store.load(), []);
    });

    test('flush + load restores identity but not volatile state, with alerts capped', async () => {
        const store = makeStore();
        await store.flush(() => sampleNodes);

        const loaded = await store.load();
        assert.equal(loaded.length, 1);
        assert.equal(loaded[0].workerId, 'W1');
        assert.equal(loaded[0].hello.serviceID, 's1');
        assert.equal(loaded[0].lastSeen, 120);
        assert.equal(loaded[0].lastStatus, undefined); // volatile — intentionally dropped
        assert.equal(loaded[0].alerts.length, 10); // persisted alert cap
        assert.equal(loaded[0].alerts.at(-1).type, 'a-29');
    });

    test('debounced persists coalesce and write the freshest snapshot', async () => {
        const store = makeStore({ debounceMs: 30 });
        store.schedulePersist(() => [{ workerId: 'old' }]);
        store.schedulePersist(() => sampleNodes); // replaces the pending snapshot fn
        await new Promise(r => setTimeout(r, 120));

        const loaded = await store.load();
        assert.equal(loaded[0].workerId, 'W1');
    });

    test('corrupt or incompatible files load as empty instead of crashing', async () => {
        const store = makeStore();
        await fs.writeFile(store.filePath, 'not json at all', 'utf8');
        await silenceConsole(async () => {
            assert.deepEqual(await store.load(), []);
        });

        await fs.writeFile(store.filePath, JSON.stringify({ schemaVersion: 999, nodes: [] }), 'utf8');
        await silenceConsole(async () => {
            assert.deepEqual(await store.load(), []);
        });
    });
});
