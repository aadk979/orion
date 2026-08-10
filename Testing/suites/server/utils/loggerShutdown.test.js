import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The process-exit contract of logger.js's shutdown handlers.
 *
 * This is load-bearing for the entire test suite, not just for production. The
 * handler used to call `process.exit(0)` for an uncaught exception, so:
 *
 *   - process supervisors (Kubernetes `restartPolicy: OnFailure`, systemd
 *     `Restart=on-failure`, `docker --restart on-failure`) saw a SUCCESSFUL run
 *     and left a crashed node down;
 *   - `node --test` saw a clean exit and reported a suite that crashed on import
 *     as "tests 1 / pass 1 / fail 0" — a green run in which zero tests executed.
 *
 * Because the logger is transitively imported by nearly every suite, a
 * regression here silently turns real failures green across the whole repo.
 * Each case runs in a child process, since the assertion IS the exit code.
 */

// Must be a file:// URL, not a bare path: on Windows an absolute path like
// "C:/..." is rejected by the ESM loader as an unsupported scheme ('c:'), which
// would make every child below die on import instead of on the behaviour under
// test — and a child that dies on import still exits non-zero, so a naive
// "exits non-zero" assertion would pass for entirely the wrong reason.
const LOGGER_URL = pathToFileURL(
    path.resolve(import.meta.dirname, '..', '..', '..', '..', 'Packages', 'server', 'Orion-core', 'lib', 'Utils', 'logger.js')
).href;

// Child processes must not inherit this process's cwd-based logs/ directory
// assumptions, so each gets a throwaway working directory.
const runChild = script => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-logger-'));

    try {
        const stdout = execFileSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { code: 0, stdout, dir };
    } catch (err) {
        // execFileSync throws on a non-zero exit; the status is what we assert on.
        return { code: err.status, stdout: `${err.stdout || ''}${err.stderr || ''}`, dir };
    }
};

describe('logger — uncaught exceptions exit non-zero', () => {
    test('a thrown error exits 1, not 0', () => {
        const { code, stdout } = runChild(`
            import('${LOGGER_URL}').then(() => {
                setTimeout(() => { throw new Error('deliberate-crash'); }, 5);
            });
        `);

        assert.equal(code, 1, 'a crash reported success — supervisors will not restart, and node --test will report a false pass');
        assert.match(stdout, /Uncaught Exception/);
        assert.match(stdout, /shutting down \(EXCEPTION\)/);
    });

    test('an unhandled promise rejection also exits non-zero', () => {
        // Since Node 15 the default mode raises these as uncaught exceptions, so
        // they land in the same handler. A stray rejected promise must not exit 0.
        const { code, stdout } = runChild(`
            import('${LOGGER_URL}').then(() => {
                setTimeout(() => { Promise.reject(new Error('unhandled-rejection')); }, 5);
            });
        `);

        assert.notEqual(code, 0, 'an unhandled rejection reported success');
        // Asserted explicitly so this cannot pass merely because the child died
        // for some other reason — the exit must come from OUR handler.
        assert.match(stdout, /shutting down \(EXCEPTION\)/);
        assert.match(stdout, /unhandled-rejection/);
    });

    test('the error stack survives — not the "{}" that JSON.stringify produces', () => {
        const { stdout } = runChild(`
            import('${LOGGER_URL}').then(() => {
                setTimeout(() => {
                    const e = new Error('stack-must-survive');
                    e.code = 'ORION:$:TESTCODE';
                    throw e;
                }, 5);
            });
        `);

        assert.match(stdout, /stack-must-survive/);
        assert.match(stdout, /at /, 'the stack trace was lost');
        assert.match(stdout, /ORION:\$:TESTCODE/, 'the attached error code was lost');
        assert.doesNotMatch(stdout, /Uncaught Exception: \{\}/, 'the error serialized to "{}" again');
    });

    test('the crash record reaches disk despite the immediate process.exit', () => {
        // The normal log path uses async fs.appendFile, which process.exit()
        // truncates — losing precisely the record that matters.
        const { dir } = runChild(`
            import('${LOGGER_URL}').then(m => {
                m.logger.configure({ logToFile: true });
                setTimeout(() => { throw new Error('must-be-persisted'); }, 5);
            });
        `);

        const logFile = path.join(dir, 'logs', 'app.log');
        assert.ok(fs.existsSync(logFile), 'no log file was produced');
        assert.match(fs.readFileSync(logFile, 'utf8'), /must-be-persisted/);
    });
});

describe('logger — signals remain a graceful exit 0', () => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        test(`${signal} exits 0`, () => {
            // A requested stop is not a failure; only crashes changed behaviour.
            const { code, stdout } = runChild(`
                import('${LOGGER_URL}').then(() => {
                    setTimeout(() => process.emit('${signal}'), 5);
                });
            `);

            assert.equal(code, 0, `${signal} must stay a clean exit`);
            assert.match(stdout, new RegExp(`shutting down \\(${signal}\\)`));
        });
    }
});
