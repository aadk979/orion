// logger.js must be evaluated before GlobalAccessPoint.js (circular; see fileResponse.test.js).
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { deliverSecureResource } from '../../../../Packages/server/Orion-core/lib/Utils/Core/ResourceAccessManagment/callbackBasedResources/secureDelivery.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

const makeRes = () => ({
    headers: {},
    statusCode: null,
    jsonBody: null,
    sent: null,
    ended: false,
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
    },
    end() {
        this.ended = true;
        return this;
    }
});

const setConfig = entries => globalAccessPoint.setValue('resourceAccessSystem_Config', entries);

const s3Callback = result => ({ callbackPath: 'report', accessType: 'S3-0', callback: async () => result });
const secureCallback = result => ({ callbackPath: 'doc', accessType: 'SECURE-0', callback: async () => result });

describe('deliverSecureResource — S3-0 delivery', () => {
    beforeEach(() => setConfig([]));

    test('happy path responds with the S3 URL JSON envelope', async () => {
        let received;
        setConfig([
            {
                callbackPath: 'report',
                accessType: 'S3-0',
                callback: async (tokenData, customData) => {
                    received = { tokenData, customData };
                    return { url: 'https://b.s3.amazonaws.com/k?X-Amz-Signature=x', expiresAt: 123 };
                }
            }
        ]);

        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'report',
            viewMode: true,
            requestedAccessType: 's3-0',
            tokenData: { viewType: 'S3-0', accessibleCallbacks: ['report'] },
            customData: { reportId: 'R9' }
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Cache-Control'], 'no-store');
        assert.deepEqual(res.jsonBody.data, { delivery: 'S3-URL', url: 'https://b.s3.amazonaws.com/k?X-Amz-Signature=x', expiresAt: 123 });
        assert.deepEqual(received.tokenData, { viewType: 'S3-0', accessibleCallbacks: ['report'] });
        assert.deepEqual(received.customData, { reportId: 'R9' });
    });

    test('a callback {error:true} maps to RAS-S3::CALLBACK-FAILED', async () => {
        setConfig([s3Callback({ error: true })]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'report',
            viewMode: true,
            requestedAccessType: 's3-0',
            tokenData: { viewType: 'S3-0', accessibleCallbacks: ['report'] },
            customData: {}
        });
        assert.equal(res.statusCode, 500);
        assert.equal(res.jsonBody.errorTrigger, 'RAS-S3::CALLBACK-FAILED::A::i');
    });

    test('a malformed callback url maps to RAS-S3::INVALID-URL', async () => {
        setConfig([s3Callback({ url: 'not-a-url' })]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'report',
            viewMode: true,
            requestedAccessType: 's3-0',
            tokenData: { viewType: 'S3-0', accessibleCallbacks: ['report'] },
            customData: {}
        });
        assert.equal(res.statusCode, 500);
        assert.equal(res.jsonBody.errorTrigger, 'RAS-S3::INVALID-URL::A::i');
    });
});

describe('deliverSecureResource — access-type binding', () => {
    beforeEach(() => setConfig([]));

    test('a SECURE-0 token cannot unlock an S3-0 request', async () => {
        setConfig([s3Callback({ url: 'https://b.s3.amazonaws.com/k' })]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'report',
            viewMode: true,
            requestedAccessType: 's3-0',
            tokenData: { viewType: 'SECURE-0', accessibleCallbacks: ['report'] },
            customData: {}
        });
        assert.equal(res.statusCode, 403);
        assert.equal(res.jsonBody.code, 'TOKEN-RESOURCE::ACCESS-TYPE-MISMATCH::A::p');
    });

    test('an S3-0 token cannot unlock a SECURE-0-registered callback', async () => {
        // token + request are S3-0, but the registered callback is SECURE-0
        setConfig([{ callbackPath: 'report', accessType: 'SECURE-0', callback: async () => ({ url: 'https://b.s3.amazonaws.com/k' }) }]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'report',
            viewMode: true,
            requestedAccessType: 's3-0',
            tokenData: { viewType: 'S3-0', accessibleCallbacks: ['report'] },
            customData: {}
        });
        assert.equal(res.statusCode, 403);
        assert.equal(res.jsonBody.code, 'TOKEN-RESOURCE::ACCESS-TYPE-MISMATCH::A::p');
    });
});

describe('deliverSecureResource — allowlist and config lookup', () => {
    beforeEach(() => setConfig([]));

    test('a path outside accessibleCallbacks is not authorized', async () => {
        setConfig([s3Callback({ url: 'https://b.s3.amazonaws.com/k' })]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'report',
            viewMode: true,
            requestedAccessType: 's3-0',
            tokenData: { viewType: 'S3-0', accessibleCallbacks: ['other'] },
            customData: {}
        });
        assert.equal(res.statusCode, 403);
        assert.equal(res.jsonBody.code, 'TOKEN-RESOURCE::NOT-AUTHORIZED::A::p');
    });

    test('an allowlisted but unregistered callback yields 404', async () => {
        setConfig([]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'report',
            viewMode: true,
            requestedAccessType: 's3-0',
            tokenData: { viewType: 'S3-0', accessibleCallbacks: ['report'] },
            customData: {}
        });
        assert.equal(res.statusCode, 404);
    });
});

describe('deliverSecureResource — SECURE-0 regression', () => {
    beforeEach(() => setConfig([]));

    test('the buffer delivery path is unchanged for SECURE-0', async () => {
        setConfig([secureCallback({ base64File: PNG.toString('base64'), mimeType: 'image/png' })]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'doc',
            viewMode: false,
            requestedAccessType: 'secure-0',
            tokenData: { viewType: 'SECURE-0', accessibleCallbacks: ['doc'] },
            customData: {}
        });
        assert.equal(res.headers['Content-Type'], 'image/png');
        assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
        assert.ok(Buffer.isBuffer(res.sent));
    });

    test('a SECURE-0 callback {error:true} still produces the legacy 500 text', async () => {
        setConfig([secureCallback({ error: true })]);
        const res = makeRes();
        await deliverSecureResource(res, {
            filePath: 'doc',
            viewMode: false,
            requestedAccessType: 'secure-0',
            tokenData: { viewType: 'SECURE-0', accessibleCallbacks: ['doc'] },
            customData: {}
        });
        assert.equal(res.statusCode, 500);
        assert.equal(res.sent, 'SERVER ERROR: Unable to obtain resource!');
        assert.ok(res.ended);
    });
});
