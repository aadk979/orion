import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    getIpRange,
    getIp,
    isIpInRange,
    generateIpFingerprint,
    verifyIpFingerprint,
    RISK_CONFIG
} from '../../../../Packages/server/Orion-core/lib/Utils/Ip.js';
import { mockRequest } from '../../../helpers/mocks.js';
import { ipv4, ipv6 } from '../../../helpers/fixtures.js';

// NOTE: functions that call the ASN lookup (getIpRiskAssessment / the risk path
// of isIpInRange for out-of-range IPs) perform network I/O and are intentionally
// exercised only via in-range inputs that short-circuit before any lookup.

describe('getIpRange', () => {
    test('collapses IPv4 to a /24', () => {
        assert.equal(getIpRange('192.168.1.55'), '192.168.1.0/24');
    });
    test('collapses IPv6 to a /64', () => {
        const range = getIpRange(ipv6.a);
        assert.match(range, /\/64$/);
    });
    test('throws on invalid IP', () => {
        assert.throws(() => getIpRange('not-an-ip'));
    });
});

describe('getIp', () => {
    test('prefers the first x-forwarded-for entry', () => {
        const req = mockRequest({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
        assert.equal(getIp(req), '203.0.113.9');
    });
    test('falls back to the socket remote address', () => {
        const req = mockRequest({ headers: {}, connection: { remoteAddress: '198.51.100.7' } });
        assert.equal(getIp(req), '198.51.100.7');
    });
});

describe('isIpInRange — exact CIDR containment (no network)', () => {
    test('true when the IP is inside the CIDR', async () => {
        assert.equal(await isIpInRange('192.168.1.5', '192.168.1.0/24'), true);
        assert.equal(await isIpInRange('10.0.0.200', '10.0.0.0/8'), true);
    });
    test('false for a malformed CIDR', async () => {
        assert.equal(await isIpInRange('192.168.1.5', 'garbage'), false);
    });
});

describe('IP fingerprints (HMAC)', () => {
    const secret = 'server-secret';

    test('fingerprint is a stable 16-hex-char HMAC', () => {
        const fp = generateIpFingerprint(ipv4.a, 'user-1', secret);
        assert.match(fp, /^[0-9a-f]{16}$/);
        assert.equal(generateIpFingerprint(ipv4.a, 'user-1', secret), fp);
    });

    test('verifyIpFingerprint accepts a matching fingerprint', () => {
        const fp = generateIpFingerprint(ipv4.a, 'user-1', secret);
        assert.equal(verifyIpFingerprint(ipv4.a, 'user-1', fp, secret), true);
    });

    test('verifyIpFingerprint rejects wrong ip / user / secret', () => {
        const fp = generateIpFingerprint(ipv4.a, 'user-1', secret);
        assert.equal(verifyIpFingerprint(ipv4.different, 'user-1', fp, secret), false);
        assert.equal(verifyIpFingerprint(ipv4.a, 'user-2', fp, secret), false);
        assert.equal(verifyIpFingerprint(ipv4.a, 'user-1', fp, 'other-secret'), false);
    });
});

describe('RISK_CONFIG', () => {
    test('exposes weights and thresholds used by the risk engine', () => {
        assert.equal(typeof RISK_CONFIG.WEIGHTS.EXACT_CIDR_MATCH, 'number');
        assert.ok(RISK_CONFIG.THRESHOLDS.STRICT > RISK_CONFIG.THRESHOLDS.PERMISSIVE);
    });
});
