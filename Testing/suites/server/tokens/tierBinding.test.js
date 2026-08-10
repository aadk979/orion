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
// buildTierBinding digests fingerprints with the keyed HMAC scheme in
// fingerprintDigest.js (values are prefixed `hmac$`), so verification must use
// its matching verifier. This previously asserted with CryptoFunctions'
// verifyHash — a different scheme that can never verify an HMAC digest, so the
// assertion could only ever be false. It went unnoticed because this file
// crashed on import and the crash was reported as a pass.
import { verifyFingerprint } from '../../../../Packages/server/Orion-core/lib/Utils/fingerprintDigest.js';

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
        assert.equal(await verifyFingerprint('device-fp', binding.dbFields.hashedFingerprint), true);
        assert.equal(await verifyFingerprint('other-fp', binding.dbFields.hashedFingerprint), false);
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

    // The binding mode is no longer an input to the risk decision. It used to
    // be: an IP mismatch was fatal at tier 2 when `tokens.binding` was off, and
    // merely scored when it was on. Both branches are gone — the score now
    // reaches the threshold on its own, so the answer to an address that has
    // moved is a step-up challenge at every tier that measures it.
    const stub = (fingerprintMatches, ipMatches) => ({
        verifyHash: async () => fingerprintMatches,
        isIpInRange: async () => ipMatches
    });

    test('the threshold is reachable by a single IP mismatch', () => {
        // Guards the change this whole file turns on. At the old threshold of 50
        // no single signal could reach it, so tiers 2 and 3 could never demand
        // step-up and tier 4 only did so when BOTH signals failed — leaving the
        // entire step-up subsystem unreachable on most deployments.
        assert.ok(IP_MISMATCH_RISK >= STEP_UP_RISK_THRESHOLD, 'an IP mismatch must be able to demand step-up by itself');
    });

    test('tier 2: IP mismatch demands step-up rather than hard-failing', async () => {
        assert.deepEqual(await assessTierRisk(2, presented, tokenRow, stub(true, true)), { ok: true, riskScore: 0 });

        const moved = await assessTierRisk(2, presented, tokenRow, stub(true, false));

        assert.equal(moved.hardFail, undefined, 'an address that has moved is challenged, not ejected');
        assert.deepEqual(moved, { ok: false, stepUpRequired: true, riskScore: IP_MISMATCH_RISK });
    });

    test('tier 2 behaves identically whether or not proof of possession is on', async () => {
        // The old code took a different branch per binding mode, which meant a
        // tier-2 deployment running DPoP scored the mismatch and then discarded
        // the result because 40 fell short of 50.
        const withoutBinding = await assessTierRisk(2, presented, tokenRow, stub(true, false));
        const withBinding = await assessTierRisk(2, presented, tokenRow, { ...stub(true, false), isBindingRequired: () => true });

        assert.deepEqual(withBinding, withoutBinding);
    });

    test('tier 3: fingerprint mismatch alone stays under the step-up threshold', async () => {
        // Deliberately advisory — a device fingerprint is noisy enough that on
        // its own it should inform a decision, not force a challenge.
        assert.ok(FINGERPRINT_MISMATCH_RISK < STEP_UP_RISK_THRESHOLD);
        assert.deepEqual(await assessTierRisk(3, presented, tokenRow, stub(false, true)), { ok: true, riskScore: FINGERPRINT_MISMATCH_RISK });
        assert.deepEqual(await assessTierRisk(3, presented, tokenRow, stub(true, true)), { ok: true, riskScore: 0 });
    });

    test('tier 4: an IP mismatch alone now demands step-up; fingerprint alone still does not', async () => {
        assert.deepEqual(await assessTierRisk(4, presented, tokenRow, stub(true, true)), { ok: true, riskScore: 0 });

        assert.deepEqual(await assessTierRisk(4, presented, tokenRow, stub(false, true)), { ok: true, riskScore: FINGERPRINT_MISMATCH_RISK });

        assert.deepEqual(await assessTierRisk(4, presented, tokenRow, stub(true, false)), {
            ok: false,
            stepUpRequired: true,
            riskScore: IP_MISMATCH_RISK
        });

        const both = await assessTierRisk(4, presented, tokenRow, stub(false, false));
        assert.deepEqual(both, {
            ok: false,
            stepUpRequired: true,
            riskScore: FINGERPRINT_MISMATCH_RISK + IP_MISMATCH_RISK
        });
        assert.ok(both.riskScore >= STEP_UP_RISK_THRESHOLD);
    });

    test('tier 4 escalation is unaffected by the binding mode', async () => {
        const result = await assessTierRisk(4, presented, tokenRow, { ...stub(false, false), isBindingRequired: () => true });
        assert.equal(result.stepUpRequired, true);
        assert.equal(result.riskScore, FINGERPRINT_MISMATCH_RISK + IP_MISMATCH_RISK);
    });
});
