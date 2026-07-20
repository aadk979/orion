import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { respondWithResourceUrl } from '../../../../Packages/server/Orion-core/lib/Utils/Core/ResourceAccessManagment/s3BasedResources/urlResponse.js';

const makeRes = () => ({
    headers: {},
    statusCode: null,
    jsonBody: null,
    sent: null,
    set(k, v) {
        this.headers[k] = v;
    },
    setHeader(k, v) {
        this.headers[k] = v;
    },
    status(c) {
        this.statusCode = c;
        return this;
    },
    send(b) {
        this.sent = b;
        return this;
    },
    json(b) {
        this.jsonBody = b;
        return this;
    }
});

describe('respondWithResourceUrl — success', () => {
    test('sends the JSON envelope with delivery, url and no-store headers', () => {
        const res = makeRes();
        const outcome = respondWithResourceUrl(res, { url: 'https://bucket.s3.amazonaws.com/k?X-Amz-Signature=abc', expiresAt: 1700000000 });

        assert.deepEqual(outcome, { error: false });
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['orion-response-status'], 200);
        assert.equal(res.headers['Cache-Control'], 'no-store');
        assert.deepEqual(res.jsonBody, {
            error: false,
            data: { delivery: 'S3-URL', url: 'https://bucket.s3.amazonaws.com/k?X-Amz-Signature=abc', expiresAt: 1700000000 }
        });
    });

    test('expiresAt is null when absent or non-numeric', () => {
        const res1 = makeRes();
        respondWithResourceUrl(res1, { url: 'https://bucket.s3.amazonaws.com/k' });
        assert.equal(res1.jsonBody.data.expiresAt, null);

        const res2 = makeRes();
        respondWithResourceUrl(res2, { url: 'https://bucket.s3.amazonaws.com/k', expiresAt: 'soon' });
        assert.equal(res2.jsonBody.data.expiresAt, null);
    });

    test('accepts http endpoints for local development stores', () => {
        const res = makeRes();
        const outcome = respondWithResourceUrl(res, { url: 'http://localhost:9000/bucket/k' });
        assert.deepEqual(outcome, { error: false });
        assert.equal(res.statusCode, 200);
    });
});

describe('respondWithResourceUrl — rejects malformed callback output', () => {
    const bad = [
        ['missing result', undefined],
        ['missing url', {}],
        ['non-string url', { url: 42 }],
        ['blank url', { url: '   ' }],
        ['unparseable url', { url: 'not a url' }],
        ['javascript scheme', { url: 'javascript:alert(1)' }],
        ['data scheme', { url: 'data:text/html,<h1>x</h1>' }]
    ];

    for (const [label, input] of bad) {
        test(`returns an error sentinel and writes nothing for ${label}`, () => {
            const res = makeRes();
            const outcome = respondWithResourceUrl(res, input);
            assert.deepEqual(outcome, { error: true, errorCode: 'RAS-S3::INVALID-URL::A::i' });
            assert.equal(res.statusCode, null);
            assert.equal(res.jsonBody, null);
        });
    }
});
