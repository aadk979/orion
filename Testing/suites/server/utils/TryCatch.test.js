import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { tryCatch } from '../../../../Packages/server/Orion-core/lib/Utils/TryCatch.js';
import { silenceConsole } from '../../../helpers/mocks.js';

describe('tryCatch — success path', () => {
    test('returns the async function result and passes the parameter', async () => {
        const result = await tryCatch(async p => p * 2, true, 21, 'double', 'test');
        assert.equal(result, 42);
    });

    test('supports synchronous functions when async=false', async () => {
        const result = await tryCatch(p => p.toUpperCase(), false, 'orion', 'upper', 'test');
        assert.equal(result, 'ORION');
    });

    test('defaults to awaiting when async flag is omitted/undefined', async () => {
        const result = await tryCatch(async () => 'ok', undefined, null, 'noop', 'test');
        assert.equal(result, 'ok');
    });
});

describe('tryCatch — error path', () => {
    test('captures thrown errors and returns a structured error envelope', async () => {
        const result = await silenceConsole(() =>
            tryCatch(
                () => {
                    throw new Error('boom');
                },
                false,
                null,
                'thrower',
                'test'
            )
        );

        assert.equal(result.error, true);
        assert.equal(result.errorCode, 'GENERAL::UNKNOWN-ERROR::A::i');
        assert.equal(result.context, 'boom');
        assert.ok('trace' in result);
    });

    test('captures rejected promises too', async () => {
        const result = await silenceConsole(() =>
            tryCatch(
                async () => {
                    throw new Error('async-boom');
                },
                true,
                null,
                'asyncThrower',
                'test'
            )
        );
        assert.equal(result.error, true);
        assert.equal(result.context, 'async-boom');
    });
});
