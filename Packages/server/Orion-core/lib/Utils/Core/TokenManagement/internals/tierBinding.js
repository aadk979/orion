/**
 * Security-tier binding logic, shared by every token kind.
 *
 * Tier semantics:
 *   1 — stateless, no client binding
 *   2 — bind to the client's IP range
 *   3 — device fingerprint recorded as an advisory risk signal
 *   4 — IP range + fingerprint combined as risk signals
 *
 * Tiers 3/4 accumulate a risk score; reaching STEP_UP_RISK_THRESHOLD demands
 * step-up auth rather than rejecting outright. (Note: tier 3's single signal
 * of 30 can never reach the threshold on its own — advisory by design.)
 *
 * WHY TIER 2 IS NO LONGER AN OUTRIGHT REJECTION
 *
 * An IP range is not a credential. It is not secret, the holder of a stolen
 * token frequently shares it (carrier NAT, corporate egress, a proxy chosen
 * for exactly this reason), and it changes constantly for users who did
 * nothing wrong — mobile handoff, CGNAT rebalancing, IPv6 privacy-extension
 * rotation, dual-stack flapping. Treating it as a hard predicate therefore
 * bought very little against an attacker while regularly ejecting real users,
 * which is the profile of a control that gets configured away.
 *
 * NIST SP 800-63B is explicit that network location may inform a risk decision
 * and may not stand in for an authenticator. There is now no hard failure at
 * all: an address mismatch reaches the step-up threshold by itself, so the
 * answer to "this token arrived from somewhere it has not been before" is to
 * demand a second factor rather than to eject the session. That holds whether
 * or not DPoP is on — with it, possession of the key is already the real
 * binding and the address is corroboration; without it, step-up is a stronger
 * response than rejection, because rejection can be provoked by anyone who can
 * move a victim between networks.
 */
import { digestFingerprint, verifyFingerprint } from '../../../fingerprintDigest.js';
import { getIpRange, isIpInRange } from '../../../Ip.js';

// Threshold is 40, not 50, so a single IP mismatch reaches it.
//
// At 50 the only combination that could ever fire was tier 4's IP+fingerprint
// (70). Tier 2 topped out at 40 and tier 3 at 30, so on every deployment other
// than tier 4 the step-up subsystem — six routes, three factors, a client
// overlay — was unreachable code. Worse, tier 2 running with proof of
// possession scored its IP mismatch and then discarded the result, because 40
// fell short: the range was computed, stored, compared and thrown away.
//
// Tier 3 stays advisory at 30 by design; a device fingerprint is noisy enough
// (browser updates, extensions, canvas variance) that alone it should inform a
// decision rather than force a challenge.
const STEP_UP_RISK_THRESHOLD = 40;
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

    let riskScore = 0;

    if (securityTier === 2 || securityTier === 4) {
        if (!(await isIpInRangeFn(ip, tokenRow.ip_range))) {
            // No longer a hard failure at tier 2. It used to be, on the grounds
            // that with proof of possession off the address was the only thing
            // between a stolen token and its use — but the score now reaches the
            // step-up threshold on its own, so that case is answered by
            // demanding a second factor instead of ejecting the session. That is
            // strictly stronger against an attacker (an address is not a
            // credential and is frequently shared, per the note above) and
            // strictly kinder to the mobile-handoff/CGNAT users the hard fail
            // was throwing out.
            riskScore += IP_MISMATCH_RISK;
        }
    }

    if (securityTier === 3 || securityTier === 4) {
        if (!(await verifyHashFn(fingerprint, tokenRow.hashed_fingerprint))) {
            riskScore += FINGERPRINT_MISMATCH_RISK;
        }
    }

    if (riskScore >= STEP_UP_RISK_THRESHOLD) {
        return { ok: false, stepUpRequired: true, riskScore };
    }

    return { ok: true, riskScore };
}

export { buildTierBinding, assessTierRisk, STEP_UP_RISK_THRESHOLD, FINGERPRINT_MISMATCH_RISK, IP_MISMATCH_RISK };
