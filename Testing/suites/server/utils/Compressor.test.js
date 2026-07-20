import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { compressString, decompressString, compressURLs, decompressURLs } from '../../../../Packages/server/Orion-core/lib/Utils/Compressor.js';

describe('gzip string compression', () => {
    test('compress → decompress round-trips arbitrary text', async () => {
        const samples = ['', 'hello', 'Orion 🔐 auth ' + 'x'.repeat(1000), JSON.stringify({ a: [1, 2, 3], b: 'y' })];
        for (const s of samples) {
            const c = await compressString(s);
            assert.equal(typeof c, 'string');
            assert.equal(await decompressString(c), s);
        }
    });

    test('compressing highly-repetitive input actually shrinks it', async () => {
        const big = 'A'.repeat(5000);
        const c = await compressString(big);
        assert.ok(c.length < big.length, 'gzip should shrink repetitive data');
    });
});

describe('URL compression (compact wire form)', () => {
    test('encodes protocol as a single-char prefix and strips .com', () => {
        assert.deepEqual(compressURLs(['https://example.com']), ['s:example']);
        assert.deepEqual(compressURLs(['http://test.com/cb']), ['o:test/cb']);
    });

    test('round-trips simple .com origins and localhost', () => {
        const urls = ['https://example.com', 'http://test.com/callback', 'http://localhost:3000/x'];
        assert.deepEqual(decompressURLs(compressURLs(urls)), urls);
    });

    test('preserves host:port and dotted hosts through decompression', () => {
        assert.deepEqual(decompressURLs(['o:localhost:8080/a']), ['http://localhost:8080/a']);
        assert.deepEqual(decompressURLs(['s:sub.example.org/p']), ['https://sub.example.org/p']);
    });
});
