import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { isValidEmail, isPasswordSafe, isValidEmailDomain, validateClientUrls } from '../../../../Packages/server/Orion-core/lib/Utils/Validator.js';
import { emails, passwords } from '../../../helpers/fixtures.js';

describe('isValidEmail', () => {
    test('accepts well-formed addresses', () => {
        for (const email of emails.valid) {
            assert.equal(isValidEmail(email), true, `expected valid: ${email}`);
        }
    });

    test('rejects malformed addresses', () => {
        for (const email of emails.invalid) {
            assert.equal(isValidEmail(email), false, `expected invalid: ${email}`);
        }
    });
});

describe('isPasswordSafe (zxcvbn score >= 3)', () => {
    test('accepts strong passphrases', () => {
        for (const pw of passwords.strong) {
            assert.equal(isPasswordSafe(pw), true, `expected safe: ${pw}`);
        }
    });

    test('rejects common/weak passwords', () => {
        for (const pw of passwords.weak) {
            assert.equal(isPasswordSafe(pw), false, `expected unsafe: ${pw}`);
        }
    });
});

describe('isValidEmailDomain', () => {
    const allowed = ['example.com', 'Company.IO'];

    test('accepts emails on the allow-list (case-insensitive)', () => {
        assert.equal(isValidEmailDomain(allowed, 'user@example.com'), true);
        assert.equal(isValidEmailDomain(allowed, 'user@COMPANY.io'), true);
    });

    test('rejects emails outside the allow-list', () => {
        assert.equal(isValidEmailDomain(allowed, 'user@gmail.com'), false);
    });

    test('rejects malformed emails outright', () => {
        assert.equal(isValidEmailDomain(allowed, 'not-an-email'), false);
        assert.equal(isValidEmailDomain(allowed, 'a@b@example.com'), false);
    });
});

describe('validateClientUrls', () => {
    test('keeps protocol+host(+port) origins and strips trailing slash duplicates', () => {
        const out = validateClientUrls([
            'https://app.example.com',
            'https://app.example.com/', // dup of the above after normalization
            'http://localhost:3000'
        ]);
        assert.deepEqual(out, ['https://app.example.com', 'http://localhost:3000']);
    });

    test('rejects urls with paths, queries or fragments', () => {
        const out = validateClientUrls(['https://example.com/path', 'https://example.com/?q=1', 'https://example.com/#frag']);
        assert.deepEqual(out, []);
    });

    test('rejects non-http protocols and non-string entries', () => {
        const out = validateClientUrls(['ftp://example.com', 'javascript:alert(1)', 42, null, {}]);
        assert.deepEqual(out, []);
    });

    test('rejects bare hostnames without a dot (except localhost)', () => {
        assert.deepEqual(validateClientUrls(['http://intranet']), []);
        assert.deepEqual(validateClientUrls(['http://localhost']), ['http://localhost']);
    });

    test('returns empty array for non-array input', () => {
        assert.deepEqual(validateClientUrls('https://example.com'), []);
        assert.deepEqual(validateClientUrls(null), []);
    });

    test('de-duplicates repeated origins', () => {
        const out = validateClientUrls(['https://app.example.com', 'https://app.example.com']);
        assert.deepEqual(out, ['https://app.example.com']);
    });
});
