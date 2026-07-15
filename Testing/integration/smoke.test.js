import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { integrationEnabled, bootOrion } from './helpers/liveServer.js';

// This suite self-skips unless ORION_INTEGRATION=1 and a config are present, so
// it is safe to include in the default `npm test` run.
const gate = await integrationEnabled();

describe('Orion live server — smoke', { skip: gate.ok ? false : gate.reason }, () => {
    let handle;

    before(async () => {
        handle = await bootOrion(gate.systemConfig);
    });

    test('boots without throwing and exposes a server handle', () => {
        assert.ok(handle?.server, 'expected initiateServer to resolve a server');
    });

    // Add real HTTP assertions here once backing services are configured, e.g.:
    //
    //   test('rejects an unknown route', async () => {
    //     const res = await fetch(`http://localhost:${PORT}/alpine/api/v1/does-not-exist`);
    //     assert.equal(res.status, 404);
    //   });
    //
    //   test('sign-up validates its request body', async () => {
    //     const res = await fetch(`http://localhost:${PORT}/alpine/api/v1/action/sign-up-user`, {
    //       method: 'POST',
    //       headers: { 'content-type': 'application/json' },
    //       body: JSON.stringify({ email: 'not-an-email', password: 'x' })
    //     });
    //     assert.equal(res.status, 400);
    //   });
});
