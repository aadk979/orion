/**
 * CAEP — Continuous Access Evaluation Profile (OpenID Foundation), carried as
 * RFC 8417 Security Event Tokens.
 *
 * THE PROBLEM THIS SOLVES
 *
 * Access tokens are valid until they expire. That is the whole bargain of
 * stateless auth, and it means a fifteen-minute access token remains usable for
 * up to fifteen minutes after the user was disabled, changed their password, or
 * had their session revoked. Orion already closes that gap *for itself* — the
 * `sessions_valid_from` watermark and the token rows are re-read on every
 * validation — but it had no way to tell anyone ELSE. A downstream service
 * holding a token minted by this issuer kept honouring it.
 *
 * CAEP is the standard answer: the issuer transmits the fact that something
 * changed, receivers apply it immediately, and access evaluation becomes
 * continuous rather than a decision frozen at issuance.
 *
 * WHAT ORION EMITS
 *
 * Each of these maps onto something the framework already does, which is why
 * they are worth emitting rather than inventing a bespoke webhook:
 *
 *   session-revoked        ← revokeTokenById / ByLinkCode / AllTokensForUser,
 *                            revokeStatelessToken, sign-out
 *   credential-change      ← password reset, passkey add/remove, TOTP enrol/remove
 *   token-claims-change    ← role change (the claim downstream authorization reads)
 *   assurance-level-change ← step-up completed, or a session dropped back down
 *   device-compliance-change ← device authorization granted or withdrawn
 *
 * SUBJECT SEMANTICS
 *
 * `subject` identifies WHO or WHAT the event is about, using RFC 9493 Subject
 * Identifiers. An account-wide event uses the `iss_sub` form; an event about one
 * session uses `opaque` carrying the session's link code. Receivers that only
 * understand account-level revocation can act on the former and ignore the
 * latter — which is why the distinction is in the subject rather than buried in
 * the payload.
 */
import { issSubSubject, opaqueSubject, isValidSubject } from './SecurityEventToken.js';

const CAEP_BASE = 'https://schemas.openid.net/secevent/caep/event-type';

const CaepEventTypes = {
    SESSION_REVOKED: `${CAEP_BASE}/session-revoked`,
    TOKEN_CLAIMS_CHANGE: `${CAEP_BASE}/token-claims-change`,
    CREDENTIAL_CHANGE: `${CAEP_BASE}/credential-change`,
    ASSURANCE_LEVEL_CHANGE: `${CAEP_BASE}/assurance-level-change`,
    DEVICE_COMPLIANCE_CHANGE: `${CAEP_BASE}/device-compliance-change`
};

/** Every event type this transmitter is prepared to send. */
const SUPPORTED_EVENT_TYPES = Object.values(CaepEventTypes);

/** CAEP credential-change `credential_type` values Orion can report. */
const CredentialTypes = {
    PASSWORD: 'password',
    PASSKEY: 'fido2-platform',
    TOTP: 'totp',
    OTP: 'one-time-password'
};

/** CAEP credential-change `change_type` values. */
const ChangeTypes = {
    CREATE: 'create',
    REVOKE: 'revoke',
    UPDATE: 'update',
    DELETE: 'delete'
};

/**
 * Common envelope for every CAEP event payload.
 *
 * `event_timestamp` is when the thing HAPPENED, which is not the same as the
 * SET's `iat` (when it was transmitted) — they diverge whenever delivery is
 * retried, and a receiver ordering events by transmission time rather than
 * occurrence time will apply them out of order.
 */
const baseEvent = ({ subject, eventTimestamp, initiatingEntity, reason }) => {
    if (!isValidSubject(subject)) {
        throw new Error('CAEP: event subject is not a valid RFC 9493 Subject Identifier');
    }

    return {
        subject,
        event_timestamp: eventTimestamp ?? Math.floor(Date.now() / 1000),
        ...(initiatingEntity ? { initiating_entity: initiatingEntity } : {}),
        ...(reason ? { reason_admin: { en: reason } } : {})
    };
};

