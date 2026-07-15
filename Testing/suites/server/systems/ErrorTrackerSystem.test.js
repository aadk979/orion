import '../../../helpers/bootstrap.js';
// logger.js must evaluate before anything pulls in GlobalAccessPoint.js: the two are
// circular and logger's module body calls globalAccessPoint at top level, so entering
// the cycle at GlobalAccessPoint leaves its binding in TDZ and the import throws.
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { errorTrackerSystem as ets } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/ErrorTrackerSystem.js';
import { silenceConsole } from '../../../helpers/mocks.js';

function report(overrides = {}) {
    return ets.reportError({
        functionName: 'someFn',
        functionSource: 'someModule.js',
        errorMessage: 'a failure',
        errStack: 'Error: a failure\n  at ...',
        timestamp: Date.now(),
        ...overrides
    });
}

describe('ErrorTrackerSystem.reportError', () => {
    test('returns an error id and (below thresholds) no violations', async () => {
        const { errorId, violations } = await silenceConsole(() => report());
        assert.match(errorId, /^ID_ETS_ERROR-/);
        assert.ok(Array.isArray(violations));
        assert.equal(violations.length, 0);
    });

    test('full error report is retrievable by id', async () => {
        const { errorId } = await silenceConsole(() =>
            report({ functionName: 'login', errorMessage: 'bad creds', functionSource: 'Auth.js' })
        );
        const full = ets.getFullErrorReport(errorId);
        assert.equal(full.errorId, errorId);
        assert.equal(full.functionName, 'login');
        assert.equal(full.errorMessage, 'bad creds');
        assert.equal(full.functionSource, 'Auth.js');
    });
});

describe('ErrorTrackerSystem analytics', () => {
    test('tracks top error messages and error-prone functions', async () => {
        await silenceConsole(async () => {
            for (let i = 0; i < 3; i++) report({ errorMessage: 'frequent', functionName: 'hotFn' });
            report({ errorMessage: 'rare', functionName: 'coldFn' });
        });

        const topMessages = ets.getTopErrorMessages(5).map(e => e.key);
        assert.ok(topMessages.includes('frequent'));

        const topFns = ets.getMostErrorProneFunctions(5).map(e => e.key);
        assert.ok(topFns.includes('hotFn'));
    });

    test('getInsightSummary returns a shaped object', async () => {
        await silenceConsole(() => report());
        const summary = ets.getInsightSummary();
        for (const key of ['topErrorMessages', 'mostErrorProneFunctions', 'recentBursts', 'errorsInLastMinute', 'lockdown']) {
            assert.ok(key in summary, `missing ${key}`);
        }
        assert.equal(typeof summary.errorsInLastMinute, 'number');
    });

    test('massExport serializes maps into plain objects', async () => {
        await silenceConsole(() => report());
        const dump = ets.massExport();
        assert.ok(Array.isArray(dump.errors));
        assert.equal(typeof dump.functionName, 'object');
        assert.equal(typeof dump.errorCountByMessage, 'object');
        assert.match(dump.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
    });
});
