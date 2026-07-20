import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { getRandomElement, generateNumberedStringsFromTemplate } from '../../../../Packages/server/Orion-core/lib/Utils/ArrayUtilities.js';

describe('getRandomElement', () => {
    test('returns a member of the array', () => {
        const arr = ['a', 'b', 'c', 'd'];
        for (let i = 0; i < 100; i++) {
            assert.ok(arr.includes(getRandomElement(arr)));
        }
    });

    test('returns undefined for empty array or non-array input', () => {
        assert.equal(getRandomElement([]), undefined);
        assert.equal(getRandomElement(null), undefined);
        assert.equal(getRandomElement(undefined), undefined);
        assert.equal(getRandomElement('not-an-array'), undefined);
        assert.equal(getRandomElement(123), undefined);
    });

    test('single element array always returns that element', () => {
        assert.equal(getRandomElement(['only']), 'only');
    });

    test('eventually reaches every element (distribution sanity)', () => {
        const arr = [1, 2, 3];
        const hits = new Set();
        for (let i = 0; i < 500; i++) hits.add(getRandomElement(arr));
        assert.deepEqual([...hits].sort(), [1, 2, 3]);
    });
});

describe('generateNumberedStringsFromTemplate', () => {
    test('substitutes <i> with the index', () => {
        assert.deepEqual(generateNumberedStringsFromTemplate('item-<i>', 3), ['item-0', 'item-1', 'item-2']);
    });

    test('defaults to 10 items', () => {
        const out = generateNumberedStringsFromTemplate('n<i>');
        assert.equal(out.length, 10);
        assert.equal(out[9], 'n9');
    });

    test('zero count yields empty array', () => {
        assert.deepEqual(generateNumberedStringsFromTemplate('x<i>', 0), []);
    });

    test('templates without <i> repeat unchanged', () => {
        assert.deepEqual(generateNumberedStringsFromTemplate('static', 2), ['static', 'static']);
    });
});
