import '../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    isValidEmail,
    checkPasswordStrength,
    generateNonce,
    hexToUint8Array
} from '../../../Packages/client/lib/Utils/Utils.js';

// Note: sanitizeInput() depends on a live DOM (DOMPurify) and is covered by
// browser-level tests, not this Node suite.

describe('client isValidEmail', () => {
    test('accepts well-formed addresses', () => {
        for (const e of ['a@b.co', 'user.name+tag@sub.example.com']) {
            assert.equal(isValidEmail(e), true, e);
        }
    });
    test('rejects malformed addresses', () => {
        for (const e of ['', 'nope', '@b.com', 'a@b', 'a b@c.com']) {
            assert.equal(isValidEmail(e), false, e);
        }
    });
});

describe('checkPasswordStrength', () => {
    test('reports "Too Short" for < 8 chars', () => {
        assert.equal(checkPasswordStrength('aB3$'), 'Too Short');
    });
    test('reports "Weak" for a single character class', () => {
        assert.equal(checkPasswordStrength('aaaaaaaa'), 'Weak');
    });
    test('reports "Medium" for two or three classes', () => {
        assert.equal(checkPasswordStrength('abcABC12'), 'Medium'); // lower+upper+number = 3
        assert.equal(checkPasswordStrength('abcdefG1'), 'Medium');
    });
    test('reports "Strong" for all four classes', () => {
        assert.equal(checkPasswordStrength('abcABC1$'), 'Strong');
    });
});

describe('generateNonce', () => {
    test('returns a generator producing unique, well-formed nonces', () => {
        const next = generateNonce();
        const a = next();
        const b = next();
        assert.notEqual(a, b);
        assert.match(a, /^\d+-\d+-\d+$/);
    });
});

describe('hexToUint8Array', () => {
    test('parses even-length hex into bytes', () => {
        assert.deepEqual(Array.from(hexToUint8Array('00ff10')), [0, 255, 16]);
    });
    test('throws on odd-length hex', () => {
        assert.throws(() => hexToUint8Array('abc'), /Invalid hex string/);
    });
    test('round-trips with a hex encoder', () => {
        const bytes = hexToUint8Array('deadbeef');
        assert.deepEqual(Array.from(bytes), [0xde, 0xad, 0xbe, 0xef]);
    });
});
