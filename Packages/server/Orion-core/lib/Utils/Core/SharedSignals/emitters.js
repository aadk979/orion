/**
 * Convenience emitters for the places in the framework where a CAEP-worthy
 * thing happens.
 *
 * These exist so call sites read as one line and cannot get the plumbing wrong.
 * Every one of them:
 *   - resolves the issuer and does nothing if Shared Signals is not configured,
 *   - never throws and never returns a rejected promise,
 *   - is fire-and-forget.
 *
 * That last property is the important one. Each is invoked from a security
 * operation that has ALREADY SUCCEEDED — the password is changed, the role is
 * updated, the factor is gone. Letting a transmission problem propagate back
 * into those flows would turn a completed action into a reported failure, and
 * the caller would be told the opposite of what is true in the database.
 */
import { logger } from '../../logger.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { ssfTransmitter } from './SsfTransmitter.js';
import { CaepEventTypes, CredentialTypes, ChangeTypes, credentialChange, tokenClaimsChange, assuranceLevelChange, deviceComplianceChange, sessionRevoked } from './CaepEvents.js';

const issuer = () => {
    try {
        return globalAccessPoint.getValue('ssfIssuer');
    } catch {
        return null;
    }
};

const safely = (label, fn) => {
    try {
        const iss = issuer();
        if (!iss) return;
        fn(iss);
    } catch (e) {
        logger.warn(`SSF: could not emit ${label} — ${e.message}`);
    }
};

/** A credential was created, updated, revoked or deleted. */
const emitCredentialChange = ({ uid, credentialType, changeType, friendlyName = null, reason = null, initiatingEntity = 'user' }) =>
    safely('credential-change', iss =>
        ssfTransmitter.emitDetached(
            CaepEventTypes.CREDENTIAL_CHANGE,
            credentialChange({ issuer: iss, uid, credentialType, changeType, friendlyName, reason, initiatingEntity }),
            { txn: `cred-${uid}` }
        )
    );

/**
 * A claim downstream authorization reads has changed.
 *
 * Role is the one that matters: a receiver holding a token that still says
 * ADMIN will keep granting admin until it expires unless it is told otherwise.
 */
const emitRoleChange = ({ uid, role, reason = null, initiatingEntity = 'admin' }) =>
    safely('token-claims-change', iss =>
        ssfTransmitter.emitDetached(CaepEventTypes.TOKEN_CLAIMS_CHANGE, tokenClaimsChange({ issuer: iss, uid, claims: { role }, reason, initiatingEntity }), {
            txn: `role-${uid}`
        })
    );

/** Account disabled or enabled — disabling is a session-ending event. */
const emitAccountDisabled = ({ uid, reason = 'account disabled', initiatingEntity = 'admin' }) =>
    safely('session-revoked (disable)', iss =>
        ssfTransmitter.emitDetached(CaepEventTypes.SESSION_REVOKED, sessionRevoked({ issuer: iss, uid, reason, initiatingEntity }), { txn: `disable-${uid}` })
    );

/**
 * Authentication assurance moved — step-up raises it.
 *
 * A receiver can use this to permit an operation it was previously refusing,
 * which is the whole point of step-up being visible beyond the issuer.
 */
const emitAssuranceChange = ({ uid, currentLevel, previousLevel = null, changeDirection = 'increase', reason = null }) =>
    safely('assurance-level-change', iss =>
        ssfTransmitter.emitDetached(
            CaepEventTypes.ASSURANCE_LEVEL_CHANGE,
            assuranceLevelChange({ issuer: iss, uid, currentLevel, previousLevel, changeDirection, reason }),
            { txn: `aal-${uid}` }
        )
    );

/** A device gained or lost authorization. */
const emitDeviceCompliance = ({ uid, deviceId, currentStatus, previousStatus = null, reason = null }) =>
    safely('device-compliance-change', iss =>
        ssfTransmitter.emitDetached(
            CaepEventTypes.DEVICE_COMPLIANCE_CHANGE,
            deviceComplianceChange({ issuer: iss, uid, deviceId, currentStatus, previousStatus, reason }),
            { txn: `device-${uid}` }
        )
    );

export { emitCredentialChange, emitRoleChange, emitAccountDisabled, emitAssuranceChange, emitDeviceCompliance, CredentialTypes, ChangeTypes };
