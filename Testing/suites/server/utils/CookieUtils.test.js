import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    stringifyCookieData,
    parseCookieData,
    setCookie,
    getCookie
} from '../../../../Packages/server/Orion-core/lib/Utils/CookieUtils.js';
import { mockRequest, mockResponse } from '../../../helpers/mocks.js';

describe('stringifyCookieData', () => {
    test('passes strings through unchanged', () => {
        assert.equal(stringifyCookieData('abc'), 'abc');
    });
    test('JSON-stringifies objects and arrays', () => {
        assert.equal(stringifyCookieData({ a: 1 }), '{"a":1}');
        assert.equal(stringifyCookieData([1, 2]), '[1,2]');
    });
});

describe('parseCookieData', () => {
    test('parses JSON strings into objects', () => {
        assert.deepEqual(parseCookieData('{"a":1}'), { a: 1 });
    });
    test('returns the original string when not JSON', () => {
        assert.equal(parseCookieData('plain-token'), 'plain-token');
    });
    test('passes non-string values through unchanged', () => {
        const obj = { already: 'object' };
        assert.equal(parseCookieData(obj), obj);
        assert.equal(parseCookieData(undefined), undefined);
    });
});

describe('setCookie / getCookie round-trip', () => {
    test('setCookie serializes and forwards options to res.cookie', () => {
        const res = mockResponse();
        setCookie(res, 'session', { uid: 7 }, { httpOnly: true });
        assert.equal(res.cookieCalls.length, 1);
        assert.deepEqual(res.cookieCalls[0], {
            key: 'session',
            value: '{"uid":7}',
            options: { httpOnly: true }
        });
    });

    test('getCookie parses a stored JSON cookie', () => {
        const req = mockRequest({ cookies: { session: '{"uid":7}' } });
        assert.deepEqual(getCookie(req, 'session'), { uid: 7 });
    });

    test('getCookie returns defaultValue for a missing cookie', () => {
        const req = mockRequest({ cookies: {} });
        assert.equal(getCookie(req, 'nope', 'fallback'), 'fallback');
        assert.equal(getCookie(req, 'nope'), undefined);
    });

    test('full round-trip through a shared cookie jar', () => {
        const res = mockResponse();
        setCookie(res, 'data', { list: [1, 2, 3] });
        const stored = res.cookieCalls[0].value;
        const req = mockRequest({ cookies: { data: stored } });
        assert.deepEqual(getCookie(req, 'data'), { list: [1, 2, 3] });
    });
});
