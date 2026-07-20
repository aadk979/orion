// logger.js must be evaluated before GlobalAccessPoint.js (circular; see fileResponse.test.js).
import '../../../helpers/bootstrap.js';
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { __sealing } from '../../../../Packages/server/Orion-core/lib/Utils/Databases/models/TOTPModel.js';

const { seal, open, SEAL_PREFIX } = __sealing;

const withKey = key => globalAccessPoint.setValue('systemConfig', { utilities: { dataEncryption: { key } } });

describe('TOTPModel secret sealing (AES-256-GCM at rest)', () => {
    test('seal → open round-trips with a configured key', () => {
        withKey('unit-test-key');

        const sealed = seal('JBSWY3DPEHPK3PXP');
        assert.ok(sealed.startsWith(SEAL_PREFIX), 'sealed value carries the enc.v1. prefix');
        assert.notEqual(sealed, 'JBSWY3DPEHPK3PXP');
        assert.equal(open(sealed), 'JBSWY3DPEHPK3PXP');
    });

    test('sealing is non-deterministic (fresh IV per call)', () => {
        withKey('unit-test-key');
        assert.notEqual(seal('JBSWY3DPEHPK3PXP'), seal('JBSWY3DPEHPK3PXP'));
    });

    test('legacy plaintext rows pass through open() untouched', () => {
        withKey('unit-test-key');
        assert.equal(open('LEGACYPLAINTEXTSECRET'), 'LEGACYPLAINTEXTSECRET');
    });

    test('null / undefined pass through both directions', () => {
        withKey('unit-test-key');
        assert.equal(seal(null), null);
        assert.equal(open(null), null);
        assert.equal(seal(undefined), undefined);
        assert.equal(open(undefined), undefined);
    });

    test('tampered ciphertext fails GCM authentication', () => {
        withKey('unit-test-key');

        const sealed = seal('JBSWY3DPEHPK3PXP');
        const parts = sealed.slice(SEAL_PREFIX.length).split('.');
        const ct = Buffer.from(parts[2], 'base64');
        ct[0] ^= 0xff;
        const tampered = `${SEAL_PREFIX}${parts[0]}.${parts[1]}.${ct.toString('base64')}`;

        assert.throws(() => open(tampered));
    });

    test('open() on a sealed value throws a clear error when no key is configured', () => {
        withKey('unit-test-key');
        const sealed = seal('JBSWY3DPEHPK3PXP');

        withKey(undefined);
        assert.throws(() => open(sealed), /dataEncryption\.key is not configured/);
    });

    test('seal() without a key stores plaintext (backward-compatible degradation)', () => {
        withKey(undefined);
        assert.equal(seal('JBSWY3DPEHPK3PXP'), 'JBSWY3DPEHPK3PXP');
    });
});
