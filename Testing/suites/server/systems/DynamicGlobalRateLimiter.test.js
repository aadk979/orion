// logger.js must be evaluated before GlobalAccessPoint.js: the two are circular and
// logger's module body calls globalAccessPoint at top level, so entering the cycle at
// GlobalAccessPoint leaves its binding in TDZ and the import throws.
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { DynamicGlobalRateLimiter } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/DynamicGlobalRateLimiter.js';
import { resolveEndpointPolicy, rateLimitPolicy, validateRateLimitPolicy } from '../../../../Packages/server/Orion-core/lib/General/index.js';

const NS = globalAccessPoint.nameSpace();

// Bucket TTLs are 300s, and InMemoryDB arms a real timer per key. Without clearing,
// each limiter would hold the event loop open long past the assertions.
const makeLimiter = t => {
    const limiter = new DynamicGlobalRateLimiter();
    t.after(() => limiter.localDb.clear());
    return limiter;
};

const makeRes = () => ({
    headers: {},
    statusCode: null,
    body: null,
    setHeader(k, v) {
        this.headers[k] = v;
    },
    getHeader(k) {
        return this.headers[k];
    },
    status(c) {
        this.statusCode = c;
        return this;
    },
    json(b) {
        this.body = b;
        return this;
    }
});

const makeReq = (path, user) => ({
    method: 'POST',
    path,
    ip: '203.0.113.9',
    headers: { 'orion-fingerprint': 'a'.repeat(64) },
    user,
    requestContext: { getStore: () => ({ ip: '203.0.113.9', fingerprint: 'a'.repeat(64), user: false }) }
});

// Drives a middleware once, reporting whether it passed the request through.
const drive = async (mw, req) => {
    const res = makeRes();
    let nexted = false;
    await mw(req, res, () => {
        nexted = true;
    });
    return { res, nexted };
};

describe('rate limit policy', () => {
    test('the shipped policy passes boot validation', () => {
        validateRateLimitPolicy(rateLimitPolicy);
    });

    test('abuse-prone auth route resolves to the critical cost tier', () => {
        assert.equal(resolveEndpointPolicy('POST', `/${NS}/api/v1/action/sign-in-user`).cost, 5);
    });

    test('unmatched route falls back to a non-zero cost', () => {
        assert.ok(resolveEndpointPolicy('GET', '/nothing/here').cost > 0);
    });
});

describe('DynamicGlobalRateLimiter — edge pass', () => {
    // clusterMode is a locked GAP key: reading it throws when boot never set it. That
    // throw used to reach the middleware catch, which calls next() — silently disabling
    // rate limiting entirely. Left unset here to pin the fail-safe.
    test('unresolved clusterMode degrades to local rather than disabling limiting', async t => {
        const limiter = makeLimiter(t);
        const { nexted, res } = await drive(limiter.middleware, makeReq(`/${NS}/api/v1/action/sign-in-user`));
        assert.ok(nexted, 'first request should pass');
        assert.notEqual(res.getHeader('X-RateLimit-Remaining'), undefined, 'bucket was never charged — limiter is a no-op');
    });

    test('throttles sign-in at the fingerprint bucket ceiling (50 tokens / cost 5)', async t => {
        const limiter = makeLimiter(t);
        const req = makeReq(`/${NS}/api/v1/action/sign-in-user`);
        let passed = 0;
        let blocked = null;
        for (let i = 0; i < 12; i++) {
            const { nexted, res } = await drive(limiter.middleware, req);
            if (nexted) passed++;
            else if (!blocked) blocked = res;
        }
        assert.equal(passed, 10, `expected 10 passes before block, got ${passed}`);
        assert.equal(blocked?.statusCode, 429);
        assert.ok(blocked.getHeader('Retry-After') > 0, 'Retry-After must be set');
    });

    // The design point of cost-based policy: one shared actor bucket, cheap routes
    // simply drain it more slowly than expensive ones.
    test('a cost-1 route drains the same bucket more slowly than a cost-5 route', async t => {
        const limiter = makeLimiter(t);
        const req = makeReq(`/${NS}/api/v1/request/have-no-auth-token`);
        let passed = 0;
        for (let i = 0; i < 60; i++) {
            const { nexted } = await drive(limiter.middleware, req);
            if (nexted) passed++;
            else break;
        }
        assert.equal(passed, 50, `cost-1 route should allow 50, got ${passed}`);
    });
});

describe('DynamicGlobalRateLimiter — account pass', () => {
    test('no-ops for unauthenticated requests', async t => {
        const limiter = makeLimiter(t);
        const { nexted, res } = await drive(limiter.accountMiddleware, makeReq(`/${NS}/api/v1/action/sign-in-user`));
        assert.ok(nexted, 'must pass through');
        assert.equal(res.getHeader('X-RateLimit-Remaining'), undefined, 'must not charge a bucket without identity');
    });

    test('charges and throttles an authenticated user (150 tokens / cost 5)', async t => {
        const limiter = makeLimiter(t);
        const req = makeReq(`/${NS}/api/v1/action/sign-in-user`, { uid: 'user-verify-1' });
        let passed = 0;
        for (let i = 0; i < 40; i++) {
            const { nexted } = await drive(limiter.accountMiddleware, req);
            if (nexted) passed++;
            else break;
        }
        assert.equal(passed, 30, `expected 30 passes from the account bucket, got ${passed}`);
    });

    test('buckets are keyed per identity', async t => {
        const limiter = makeLimiter(t);
        for (let i = 0; i < 30; i++) await drive(limiter.accountMiddleware, makeReq('/x', { uid: 'heavy-user' }));
        const { nexted } = await drive(limiter.accountMiddleware, makeReq('/x', { uid: 'innocent-user' }));
        assert.ok(nexted, "a second account must not inherit the first account's exhaustion");
    });
});
