// logger.js must be evaluated before GlobalAccessPoint.js (circular; see fileResponse.test.js).
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { silenceConsole } from '../../../helpers/mocks.js';
import { validateRASCallbacks } from '../../../../Packages/server/Orion-core/lib/Utils/Core/ResourceAccessManagment/callbackBasedResources/callbackValidator.js';

const cb = () => ({});

describe('validateRASCallbacks', () => {
    test('accepts SECURE-0 and S3-0 entries (case/trim-insensitive)', async () => {
        const result = await silenceConsole(() =>
            validateRASCallbacks([
                { callbackPath: 'a', accessType: 'SECURE-0', callback: cb },
                { callbackPath: 'b', accessType: 's3-0', callback: cb },
                { callbackPath: 'c', accessType: '  S3-0  ', callback: cb }
            ])
        );
        assert.equal(result.length, 3);
        assert.deepEqual(result.map(r => r.callbackPath), ['a', 'b', 'c']);
    });

    test('drops entries with an unsupported access type', async () => {
        const result = await silenceConsole(() =>
            validateRASCallbacks([
                { callbackPath: 'a', accessType: 'SECURE-1', callback: cb },
                { callbackPath: 'b', accessType: 'S3-0', callback: cb }
            ])
        );
        assert.deepEqual(result.map(r => r.callbackPath), ['b']);
    });

    test('drops entries with a missing/blank path or a non-function callback', async () => {
        const result = await silenceConsole(() =>
            validateRASCallbacks([
                { callbackPath: '', accessType: 'S3-0', callback: cb },
                { accessType: 'S3-0', callback: cb },
                { callbackPath: 'ok', accessType: 'S3-0', callback: 'nope' },
                { callbackPath: 'good', accessType: 'S3-0', callback: cb }
            ])
        );
        assert.deepEqual(result.map(r => r.callbackPath), ['good']);
    });

    test('an empty or omitted config yields an empty array', async () => {
        assert.deepEqual(await silenceConsole(() => validateRASCallbacks([])), []);
        assert.deepEqual(await silenceConsole(() => validateRASCallbacks()), []);
    });
});
