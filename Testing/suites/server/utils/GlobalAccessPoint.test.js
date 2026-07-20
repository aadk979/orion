import '../../../helpers/bootstrap.js';
// logger.js must evaluate before GlobalAccessPoint.js: the two are circular and
// logger's module body calls globalAccessPoint at top level, so entering the cycle at
// GlobalAccessPoint leaves its binding in TDZ and the import throws.
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { silenceConsole } from '../../../helpers/mocks.js';

// GlobalAccessPoint is a process-wide singleton. Because logger.js sets the
// 'logger' key at import time, the store is already partially populated.

describe('GlobalAccessPoint — general values', () => {
    test('set then get an arbitrary value', () => {
        assert.equal(globalAccessPoint.setValue('apiSlug', 'auth'), true);
        assert.equal(globalAccessPoint.getValue('apiSlug'), 'auth');
        assert.equal(globalAccessPoint.apiSlug(), 'auth');
    });

    test('unknown non-locked key returns undefined', () => {
        assert.equal(globalAccessPoint.getValue('totally-unknown-key'), undefined);
    });

    test('removeValue deletes a non-locked value', () => {
        globalAccessPoint.setValue('scratch', 123);
        assert.equal(globalAccessPoint.getValue('scratch'), 123);
        assert.equal(globalAccessPoint.removeValue('scratch'), true);
        assert.equal(globalAccessPoint.getValue('scratch'), undefined);
    });

    test('namespace is the fixed "alpine" value', () => {
        assert.equal(globalAccessPoint.nameSpace(), 'alpine');
    });
});

describe('GlobalAccessPoint — locked keys', () => {
    test('a locked key can be set once then is immutable', async () => {
        await silenceConsole(async () => {
            // 'db' is a locked key and (in a fresh test process) unset.
            assert.equal(globalAccessPoint.setValue('db', { first: true }), true);
            // Second write is refused.
            assert.equal(globalAccessPoint.setValue('db', { second: true }), false);
        });
        assert.deepEqual(globalAccessPoint.getValue('db'), { first: true });
    });

    test('locked keys cannot be removed', async () => {
        await silenceConsole(async () => {
            assert.equal(globalAccessPoint.removeValue('db'), false);
        });
    });

    // The load-bearing part of this throw is `code`, not the message text: it is what
    // SafeModuleHandler matches on to decide a module is merely unavailable rather than
    // genuinely broken. The message was rewritten when getValue's malformed
    // `new Error({...})` throw was fixed, which is why the old text is not asserted here.
    test('reading an unset locked key throws', async () => {
        await silenceConsole(async () => {
            assert.throws(
                () => globalAccessPoint.getValue('clusterMode'),
                err => {
                    assert.equal(err.code, 'GAP:$:VALUE_NOT_FOUND');
                    assert.equal(err.keyName, 'clusterMode');
                    assert.match(err.message, /Missing value for key clusterMode/);
                    return true;
                }
            );
        });
    });
});
