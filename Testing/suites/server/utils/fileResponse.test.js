// logger.js must be evaluated before GlobalAccessPoint.js: the two are circular and
// logger's module body calls globalAccessPoint at top level, so entering the cycle at
// GlobalAccessPoint leaves its binding in TDZ and the import throws.
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { getFileType } from '../../../../Packages/server/Orion-core/lib/Utils/Core/ResourceAccessManagment/dirBasedResources/convertors.js';
import { respondWithBuffer } from '../../../../Packages/server/Orion-core/lib/Utils/Core/ResourceAccessManagment/dirBasedResources/fileResponse.js';

const makeRes = () => ({
    headers: {},
    statusCode: null,
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
    }
});

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

describe('getFileType', () => {
    test('sniffs a PNG from a raw buffer', async () => {
        assert.equal(await getFileType(PNG, null), 'image/png');
    });

    test('still accepts a base64 string', async () => {
        assert.equal(await getFileType(PNG.toString('base64'), null), 'image/png');
    });

    test('falls back to the path extension when there are no magic bytes', async () => {
        assert.equal(await getFileType(Buffer.from('# title'), 'notes.md'), 'text/markdown');
    });

    test('reports octet-stream when content and path are both inconclusive', async () => {
        assert.equal(await getFileType(Buffer.from('# title'), null), 'application/octet-stream');
    });
});

describe('respondWithBuffer — declared type is not trusted blindly', () => {
    // mimeType reaches respondWithBuffer from an integrator-supplied callback, and the
    // response carries X-Content-Type-Options: nosniff — so a wrong label is never
    // corrected by the browser. The sniffed verdict has to win.
    test('a mislabelled PNG is served as image/png, not the declared text/html', async () => {
        const res = makeRes();
        await respondWithBuffer(res, PNG.toString('base64'), 'text/html', true);
        assert.equal(res.headers['Content-Type'], 'image/png');
    });

    test('the declared type still wins for formats without magic bytes', async () => {
        const res = makeRes();
        await respondWithBuffer(res, Buffer.from('id,name\n1,a').toString('base64'), 'text/csv', true);
        assert.equal(res.headers['Content-Type'], 'text/csv');
    });

    test('nosniff and disposition are always set', async () => {
        const res = makeRes();
        await respondWithBuffer(res, PNG.toString('base64'), 'image/png', false);
        assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
        assert.match(res.headers['Content-Disposition'], /^attachment; filename=/);
    });
});
