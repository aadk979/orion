/**
 * Which error codes count as an authentication / challenge failure.
 *
 * The AbuseDetectionSystem can only block what it is told about. Rather than
 * asking every failure site to remember to call recordAuthFailure() — the
 * omission that left the detector inert — respondWithError consults this module
 * on every error response and records centrally.
 *
 * Matching is pattern-first so a NEW error code that follows the existing
 * naming convention (…::INVALID-CODE::…, …::INVALID-PASSWORD::…) is covered the
 * day it is added, with an explicit list for codes whose names do not carry the
 * signal. Bindings that merely differ (IP / user-agent / fingerprint mismatch on
 * a challenge record) are deliberately included: at the point they fire, someone
 * is presenting a challenge they were not issued.
 */

/** Substrings that mark a credential- or challenge-guessing failure. */
const FAILURE_PATTERNS = [
    'INVALID-CODE',
    'INVALID-PASSWORD',
    'INVALID-TOTP',
    'INVALID-STATE-CHALLENGE',
    'SECRET-MISMATCH',
    'CHALLENGE-MISMATCH',
    'USERAGENT-MISMATCH',
    'FINGERPRINT-MISMATCH',
    'IP-MISMATCH',
    'IP-NOT-IN-RANGE'
];

/** Codes that are failures but whose names do not match a pattern above. */
const EXPLICIT_FAILURE_CODES = new Set([
    'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p',
    'PASSKEY::ACCOUNT-NOT-FOUND::A::p',
    'PASSKEY::AUTH-FAILED::A::i',
    'AUTH::BEARER-MISMATCH::A::p',
    'AUTH::INVALID-TOKEN-TYPE::A::p',
    'TOKEN-ACCESS::VALIDATION-FAILED::A::p',
    'TOKEN-REFRESH::VALIDATION-FAILED::A::p',
    'TOKEN-RESOURCE::VALIDATION-FAILED::B::p',
    'TOKEN-ACCESS::TOKEN-ID-NOT-FOUND::A::p',
    'TOKEN-REFRESH::TOKEN-ID-NOT-FOUND::A::p'
]);

/**
 * Codes that look like failures by pattern but are NOT attacker signal — normal
 * lifecycle events that would otherwise blocklist legitimate users.
 */
const NEVER_FAILURE_CODES = new Set([
    'TOKEN-ACCESS::EXPIRED::A::p',
    'TOKEN-REFRESH::EXPIRED::A::p',
    'TOKEN-RESOURCE::EXPIRED::A::p',
    'AUTH::MISSING-TOKEN::A::p',
    'STEP-UP::REQUIRED::A::p'
]);

/**
 * @param {string} errorCode
 * @returns {boolean} true when this response should be charged to the caller as
 *   an authentication failure by the abuse detector.
 */
const isAuthFailureCode = errorCode => {
    if (typeof errorCode !== 'string' || errorCode === '') return false;
    if (NEVER_FAILURE_CODES.has(errorCode)) return false;
    if (EXPLICIT_FAILURE_CODES.has(errorCode)) return true;

    return FAILURE_PATTERNS.some(pattern => errorCode.includes(pattern));
};

export { isAuthFailureCode, FAILURE_PATTERNS, EXPLICIT_FAILURE_CODES, NEVER_FAILURE_CODES };
