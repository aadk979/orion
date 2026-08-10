import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { getIpRange, getIp, isIpInRange } from '../../../../Packages/server/Orion-core/lib/Utils/Ip.js';
import { mockRequest } from '../../../helpers/mocks.js';
import { ipv6 } from '../../../helpers/fixtures.js';

// The risk-scoring engine this file used to cover (RISK_CONFIG, assessRisk,
// getIpRiskAssessment, isIpPlausiblyRelated, generateIpFingerprint /
// verifyIpFingerprint) was removed: none of it had a caller anywhere in the
// tree, and it pulled geoip-lite and ip-to-asn in with it. Its tests went with
// it rather than being kept alive to exercise code nothing runs.
//
// What remains is the part that is actually load-bearing: resolving the client
// address, reducing it to a range, and strict containment.

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
    test('ignores a raw x-forwarded-for header', () => {
        // getIp reads req.ip → socket → connection, deliberately NOT the raw
        // header. x-forwarded-for is client-controlled, so trusting it directly
        // lets any caller declare an arbitrary source IP — which then flows into
        // IP-range token binding, risk scoring and rate limiting. Express
        // populates req.ip from the header only when `trust proxy` is configured,
        // which is where that decision belongs.
        //
        // This previously asserted the opposite (that the first header entry
        // wins). The header-trusting implementation was removed in the security
        // audit remediation; the test outlived it and went unnoticed because this
        // assertion never ran.
        const req = mockRequest({
            headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
            connection: { remoteAddress: '198.51.100.7' }
        });
        assert.equal(getIp(req), '198.51.100.7');
    });

    test('prefers req.ip when the framework has resolved one', () => {
        const req = mockRequest({ ip: '203.0.113.4', connection: { remoteAddress: '198.51.100.7' } });
        assert.equal(getIp(req), '203.0.113.4');
    });

    test('throws rather than guessing when no IP can be resolved', () => {
        const req = mockRequest({ headers: {}, connection: {} });
        assert.throws(() => getIp(req), /unable to resolve a client IP/);
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

describe('isIpInRange — is a predicate, never a similarity score', () => {
    test('an address outside the range is rejected, however similar', async () => {
        // The former implementation fell back to geo/ASN similarity when
        // containment failed, so a neighbouring subnet could be accepted by
        // something calling itself a binding. Containment is now the whole
        // answer.
        assert.equal(await isIpInRange('192.168.2.5', '192.168.1.0/24'), false);
        assert.equal(await isIpInRange('203.0.113.5', '198.51.100.0/24'), false);
    });

    test('fails closed on malformed input rather than throwing', async () => {
        assert.equal(await isIpInRange('not-an-ip', '192.168.1.0/24'), false);
        assert.equal(await isIpInRange('192.168.1.5', ''), false);
    });

    test('IPv6 containment works at the /64 the ranges use', async () => {
        const range = getIpRange(ipv6.a);
        assert.equal(await isIpInRange(ipv6.a, range), true);
    });
});
