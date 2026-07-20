import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    buildTierBinding,
    assessTierRisk,
    STEP_UP_RISK_THRESHOLD,
    FINGERPRINT_MISMATCH_RISK,
    IP_MISMATCH_RISK
} from '../../../../Packages/server/Orion-core/lib/Utils/Core/TokenManagement/internals/tierBinding.js';
import { verifyHash } from '../../../../Packages/server/Orion-core/lib/Utils/CryptoFunctions.js';

describe('tierBinding — buildTierBinding', () => {
    test('tier 1 binds nothing', async () => {
        const binding = await buildTierBinding(1, { fingerprint: 'fp', ip: '203.0.113.7' });
        assert.deepEqual(binding, { payloadFields: {}, dbFields: {} });
    });

    test('tier 2 binds the /24 IP range only', async () => {
        const binding = await buildTierBinding(2, { fingerprint: 'fp', ip: '203.0.113.7' });
        assert.deepEqual(binding.payloadFields, { ipRange: '203.0.113.0/24' });
        assert.deepEqual(binding.dbFields, { ipRange: '203.0.113.0/24' });
    });

    test('tier 3 binds a verifiable fingerprint hash only', async () => {
        const binding = await buildTierBinding(3, { fingerprint: 'device-fp', ip: '203.0.113.7' });
        assert.equal(binding.payloadFields.ipRange, undefined);
        assert.equal(binding.payloadFields.hashedDeviceFingerprint, binding.dbFields.hashedFingerprint);
        assert.equal(await verifyHash('device-fp', binding.dbFields.hashedFingerprint), true);
        assert.equal(await verifyHash('other-fp', binding.dbFields.hashedFingerprint), false);
    });

    test('tier 4 binds both IP range and fingerprint', async () => {
        const binding = await buildTierBinding(4, { fingerprint: 'device-fp', ip: '203.0.113.7' });
        assert.equal(binding.dbFields.ipRange, '203.0.113.0/24');
        assert.equal(binding.payloadFields.ipRange, '203.0.113.0/24');
        assert.ok(binding.dbFields.hashedFingerprint);
        assert.equal(binding.payloadFields.hashedDeviceFingerprint, binding.dbFields.hashedFingerprint);
    });
});

describe('tierBinding — assessTierRisk (checks stubbed via the deps seam)', () => {
    const tokenRow = { ip_range: '203.0.113.0/24', hashed_fingerprint: 'stored-hash' };
    const presented = { fingerprint: 'fp', ip: '203.0.113.7' };
    const stub = (fingerprintMatches, ipMatches) => ({
        verifyHash: async () => fingerprintMatches,
        isIpInRange: async () => ipMatches
    });

    test('tier 2: IP match passes, mismatch is a hard failure (no step-up)', async () => {
        assert.deepEqual(await assessTierRisk(2, presented, tokenRow, stub(true, true)), { ok: true });
        assert.deepEqual(await assessTierRisk(2, presented, tokenRow, stub(true, false)), { ok: false, hardFail: true });
    });

    test('tier 3: fingerprint mismatch alone stays under the step-up threshold', async () => {
        assert.ok(FINGERPRINT_MISMATCH_RISK < STEP_UP_RISK_THRESHOLD);
        assert.deepEqual(await assessTierRisk(3, presented, tokenRow, stub(false, true)), { ok: true });
        assert.deepEqual(await assessTierRisk(3, presented, tokenRow, stub(true, true)), { ok: true });
    });

    test('tier 4: either signal alone passes; both together demand step-up', async () => {
        assert.deepEqual(await assessTierRisk(4, presented, tokenRow, stub(true, true)), { ok: true });
        assert.deepEqual(await assessTierRisk(4, presented, tokenRow, stub(false, true)), { ok: true });
        assert.deepEqual(await assessTierRisk(4, presented, tokenRow, stub(true, false)), { ok: true });

        const result = await assessTierRisk(4, presented, tokenRow, stub(false, false));
        assert.deepEqual(result, {
            ok: false,
            stepUpRequired: true,
            riskScore: FINGERPRINT_MISMATCH_RISK + IP_MISMATCH_RISK
        });
        assert.ok(result.riskScore >= STEP_UP_RISK_THRESHOLD);
    });
});
