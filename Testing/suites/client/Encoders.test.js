import '../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import * as E from '../../../Packages/client/lib/Utils/Encoders.js';

// Browser SDK encoders run under Node because btoa/atob/TextEncoder/TextDecoder
// are available as Node globals.

const SAMPLES = ['hello world', 'Orion 🔐 auth', 'a', 'Ünîçödé !@#$%'];

describe('client Encoders — string round-trips', () => {
    const roundTrips = [
        ['base64', E.base64Encode, E.base64Decode],
        ['hex', E.hexEncode, E.hexDecode],
        ['binary', E.binaryEncode, E.binaryDecode],
        ['url', E.urlEncode, E.urlDecode]
    ];

    for (const [name, encode, decode] of roundTrips) {
        test(`${name} round-trips`, () => {
            for (const input of SAMPLES) {
                assert.equal(decode(encode(input)), input, `failed for "${input}" via ${name}`);
            }
        });
    }

    // KNOWN DEFECT (documented, not asserted as working): the client utf16 codec
    // does NOT round-trip. `new TextEncoder('utf-16le')` ignores the label and
    // always emits UTF-8, which utf16Decode then misreads as UTF-16LE. This test
    // pins the broken behaviour so a future fix flips it to a real round-trip.
    test('utf16 codec is currently NOT reversible (regression pin — see comment)', () => {
        const input = 'hello';
        assert.notEqual(E.utf16Decode(E.utf16Encode(input)), input);
    });

    test('latin1 round-trips within the 0x00–0xFF range', () => {
        const input = 'Café-ção'; // all codepoints < 256
        assert.equal(E.latin1Decode(E.latin1Encode(input)), input);
    });
});

describe('client Encoders — Uint8Array codecs', () => {
    test('utf8Encode returns bytes; utf8Decode reverses', () => {
        const bytes = E.utf8Encode('hi 🔐');
        assert.ok(bytes instanceof Uint8Array);
        assert.equal(E.utf8Decode(bytes), 'hi 🔐');
    });

    test('base64EncodeUint8 / base64DecodeToUint8 round-trip bytes', () => {
        const bytes = new Uint8Array([0, 10, 128, 200, 255]);
        const encoded = E.base64EncodeUint8(bytes);
        assert.deepEqual(Array.from(E.base64DecodeToUint8(encoded)), Array.from(bytes));
    });
});

describe('client Encoders — parity with known values', () => {
    test('base64Encode("hello") === "aGVsbG8="', () => {
        assert.equal(E.base64Encode('hello'), 'aGVsbG8=');
    });
    test('hexEncode("AB") === "4142"', () => {
        assert.equal(E.hexEncode('AB'), '4142');
    });
});
