import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import * as E from '../../../../Packages/server/Orion-core/lib/Utils/Encoders.js';

const SAMPLES = ['hello world', 'Orion 🔐 auth', '', 'a', 'Ünîçödé + symbols !@#$%^&*()', '12345'];

describe('Encoders — reversible string codecs', () => {
    const roundTrips = [
        ['base64', E.base64Encode, E.base64Decode],
        ['hex', E.hexEncode, E.hexDecode],
        ['binary', E.binaryEncode, E.binaryDecode],
        ['utf8', E.utf8Encode, E.utf8Decode],
        ['utf16', E.utf16Encode, E.utf16Decode],
        ['latin1-safe', s => E.latin1Encode(s), s => E.latin1Decode(s)],
        ['url', E.urlEncode, E.urlDecode]
    ];

    for (const [name, encode, decode] of roundTrips) {
        test(`${name} round-trips unicode + ascii`, () => {
            for (const input of SAMPLES) {
                // latin1 cannot represent multibyte codepoints; skip those for it
                if (name === 'latin1-safe' && /[^\x00-\xff]/.test(input)) continue;
                assert.equal(decode(encode(input)), input, `failed for "${input}"`);
            }
        });
    }
});

describe('Encoders — known-answer vectors', () => {
    test('base64 encodes known values', () => {
        assert.equal(E.base64Encode('hello'), 'aGVsbG8=');
        assert.equal(E.base64Decode('aGVsbG8='), 'hello');
    });

    test('hex encodes known values', () => {
        assert.equal(E.hexEncode('AB'), '4142');
        assert.equal(E.hexDecode('4142'), 'AB');
    });

    test('urlEncode escapes reserved characters', () => {
        assert.equal(E.urlEncode('a b&c=d'), 'a%20b%26c%3Dd');
    });
});

describe('Encoders — Uint8Array <-> base64', () => {
    test('base64EncodeUint8 / base64DecodeToUint8 round-trip', () => {
        const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
        const encoded = E.base64EncodeUint8(bytes);
        assert.equal(typeof encoded, 'string');
        const decoded = E.base64DecodeToUint8(encoded);
        assert.ok(decoded instanceof Uint8Array);
        assert.deepEqual(Array.from(decoded), Array.from(bytes));
    });

    test('empty byte array', () => {
        const encoded = E.base64EncodeUint8(new Uint8Array([]));
        assert.equal(E.base64DecodeToUint8(encoded).length, 0);
    });
});

describe('Encoders — packageExports surface', () => {
    test('exposes every codec on packageExports', () => {
        const expected = [
            'base64Encode',
            'base64Decode',
            'base64EncodeUint8',
            'base64DecodeToUint8',
            'hexEncode',
            'hexDecode',
            'binaryEncode',
            'binaryDecode',
            'asciiEncode',
            'asciiDecode',
            'utf8Encode',
            'utf8Decode',
            'utf16Encode',
            'utf16Decode',
            'latin1Encode',
            'latin1Decode',
            'urlEncode',
            'urlDecode'
        ];
        for (const key of expected) {
            assert.equal(typeof E.packageExports[key], 'function', `missing ${key}`);
        }
    });
});
