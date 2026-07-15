import '../../../helpers/bootstrap.js';
import test, { describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    getCurrentUnixTime,
    getFutureUnixTime,
    isUnixExpired,
    parseDuration,
    formatTime,
    formatTimePrecise
} from '../../../../Packages/server/Orion-core/lib/Utils/Date&Time.js';

describe('getCurrentUnixTime', () => {
    afterEach(() => mock.timers.reset());

    test('returns whole seconds', () => {
        const t = getCurrentUnixTime();
        assert.equal(Number.isInteger(t), true);
        assert.ok(t > 1_600_000_000, 'should be a plausible recent unix timestamp');
    });

    test('is Date.now() floored to seconds', () => {
        mock.timers.enable({ apis: ['Date'], now: 1_700_000_123_456 });
        assert.equal(getCurrentUnixTime(), 1_700_000_123);
    });
});

describe('getFutureUnixTime', () => {
    afterEach(() => mock.timers.reset());

    test('adds the correct offset per unit', () => {
        mock.timers.enable({ apis: ['Date'], now: 0 });
        assert.equal(getFutureUnixTime('1s'), 1);
        assert.equal(getFutureUnixTime('1m'), 60);
        assert.equal(getFutureUnixTime('1h'), 3600);
        assert.equal(getFutureUnixTime('1d'), 86400);
        assert.equal(getFutureUnixTime('1w'), 604800);
        assert.equal(getFutureUnixTime('1y'), 31536000);
        assert.equal(getFutureUnixTime('90m'), 5400);
    });

    test('throws on malformed duration', () => {
        assert.throws(() => getFutureUnixTime('10x'), /Invalid duration format/);
        assert.throws(() => getFutureUnixTime('abc'), /Invalid duration format/);
        assert.throws(() => getFutureUnixTime('1.5h'), /Invalid duration format/);
    });
});

describe('isUnixExpired', () => {
    afterEach(() => mock.timers.reset());

    test('true when timestamp is in the past, false in the future', () => {
        mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 }); // now = 1e9 s
        assert.equal(isUnixExpired(1_000_000_000 - 10), true);
        assert.equal(isUnixExpired(1_000_000_000 + 10), false);
    });
});

describe('parseDuration (→ milliseconds)', () => {
    test('parses single and compound durations', () => {
        assert.equal(parseDuration('500ms'), 500);
        assert.equal(parseDuration('1s'), 1000);
        assert.equal(parseDuration('2m'), 120000);
        assert.equal(parseDuration('1h'), 3600000);
        assert.equal(parseDuration('1d'), 86400000);
        assert.equal(parseDuration('1h 30m'), 5400000);
        assert.equal(parseDuration('1d 2h 3m 4s 5ms'), 93784005);
    });

    test('returns 0 for unrecognized input', () => {
        assert.equal(parseDuration('nonsense'), 0);
        assert.equal(parseDuration(''), 0);
    });
});

describe('formatTime / formatTimePrecise', () => {
    test('formatTime handles zero and sub-ms', () => {
        assert.equal(formatTime(0), '0ms');
        assert.equal(formatTime(0.5), '0.500ms');
    });

    test('formatTime composes larger units', () => {
        assert.equal(formatTime(86400000), '1d');
        assert.equal(formatTime(3600000), '1h');
        assert.match(formatTime(1500), /sec/);
    });

    test('formatTimePrecise always returns a non-empty string', () => {
        for (const ms of [0, 1, 999, 1000, 61000, 3_600_000, 90_000_000]) {
            const out = formatTimePrecise(ms);
            assert.equal(typeof out, 'string');
            assert.ok(out.length > 0);
        }
        assert.equal(formatTimePrecise(0), '0ms');
    });
});
