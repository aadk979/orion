import '../../helpers/bootstrap.js';
import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { api, get, post, patch, del, upload, ApiError, fmtTime, fmtDuration } from '../../../Packages/server/Orion-Orchestrator/gui/lib/api.js';

/**
 * The orch panel's API client (gui/lib/api.js).
 *
 * The rest of gui/ is React pages, which would need a renderer to test; this
 * module is plain JS over `fetch` and carries the parts that actually break:
 *
 *   - `credentials: 'include'`, without which the HttpOnly session cookie is
 *     not sent and every panel request 401s;
 *   - error translation, because the panel decides what to show from `code`,
 *     and an ApiError that loses it degrades every message to "failed";
 *   - the upload path preserving the `details` array, which is the whole
 *     reason a sheet's problems can be listed at once.
 *
 * `fetch` is replaced with a recorder — the module reads the global at call
 * time, so no module-level plumbing is needed.
 */

let calls;
let originalFetch;

/** Queue a response for the next fetch. */
const respondWith = ({ ok = true, status = 200, payload = { error: false }, json } = {}) => {
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return {
            ok,
            status,
            statusText: `status ${status}`,
            json: json || (async () => payload)
        };
    };
};

beforeEach(() => {
    calls = [];
    originalFetch = globalThis.fetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('orch panel api — request shaping', () => {
    test('every request carries credentials so the HttpOnly session cookie rides along', async () => {
        respondWith({ payload: { error: false, ok: 1 } });

        await api('GET', '/api/cluster/status');

        // Without this the panel is permanently signed out: the token is in an
        // HttpOnly cookie and there is nothing else to authenticate with.
        assert.equal(calls[0].init.credentials, 'include');
    });

    test('a body is JSON-encoded and typed; no body means neither header nor payload', async () => {
        respondWith();
        await api('POST', '/api/cluster/lock', { reason: 'maintenance' });

        assert.equal(calls[0].init.body, JSON.stringify({ reason: 'maintenance' }));
        assert.deepEqual(calls[0].init.headers, { 'content-type': 'application/json' });

        respondWith();
        await api('GET', '/api/cluster/status');

        // A content-type on a bodyless GET is harmless but a body is not —
        // fetch rejects one outright.
        assert.equal(calls[1].init.headers, undefined);
        assert.equal(calls[1].init.body, undefined);
    });

    test('the path is passed through unchanged — the panel is same-origin', async () => {
        respondWith();

        await api('GET', '/api/audit?limit=10');

        assert.equal(calls[0].url, '/api/audit?limit=10');
    });

    test('the verb helpers map to their methods and default to an empty body', async () => {
        for (const [helper, method, expectedBody] of [
            [() => get('/p'), 'GET', undefined],
            [() => post('/p'), 'POST', '{}'],
            [() => patch('/p'), 'PATCH', '{}'],
            [() => del('/p'), 'DELETE', undefined]
        ]) {
            calls = [];
            respondWith();
            await helper();

            assert.equal(calls[0].init.method, method);
            assert.equal(calls[0].init.body, expectedBody, `${method} sent the wrong body`);
        }
    });

    test('an explicit body overrides the helper default', async () => {
        respondWith();

        await post('/api/cluster/consensus', { topic: 'orion:node-healthy' });

        assert.equal(calls[0].init.body, JSON.stringify({ topic: 'orion:node-healthy' }));
    });

    test('the resolved payload is returned as-is', async () => {
        respondWith({ payload: { error: false, nodes: [{ workerId: 'W1' }] } });

        assert.deepEqual(await get('/api/cluster/nodes'), { error: false, nodes: [{ workerId: 'W1' }] });
    });
});

describe('orch panel api — error translation', () => {
    test('a non-2xx response throws an ApiError carrying the code, message and status', async () => {
        respondWith({ ok: false, status: 403, payload: { error: true, code: 'PBAC::DENIED', message: 'Policy denies "cluster:ops:lock"' } });

        await assert.rejects(() => post('/api/cluster/lock'), err => {
            assert.ok(err instanceof ApiError);
            assert.equal(err.code, 'PBAC::DENIED');
            assert.equal(err.message, 'Policy denies "cluster:ops:lock"');
            assert.equal(err.status, 403);
            return true;
        });
    });

    test('an error envelope on HTTP 200 is still an error', async () => {
        respondWith({ ok: true, status: 200, payload: { error: true, code: 'API::INTERNAL', message: 'Internal error' } });

        await assert.rejects(() => get('/api/cluster/status'), err => err.code === 'API::INTERNAL');
    });

    test('a non-JSON error body still yields a usable code and message', async () => {
        respondWith({
            ok: false,
            status: 502,
            json: async () => {
                throw new SyntaxError('Unexpected token < in JSON');
            }
        });

        await assert.rejects(() => get('/api/cluster/status'), err => {
            // A proxy's HTML error page must not surface as "undefined".
            assert.equal(err.code, 'HTTP-502');
            assert.equal(err.message, 'status 502');
            assert.equal(err.status, 502);
            return true;
        });
    });

    test('ApiError is a real Error, so it survives a catch that checks instanceof', async () => {
        const error = new ApiError('X::Y', 'message', 400);

        assert.ok(error instanceof Error);
        assert.equal(error.message, 'message');
        assert.equal(error.code, 'X::Y');
    });

    test('a 401 is reported with its status so the panel can redirect to login', async () => {
        respondWith({ ok: false, status: 401, payload: { error: true, code: 'AUTH::NO-SESSION', message: 'Authentication required' } });

        await assert.rejects(() => get('/api/auth/session'), err => err.status === 401 && err.code === 'AUTH::NO-SESSION');
    });
});

describe('orch panel api — upload', () => {
    const sheet = (name, type = 'text/csv') => ({ name, type, size: 10 });

    test('the file rides as the raw body with its name on the query string', async () => {
        respondWith({ payload: { error: false, job: { id: 'JOB_1' } } });
        const file = sheet('quarterly blast.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

        const result = await upload('/api/mailing/jobs', file);

        assert.equal(calls[0].url, '/api/mailing/jobs?filename=quarterly%20blast.xlsx');
        assert.equal(calls[0].init.body, file, 'the File object is sent as-is, not wrapped in multipart');
        assert.equal(calls[0].init.headers['content-type'], file.type);
        assert.equal(calls[0].init.credentials, 'include');
        assert.deepEqual(result, { error: false, job: { id: 'JOB_1' } });
    });

    test('a file the browser could not type falls back to octet-stream', async () => {
        respondWith();

        await upload('/api/mailing/jobs', sheet('list.csv', ''));

        // The server accepts application/octet-stream for exactly this case; an
        // empty content-type would be rejected by the raw body parser.
        assert.equal(calls[0].init.headers['content-type'], 'application/octet-stream');
    });

    test('a filename with query-hostile characters is encoded', async () => {
        respondWith();

        await upload('/api/mailing/jobs', sheet('a&b=c?d.csv'));

        assert.equal(calls[0].url, '/api/mailing/jobs?filename=a%26b%3Dc%3Fd.csv');
    });

    test('validation problems are preserved on the error, not just the first one', async () => {
        respondWith({
            ok: false,
            status: 400,
            payload: {
                error: true,
                code: 'MAILING::SHEET-INVALID',
                message: 'The sheet could not be accepted',
                details: ['row 2: recipient is not an email', 'row 5: subject is empty']
            }
        });

        await assert.rejects(() => upload('/api/mailing/jobs', sheet('bad.csv')), err => {
            assert.equal(err.code, 'MAILING::SHEET-INVALID');
            // An operator fixing a sheet one error per upload uploads ten times.
            assert.deepEqual(err.details, ['row 2: recipient is not an email', 'row 5: subject is empty']);
            return true;
        });
    });

    test('an upload error with no details gets an empty array rather than undefined', async () => {
        respondWith({ ok: false, status: 413, payload: { error: true, code: 'API::BODY-TOO-LARGE', message: 'too large' } });

        await assert.rejects(() => upload('/api/mailing/jobs', sheet('huge.xlsx')), err => {
            // The panel maps over this; undefined would throw during render.
            assert.deepEqual(err.details, []);
            return true;
        });
    });
});

describe('orch panel api — formatters', () => {
    test('fmtTime renders an em dash for absent values', () => {
        for (const value of [null, undefined, 0, '']) {
            assert.equal(fmtTime(value), '—', `${JSON.stringify(value)} should render as an em dash`);
        }
    });

    test('fmtTime treats a number as unix seconds and a string as a date', () => {
        const seconds = 1_700_000_000;

        // The API mixes the two: cluster timestamps are unix seconds, Postgres
        // columns arrive as ISO strings.
        assert.equal(fmtTime(seconds), new Date(seconds * 1000).toLocaleString());
        assert.equal(fmtTime('2026-07-28T02:00:00Z'), new Date('2026-07-28T02:00:00Z').toLocaleString());
    });

    test('fmtTime falls back to the raw value rather than showing "Invalid Date"', () => {
        assert.equal(fmtTime('not a date'), 'not a date');
    });

    test('fmtDuration renders an em dash only for null and undefined', () => {
        assert.equal(fmtDuration(null), '—');
        assert.equal(fmtDuration(undefined), '—');
        // Zero is a real duration, not a missing one.
        assert.equal(fmtDuration(0), '0s');
    });

    test('fmtDuration picks a unit by magnitude', () => {
        assert.equal(fmtDuration(45), '45s');
        assert.equal(fmtDuration(59), '59s');
        assert.equal(fmtDuration(60), '1m');
        assert.equal(fmtDuration(3599), '59m');
        assert.equal(fmtDuration(3600), '1h 0m');
        assert.equal(fmtDuration(8040), '2h 14m');
    });

    test('fmtDuration rounds and clamps rather than showing fractions or negatives', () => {
        assert.equal(fmtDuration(45.6), '46s');
        assert.equal(fmtDuration(-10), '0s', 'a clock skew must not render as a negative age');
        assert.equal(fmtDuration('120'), '2m', 'a numeric string from a query parameter still formats');
    });
});
