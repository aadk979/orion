import { logger } from '../logger.js';

const STATES = Object.freeze({ CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' });

const DEFAULTS = {
    failureThreshold: 5,
    successThreshold: 2,
    timeWindowMs: 60_000,
    resetTimeoutMs: 30_000
};

class CircuitBreakerSystem {
    constructor() {
        this._circuits = new Map();
    }

    _getOrCreate(dependency) {
        if (!this._circuits.has(dependency)) {
            this._circuits.set(dependency, {
                state: STATES.CLOSED,
                failures: [],
                successes: 0,
                openedAt: null,
                config: { ...DEFAULTS }
            });
        }
        return this._circuits.get(dependency);
    }

    configure(dependency, config = {}) {
        const circuit = this._getOrCreate(dependency);
        circuit.config = { ...circuit.config, ...config };
    }

    _pruneWindow(circuit) {
        const cutoff = Date.now() - circuit.config.timeWindowMs;
        let i = 0;
        while (i < circuit.failures.length && circuit.failures[i].timestamp < cutoff) i++;
        if (i > 0) circuit.failures.splice(0, i);
    }

    recordSuccess(dependency) {
        const circuit = this._getOrCreate(dependency);

        if (circuit.state === STATES.HALF_OPEN) {
            circuit.successes++;
            if (circuit.successes >= circuit.config.successThreshold) {
                circuit.state = STATES.CLOSED;
                circuit.failures = [];
                circuit.successes = 0;
                circuit.openedAt = null;
                logger.info(`CircuitBreaker: ${dependency} → CLOSED (recovered)`);
            }
        }
    }

    recordFailure(dependency) {
        const circuit = this._getOrCreate(dependency);
        const now = Date.now();

        this._pruneWindow(circuit);
        circuit.failures.push({ timestamp: now });

        if (circuit.state === STATES.HALF_OPEN) {
            circuit.state = STATES.OPEN;
            circuit.openedAt = now;
            circuit.successes = 0;
            logger.warn(`CircuitBreaker: ${dependency} → OPEN (probe failed)`);
            return;
        }

        if (circuit.state === STATES.CLOSED && circuit.failures.length >= circuit.config.failureThreshold) {
            circuit.state = STATES.OPEN;
            circuit.openedAt = now;
            logger.error(`CircuitBreaker: ${dependency} → OPEN (${circuit.failures.length} failures in window)`);
        }
    }

    // Returns true if the caller should proceed with the dependency call
    canCall(dependency) {
        const circuit = this._getOrCreate(dependency);
        const now = Date.now();

        if (circuit.state === STATES.CLOSED) return true;

        if (circuit.state === STATES.OPEN) {
            if (now - circuit.openedAt >= circuit.config.resetTimeoutMs) {
                circuit.state = STATES.HALF_OPEN;
                circuit.successes = 0;
                logger.info(`CircuitBreaker: ${dependency} → HALF_OPEN (probing)`);
                return true;
            }
            return false;
        }

        // HALF_OPEN: only allow one probe at a time
        if (circuit.state === STATES.HALF_OPEN) {
            return circuit.successes === 0;
        }

        return true;
    }

    getState(dependency) {
        if (!this._circuits.has(dependency)) return STATES.CLOSED;
        return this._circuits.get(dependency).state;
    }

    forceOpen(dependency) {
        const circuit = this._getOrCreate(dependency);
        circuit.state = STATES.OPEN;
        circuit.openedAt = Date.now();
        logger.warn(`CircuitBreaker: ${dependency} → OPEN (manual)`);
    }

    forceClose(dependency) {
        const circuit = this._getOrCreate(dependency);
        circuit.state = STATES.CLOSED;
        circuit.failures = [];
        circuit.successes = 0;
        circuit.openedAt = null;
        logger.info(`CircuitBreaker: ${dependency} → CLOSED (manual reset)`);
    }

    getAllStates() {
        const result = {};
        for (const [dep, circuit] of this._circuits.entries()) {
            result[dep] = {
                state: circuit.state,
                recentFailures: circuit.failures.length,
                openedAt: circuit.openedAt
            };
        }
        return result;
    }
}

const circuitBreakerSystem = new CircuitBreakerSystem();

export { circuitBreakerSystem, STATES as CIRCUIT_STATES };
