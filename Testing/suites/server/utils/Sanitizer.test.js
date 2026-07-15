import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeString } from '../../../../Packages/server/Orion-core/lib/Utils/Sanitizer.js';

describe('sanitizeString (HTML-entity escaping)', () => {
    test('escapes angle brackets and quotes', () => {
        assert.equal(sanitizeString('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;&#x2F;script&gt;');
    });

    test('escapes ampersands and quotes', () => {
        assert.equal(sanitizeString(`a & b "c" 'd'`), 'a &amp; b &quot;c&quot; &#x27;d&#x27;');
    });

    test('leaves plain text untouched', () => {
        assert.equal(sanitizeString('hello world 123'), 'hello world 123');
    });

    test('is idempotent-safe (double escaping only escapes the entities)', () => {
        const once = sanitizeString('<b>');
        const twice = sanitizeString(once);
        assert.equal(twice, '&amp;lt;b&amp;gt;');
    });
});
