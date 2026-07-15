import '../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import * as orion from '../../../Packages/server/Orion-core/index.js';

// Guards the public API surface of the package entry point. If an export is
// renamed or dropped, this fails loudly.
const EXPECTED_EXPORTS = [
    'initiateServer', 'globalAccessPoint', 'validators', 'ipUtils',
    'encodersAndDecoders', 'uaParser', 'dateAndTime', 'cron', 'sanitizer',
    'cookies', 'fileIO', 'tokens', 'valueGenerators', 'orionCrypto',
    'orionInfo', 'requestContext', 'logger', 'userControl'
];

describe('Orion-core package entry point', () => {
    test('exposes the full expected public surface', () => {
        for (const name of EXPECTED_EXPORTS) {
            assert.ok(name in orion, `missing export: ${name}`);
        }
    });

    test('initiateServer is callable and grouped utils are objects/functions', () => {
        assert.equal(typeof orion.initiateServer, 'function');
        assert.equal(typeof orion.encodersAndDecoders.base64Encode, 'function');
        assert.equal(typeof orion.dateAndTime.getCurrentUnixTime, 'function');
        assert.equal(typeof orion.valueGenerators.generateId, 'function');
        assert.equal(typeof orion.sanitizer.sanitizeString, 'function');
        assert.equal(typeof orion.cookies.setCookie, 'function');
    });

    test('orionInfo carries version + status metadata', () => {
        assert.ok('__Version__' in orion.orionInfo);
        assert.ok('__Status__' in orion.orionInfo);
    });
});
