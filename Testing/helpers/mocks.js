/**
 * Lightweight test doubles for Express-shaped objects and other collaborators.
 * No external mocking framework required — these are plain factories.
 */

/**
 * Build a mock Express request.
 * @param {object} [overrides]
 */
export function mockRequest(overrides = {}) {
    return {
        headers: {},
        cookies: {},
        connection: { remoteAddress: '127.0.0.1' },
        ...overrides
    };
}

/**
 * Build a mock Express response that records `.cookie()` calls.
 */
export function mockResponse() {
    const cookieCalls = [];
    return {
        cookieCalls,
        cookie(key, value, options) {
            cookieCalls.push({ key, value, options });
            return this;
        }
    };
}

/**
 * Capture console output for the duration of `fn` so noisy modules (logger,
 * tryCatch) don't pollute test output. Returns whatever `fn` returns.
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function silenceConsole(fn) {
    const original = {
        log: console.log,
        error: console.error,
        warn: console.warn
    };
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    try {
        return await fn();
    } finally {
        console.log = original.log;
        console.error = original.error;
        console.warn = original.warn;
    }
}
