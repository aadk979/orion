import '../../../helpers/bootstrap.js';
import test, { describe, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
    circuitBreakerSystem as cb,
    CIRCUIT_STATES
} from '../../../../Packages/server/Orion-core/lib/Utils/Systems/CircuitBreakerSystem.js';
import { silenceConsole } from '../../../helpers/mocks.js';

// The system is a process singleton keyed by dependency name; each test uses a
// unique dependency id so cases never interfere.
let counter = 0;
const dep = () => `dep-${++counter}`;

describe('CircuitBreaker — closed → open', () => {
    afterEach(() => mock.timers.reset());

    test('opens after failureThreshold failures in the window', async () => {
        const d = dep();
        cb.configure(d, { failureThreshold: 3, resetTimeoutMs: 1000 });
        assert.equal(cb.getState(d), CIRCUIT_STATES.CLOSED);
        assert.equal(cb.canCall(d), true);

        await silenceConsole(async () => {
            cb.recordFailure(d);
            cb.recordFailure(d);
            assert.equal(cb.getState(d), CIRCUIT_STATES.CLOSED); // still under threshold
            cb.recordFailure(d);
        });

        assert.equal(cb.getState(d), CIRCUIT_STATES.OPEN);
        assert.equal(cb.canCall(d), false);
    });
});

describe('CircuitBreaker — open → half-open → closed (recovery)', () => {
    afterEach(() => mock.timers.reset());

    test('half-opens after the reset timeout and closes after enough successes', async () => {
        mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
        const d = dep();
        cb.configure(d, { failureThreshold: 2, successThreshold: 2, resetTimeoutMs: 5000 });

        await silenceConsole(async () => {
            cb.recordFailure(d);
            cb.recordFailure(d);
        });
        assert.equal(cb.getState(d), CIRCUIT_STATES.OPEN);
        assert.equal(cb.canCall(d), false); // still within reset timeout

        mock.timers.tick(5001); // pass the reset timeout
        await silenceConsole(async () => {
            assert.equal(cb.canCall(d), true); // transitions to HALF_OPEN and allows a probe
        });
        assert.equal(cb.getState(d), CIRCUIT_STATES.HALF_OPEN);

        await silenceConsole(async () => {
            cb.recordSuccess(d);
            cb.recordSuccess(d); // meets successThreshold
        });
        assert.equal(cb.getState(d), CIRCUIT_STATES.CLOSED);
    });

    test('a failed probe in half-open re-opens the circuit', async () => {
        mock.timers.enable({ apis: ['Date'], now: 2_000_000 });
        const d = dep();
        cb.configure(d, { failureThreshold: 1, resetTimeoutMs: 1000 });

        await silenceConsole(async () => cb.recordFailure(d));
        assert.equal(cb.getState(d), CIRCUIT_STATES.OPEN);

        mock.timers.tick(1001);
        await silenceConsole(async () => {
            cb.canCall(d); // → HALF_OPEN
            cb.recordFailure(d); // probe fails
        });
        assert.equal(cb.getState(d), CIRCUIT_STATES.OPEN);
    });
});

describe('CircuitBreaker — manual control & introspection', () => {
    test('forceOpen / forceClose override state', async () => {
        const d = dep();
        await silenceConsole(async () => {
            cb.forceOpen(d);
            assert.equal(cb.getState(d), CIRCUIT_STATES.OPEN);
            cb.forceClose(d);
        });
        assert.equal(cb.getState(d), CIRCUIT_STATES.CLOSED);
        assert.equal(cb.canCall(d), true);
    });

    test('getAllStates reports tracked circuits', async () => {
        const d = dep();
        await silenceConsole(async () => cb.forceOpen(d));
        const all = cb.getAllStates();
        assert.ok(d in all);
        assert.equal(all[d].state, CIRCUIT_STATES.OPEN);
    });

    test('unknown dependency defaults to CLOSED', () => {
        assert.equal(cb.getState('never-seen'), CIRCUIT_STATES.CLOSED);
    });
});