/**
 * Sessions for this subject are no longer valid.
 *
 * @param {object} params
 * @param {string} params.issuer  this transmitter's identifier
 * @param {string} [params.uid]   account-wide revocation
 * @param {string} [params.linkCode] one session, when scoped to a single device
 */
const sessionRevoked = ({ issuer, uid = null, linkCode = null, reason = null, initiatingEntity = 'admin', eventTimestamp = null }) => {
    const subject = linkCode ? opaqueSubject(linkCode) : issSubSubject(issuer, uid);

    return {
        [CaepEventTypes.SESSION_REVOKED]: baseEvent({ subject, eventTimestamp, initiatingEntity, reason })
    };
};

/**
 * A credential was added, changed or removed.
 *
 * Distinct from session-revoked on purpose: a password change may or may not
 * end existing sessions depending on policy, and a receiver may want to force
 * re-authentication on credential change even where the issuer chose not to.
 */
const credentialChange = ({
    issuer,
    uid,
    credentialType,
    changeType,
    friendlyName = null,
    reason = null,
    initiatingEntity = 'user',
    eventTimestamp = null
}) => ({
    [CaepEventTypes.CREDENTIAL_CHANGE]: {
        ...baseEvent({ subject: issSubSubject(issuer, uid), eventTimestamp, initiatingEntity, reason }),
        credential_type: credentialType,
        change_type: changeType,
        ...(friendlyName ? { friendly_name: friendlyName } : {})
    }
});

/**
 * A claim downstream authorization depends on has changed — in practice `role`.
 *
 * Without this, a demoted user keeps the privileges of their old role at every
 * receiver until their token expires, because the token itself still says so.
 */
const tokenClaimsChange = ({ issuer, uid, claims, reason = null, initiatingEntity = 'admin', eventTimestamp = null }) => ({
    [CaepEventTypes.TOKEN_CLAIMS_CHANGE]: {
        ...baseEvent({ subject: issSubSubject(issuer, uid), eventTimestamp, initiatingEntity, reason }),
        claims
    }
});

/**
 * The authentication assurance of a session moved.
 *
 * `namespace` is the vocabulary the levels are drawn from; `current_level` and
 * `previous_level` use NIST SP 800-63R3 AAL names, which is what `nist-aal`
 * denotes. Step-up raises it; a session that falls back to a single factor
 * lowers it, and `change_direction` says which happened so a receiver does not
 * have to compare strings it may not know the ordering of.
 */
const assuranceLevelChange = ({
    issuer,
    uid,
    currentLevel,
    previousLevel = null,
    changeDirection = 'increase',
    reason = null,
    initiatingEntity = 'user',
    eventTimestamp = null
}) => ({
    [CaepEventTypes.ASSURANCE_LEVEL_CHANGE]: {
        ...baseEvent({ subject: issSubSubject(issuer, uid), eventTimestamp, initiatingEntity, reason }),
        namespace: 'nist-aal',
        current_level: currentLevel,
        ...(previousLevel ? { previous_level: previousLevel } : {}),
        change_direction: changeDirection
    }
});

/**
 * A device moved in or out of compliance — in Orion terms, device authorization
 * granted or withdrawn.
 */
const deviceComplianceChange = ({
    issuer,
    uid,
    deviceId,
    currentStatus,
    previousStatus = null,
    reason = null,
    initiatingEntity = 'policy',
    eventTimestamp = null
}) => ({
    [CaepEventTypes.DEVICE_COMPLIANCE_CHANGE]: {
        ...baseEvent({ subject: issSubSubject(issuer, uid), eventTimestamp, initiatingEntity, reason }),
        ...(deviceId ? { device_id: deviceId } : {}),
        current_status: currentStatus,
        ...(previousStatus ? { previous_status: previousStatus } : {})
    }
});

export {
    CaepEventTypes,
    CredentialTypes,
    ChangeTypes,
    SUPPORTED_EVENT_TYPES,
    sessionRevoked,
    credentialChange,
    tokenClaimsChange,
    assuranceLevelChange,
    deviceComplianceChange
};
