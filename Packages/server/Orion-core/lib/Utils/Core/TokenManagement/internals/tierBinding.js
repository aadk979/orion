/**
 * Security-tier binding logic, shared by every token kind.
 *
 * Tier semantics:
 *   1 — stateless, no client binding
 *   2 — bind to the client's IP range; a mismatch is a hard failure
 *   3 — device fingerprint recorded as an advisory risk signal
 *   4 — IP range + fingerprint combined as risk signals
 *
 * Tiers 3/4 accumulate a risk score; reaching STEP_UP_RISK_THRESHOLD demands
 * step-up auth rather than rejecting outright. (Note: tier 3's single signal
 * of 30 can never reach the threshold on its own — advisory by design.)
 */
import { digestFingerprint, verifyFingerprint } from '../../../fingerprintDigest.js';
import { getIpRange, isIpInRange } from '../../../Ip.js';

const STEP_UP_RISK_THRESHOLD = 50;
const FINGERPRINT_MISMATCH_RISK = 30;
const IP_MISMATCH_RISK = 40;

/**
 * Fields a token of the given tier must carry, split into what goes in the
 * JWT payload vs the DB row (their column-name conventions differ).
 */
async function buildTierBinding(securityTier, { fingerprint, ip }) {
    const payloadFields = {};
    const dbFields = {};

    if (securityTier === 2 || securityTier === 4) {
        const ipRange = getIpRange(ip);
        payloadFields.ipRange = ipRange;
        dbFields.ipRange = ipRange;
    }

    if (securityTier === 3 || securityTier === 4) {
        // Keyed HMAC, not bcrypt — a fingerprint is high-entropy, so the only
        // property needed is that a database reader cannot correlate it back to a
        // device. See fingerprintDigest.js.
        const hashedFingerprint = digestFingerprint(fingerprint);
        payloadFields.hashedDeviceFingerprint = hashedFingerprint;
        dbFields.hashedFingerprint = hashedFingerprint;
    }

    return { payloadFields, dbFields };
}

/**
 * Check the presented client context against a stored token row.
 * `deps` is a test seam; production callers use the defaults.
 *
 * @returns {{ok: true} | {ok: false, hardFail: true} | {ok: false, stepUpRequired: true, riskScore: number}}
 */
async function assessTierRisk(securityTier, { fingerprint, ip }, tokenRow, deps = {}) {
    const { verifyHash: verifyHashFn = verifyFingerprint, isIpInRange: isIpInRangeFn = isIpInRange } = deps;

    if (securityTier === 2) {
        const inRange = await isIpInRangeFn(ip, tokenRow.ip_range);
        return inRange ? { ok: true } : { ok: false, hardFail: true };
    }

    let riskScore = 0;

    if (securityTier === 3 || securityTier === 4) {
        if (!(await verifyHashFn(fingerprint, tokenRow.hashed_fingerprint))) {
            riskScore += FINGERPRINT_MISMATCH_RISK;
        }
    }

    if (securityTier === 4) {
        if (!(await isIpInRangeFn(ip, tokenRow.ip_range))) {
            riskScore += IP_MISMATCH_RISK;
        }
    }

    if (riskScore >= STEP_UP_RISK_THRESHOLD) {
        return { ok: false, stepUpRequired: true, riskScore };
    }

    return { ok: true };
}

export { buildTierBinding, assessTierRisk, STEP_UP_RISK_THRESHOLD, FINGERPRINT_MISMATCH_RISK, IP_MISMATCH_RISK };
