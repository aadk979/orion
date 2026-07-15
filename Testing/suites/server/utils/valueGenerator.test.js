import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    generateRequestId,
    generateId,
    generateRandomNumber,
    generateChallenge,
    generateUID,
    emailPrefixList,
    packageExports
} from '../../../../Packages/server/Orion-core/lib/Utils/valueGenerator.js';

const ALNUM = /^[a-zA-Z0-9]+$/;

describe('generateId', () => {
    test('has ID_<PREFIX>- shape and requested body length', () => {
        const id = generateId('np', 32);
        assert.match(id, /^ID_NP-[a-zA-Z0-9]{32}$/);
    });

    test('uppercases the prefix and respects custom length', () => {
        const id = generateId('user', 8);
        assert.ok(id.startsWith('ID_USER-'));
        assert.equal(id.split('-')[1].length, 8);
    });

    test('produces unique values across many calls', () => {
        const seen = new Set();
        for (let i = 0; i < 1000; i++) seen.add(generateId('x', 24));
        assert.equal(seen.size, 1000);
    });
});

describe('generateRequestId', () => {
    test('has REQ_<PREFIX>- shape', () => {
        assert.match(generateRequestId('ab', 16), /^REQ_AB-[a-zA-Z0-9]{16}$/);
    });

    test('defaults prefix NP and length 32', () => {
        assert.match(generateRequestId(), /^REQ_NP-[a-zA-Z0-9]{32}$/);
    });
});

describe('generateRandomNumber', () => {
    test('returns only digits of the requested length', () => {
        const n = generateRandomNumber(10);
        assert.equal(n.length, 10);
        assert.match(n, /^[0-9]{10}$/);
    });
});

describe('generateChallenge', () => {
    test('returns hex of 2×byteLength characters', () => {
        const c = generateChallenge(16);
        assert.equal(c.length, 32);
        assert.match(c, /^[0-9a-f]{32}$/);
    });

    test('successive challenges differ', () => {
        assert.notEqual(generateChallenge(16), generateChallenge(16));
    });
});

describe('generateUID', () => {
    test('is a valid RFC-4122 UUID', () => {
        assert.match(generateUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});

describe('emailPrefixList + packageExports', () => {
    test('maps well-known providers to short codes', () => {
        assert.equal(emailPrefixList['gmail.com'], 'GM');
        assert.equal(emailPrefixList['proton.me'], 'PM-B');
    });

    test('all mapped codes are short non-empty strings', () => {
        for (const code of Object.values(emailPrefixList)) {
            assert.equal(typeof code, 'string');
            assert.ok(code.length > 0 && code.length <= 5);
        }
    });

    test('packageExports exposes the four generators', () => {
        for (const key of ['generateRequestId', 'generateId', 'generateRandomNumber', 'generateChallenge']) {
            assert.equal(typeof packageExports[key], 'function');
        }
    });

    test('charset never leaks separator or lowercase-only assumptions', () => {
        // body of an ID should be strictly alphanumeric (no undefined chars from modulo bugs)
        const body = generateId('z', 200).split('-')[1];
        assert.match(body, ALNUM);
    });
});
