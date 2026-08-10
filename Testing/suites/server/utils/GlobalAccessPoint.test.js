import '../../../helpers/bootstrap.js';
import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { silenceConsole } from '../../../helpers/mocks.js';

// GlobalAccessPoint is a process-wide singleton. This file imports it as the
// FIRST Orion module on purpose — that used to throw, and the suite below pins
// why it must not again.

const GAP_SOURCE = path.resolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    '..',
    'Packages',
    'server',
    'Orion-core',
    'lib',
    'Utils',
    'GlobalAccessPoint.js'
);

describe('GlobalAccessPoint — stays the root of the import graph', () => {
    test('importing it first does not throw', () => {
        // The assertion is that the import at the top of this file succeeded.
        // logger.js used to register itself here at module top level while this
        // module imported logger.js in turn; entering that cycle at
        // GlobalAccessPoint left its own binding in TDZ, so `import
        // GlobalAccessPoint.js` crashed with "Cannot access 'globalAccessPoint'
        // before initialization". Every suite had to import logger.js first as a
        // workaround.
        assert.equal(typeof globalAccessPoint.setValue, 'function');
        assert.equal(typeof globalAccessPoint.getValue, 'function');
    });

    test('it does not statically import logger.js', () => {
        // Guards the fix at the structural level rather than by symptom: an
        // `import` of a consumer here recreates the cycle. The logger is resolved
        // through the value map at call time instead.
        const source = fs.readFileSync(GAP_SOURCE, 'utf8');
        const staticImports = source.match(/^\s*import\s.*$/gm) || [];

        for (const line of staticImports) {
            assert.ok(!/logger\.js/.test(line), `GlobalAccessPoint.js must not import logger.js — found: ${line.trim()}`);
        }
    });

    test('critical access violations report without a registered logger', () => {
        // #critical falls back to console when the logger key is unset, which is
        // the state during the window before logger.js registers itself — and
        // permanently, for any consumer that never imports the logger.
        return silenceConsole(() => {
            globalAccessPoint.setValue('oAuthToolKit', { first: true });
            assert.equal(globalAccessPoint.setValue('oAuthToolKit', { second: true }), false);
            assert.equal(globalAccessPoint.removeValue('oAuthToolKit'), false);
        });
    });
});

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
