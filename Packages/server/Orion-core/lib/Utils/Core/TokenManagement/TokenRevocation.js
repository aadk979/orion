/**
 * Granular token revocation.
 *
 * Revocation for the stateful tiers (2-4) works by deleting the token rows —
 * the mirrored validation pipeline in internals/sessionTokenCore.js re-reads
 * the row on every request, so a revoked token fails its next use with
 * TOKEN-*::TOKEN-ID-NOT-FOUND::A::p. That code is flagged logout: true in the
 * error registry, which makes respondWithError clear the session cookies and
 * emit the orion-session-logout header the client SDK reacts to.
 *
 * Tier 1 tokens persist nothing, so the row-deletion scopes below cannot act on
 * them and still refuse (TOKEN-REVOCATION::STATELESS-TIER::A::p). They are not
 * unrevocable, though — two mechanisms cover them:
 *
 *   - BULK revocation (password change, role change, disable, sign-out-everywhere)
 *     is expressed as the account's users.sessions_valid_from watermark, checked
 *     on every validation regardless of tier. No per-token state required.
 *   - TARGETED revocation ("sign out this one device") uses revokeStatelessToken,
 *     which puts the token's jti on a short-lived denylist.
 *
 * Four revocation scopes, all owner-scopable and filterable:
 *   revokeTokenById        — one token row
 *   revokeTokensByLinkCode — a session pair (access + refresh share link_code)
 *   revokeAllTokensForUser — everything for a uid, minus optional exceptions
 *   revokeStatelessToken   — one tier-1 token, by jti
 */
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { TokenModel } from '../../Databases/models/index.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { recordTokenEvent } from './internals/tokenAudit.js';
import { revokeJti } from './internals/jtiDenylist.js';
import { parseDuration } from '../../Date&Time.js';
import { ssfTransmitter } from '../SharedSignals/SsfTransmitter.js';
import { sessionRevoked, CaepEventTypes } from '../SharedSignals/CaepEvents.js';

const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'TokenRevocation.js');
const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'TokenRevocation.js');

const SESSION_TOKEN_TYPES = ['ACCESS_TOKEN', 'REFRESH_TOKEN'];

const toRevokedRef = row => ({ tokenId: row.token_id, uid: row.user_uid, type: row.type, linkCode: row.link_code });

const statelessTierRefusal = () => {
    if (globalAccessPoint.tokenSecurityTier() === 1) {
        return { error: true, errorCode: 'TOKEN-REVOCATION::STATELESS-TIER::A::p' };
    }
    return null;
};

/**
 * Revokes a single stateless (tier-1) token by its jti.
 *
 * Tier 1 stores nothing, so there is no row to delete — the id goes on a
 * short-lived denylist that validation consults instead. This is what makes
 * targeted "sign out this device" work at tier 1; bulk revocation (password
 * change, disable, sign-out-everywhere) is handled by the account's
 * sessions_valid_from watermark and needs no per-token state at all.
 *
 * @param {string} jti
 * @param {object} [options]
 * @param {number} [options.ttlSeconds] remaining lifetime; defaults to the
 *   configured access-token lifespan, which is the longest a tier-1 token lives
 * @param {string} [options.uid]
 * @param {string} [options.reason]
 * @param {string} [options.revokedBy]
 */
async function revokeStatelessToken(jti, { ttlSeconds = null, uid = null, reason = 'unspecified', revokedBy = null, ip = null } = {}) {
    if (!jti) return { error: true, errorCode: 'TOKEN-REVOCATION::INVALID-TARGET::A::p' };

    const lifespan = ttlSeconds ?? Math.ceil(parseDuration(systemConfigModule.getModule().tokens?.lifespans?.accessTokens || '15m') / 1000);

    await revokeJti(jti, lifespan);

    // Tier 1 has no row and no link code, so the account is the only subject
    // that can be named — a receiver cannot act on a jti it has never seen.
    if (uid) {
        const issuer = globalAccessPoint.getValue('ssfIssuer');
        if (issuer) {
            ssfTransmitter.emitDetached(CaepEventTypes.SESSION_REVOKED, sessionRevoked({ issuer, uid, reason }), { txn: `revoke-jti-${jti}` });
        }
    }

    auditRevocation({
        functionName: 'revokeStatelessToken',
        status: 'SUCCESS',
        impact: `Revoked stateless token ${jti}`,
        uid,
        ip,
        metadata: { reason, revokedBy, target: `jti ${jti}`, ttlSeconds: lifespan }
    });

    return { error: false, revokedCount: 1, revokedTokens: [{ tokenId: jti, uid, type: 'STATELESS', linkCode: null }] };
}

/**
 * Transmits a CAEP session-revoked event for a completed revocation.
 *
 * Detached on purpose. A revocation that succeeded locally is a success even if
 * no receiver could be reached — the session IS dead here, and turning a
 * delivery problem into a revocation failure would leave the caller believing
 * the opposite of the truth. Delivery durability is the transmitter's problem
 * (it retries), not this call site's.
 *
 * Emitted per distinct session where the revocation was session-scoped, and
 * once account-wide otherwise, so a receiver that only tracks whole accounts
 * and one that tracks individual sessions both get something actionable.
 */
const emitRevocationSignal = ({ uid, revokedTokens, reason, accountWide }) => {
    const issuer = globalAccessPoint.getValue('ssfIssuer');
    if (!issuer) return;

    if (accountWide && uid) {
        ssfTransmitter.emitDetached(CaepEventTypes.SESSION_REVOKED, sessionRevoked({ issuer, uid, reason }), { txn: `revoke-all-${uid}` });
        return;
    }

    const linkCodes = [...new Set((revokedTokens || []).map(t => t.linkCode).filter(Boolean))];

    for (const linkCode of linkCodes) {
        ssfTransmitter.emitDetached(CaepEventTypes.SESSION_REVOKED, sessionRevoked({ issuer, linkCode, reason }), { txn: `revoke-${linkCode}` });
    }

    // A revoked token with no link code cannot be named as a session, so the
    // account-level statement is the only true thing we can say about it.
    if (linkCodes.length === 0 && uid) {
        ssfTransmitter.emitDetached(CaepEventTypes.SESSION_REVOKED, sessionRevoked({ issuer, uid, reason }), { txn: `revoke-${uid}` });
    }
};

const auditRevocation = ({ functionName, status, impact, uid, ip, metadata, errorCode }) => {
    const requestMetadata = requestContext.getStore();

    recordTokenEvent(auditTrailSystemModule, {
        source: 'TokenRevocation.js',
        functionName,
        ip: ip || requestMetadata?.ip,
        user: { uid },
        device: { userAgent: requestMetadata?.userAgent },
        action: status === 'SUCCESS' ? 'TOKEN_REVOCATION_SUCCESS' : 'TOKEN_REVOCATION_ATTEMPT',
        status,
        impact,
        metadata,
        errorCode
    });
};

/**
 * Shared execution path: run the filtered delete, audit, shape the result.
 * `target` is only used for audit/error texts; `requireMatch` controls whether
 * zero deletions is NOT-FOUND (targeted revokes) or a valid no-op (revoke-all).
 */
async function executeRevocation({ functionName, filters, uid, reason, revokedBy, ip, target, requireMatch, accountWide = false }) {
    try {
        const deletedRows = await TokenModel.deleteTokensWhere(filters);

        if (requireMatch && deletedRows.length === 0) {
            auditRevocation({
                functionName,
                status: 'FAILED',
                impact: `Token revocation matched nothing — ${target}`,
                uid,
                ip,
                metadata: { reason, revokedBy, target },
                errorCode: 'TOKEN-REVOCATION::NOT-FOUND::A::p'
            });
            return { error: true, errorCode: 'TOKEN-REVOCATION::NOT-FOUND::A::p' };
        }

        const revokedTokens = deletedRows.map(toRevokedRef);

        auditRevocation({
            functionName,
            status: 'SUCCESS',
            impact: `Revoked ${revokedTokens.length} token(s) — ${target}`,
            uid,
            ip,
            metadata: { reason, revokedBy, target, revokedCount: revokedTokens.length, revokedTokenIds: revokedTokens.map(t => t.tokenId) }
        });

        if (revokedTokens.length > 0) {
            emitRevocationSignal({ uid: uid || revokedTokens[0]?.uid, revokedTokens, reason, accountWide });
        }

        return { error: false, revokedCount: revokedTokens.length, revokedTokens };
    } catch (e) {
        auditRevocation({
            functionName,
            status: 'FAILED',
            impact: `Token revocation failed — ${e.message}`,
            uid,
            ip,
            metadata: { reason, revokedBy, target },
            errorCode: 'TOKEN-REVOCATION::FAILED::A::i'
        });
        return { error: true, errorCode: 'TOKEN-REVOCATION::FAILED::A::i' };
    }
}

/**
 * Revoke a single token by its tokenId.
 *
 * @param {string} tokenId
 * @param {object} [options]
 * @param {string} [options.uid]       scope to this owner — a tokenId belonging to
 *                                     anyone else becomes NOT-FOUND (always pass it
 *                                     for user-initiated revocation)
 * @param {string} [options.reason]    audit-trail reason
 * @param {string} [options.revokedBy] uid/actor performing the revocation
 * @param {string} [options.ip]        override for non-request contexts
 */
async function revokeTokenById(tokenId, { uid = null, reason = 'unspecified', revokedBy = null, ip = null } = {}) {
    const refusal = statelessTierRefusal();
    if (refusal) return refusal;

    if (!tokenId) return { error: true, errorCode: 'TOKEN-REVOCATION::INVALID-TARGET::A::p' };

    return executeRevocation({
        functionName: 'revokeTokenById',
        filters: { tokenId, uid },
        uid,
        reason,
        revokedBy,
        ip,
        target: `tokenId ${tokenId}`,
        requireMatch: true
    });
}

/**
 * Revoke every token carrying an access-token link code — i.e. one whole
 * session (the access token and the refresh token minted alongside it).
 *
 * @param {string} linkCode
 * @param {object} [options]
 * @param {string} [options.uid]     scope to this owner
 * @param {string[]} [options.types] restrict to specific token types
 * @param {string} [options.reason]
 * @param {string} [options.revokedBy]
 * @param {string} [options.ip]
 */
async function revokeTokensByLinkCode(linkCode, { uid = null, types = null, reason = 'unspecified', revokedBy = null, ip = null } = {}) {
    const refusal = statelessTierRefusal();
    if (refusal) return refusal;

    if (!linkCode) return { error: true, errorCode: 'TOKEN-REVOCATION::INVALID-TARGET::A::p' };

    return executeRevocation({
        functionName: 'revokeTokensByLinkCode',
        filters: { linkCode, uid, types },
        uid,
        reason,
        revokedBy,
        ip,
        target: `linkCode ${linkCode}`,
        requireMatch: true
    });
}

/**
 * Revoke all of a user's tokens, with granular carve-outs. Zero matches is a
 * valid outcome (nothing was active), not an error.
 *
 * @param {string} uid
 * @param {object} [options]
 * @param {string[]} [options.types]            defaults to session tokens
 *                                              (ACCESS_TOKEN + REFRESH_TOKEN);
 *                                              pass null for every type
 * @param {string[]} [options.exceptTokenIds]   tokens to spare
 * @param {string[]} [options.exceptLinkCodes]  sessions to spare (e.g. the caller's
 *                                              own session for a "sign out everywhere
 *                                              else" experience)
 * @param {string} [options.reason]
 * @param {string} [options.revokedBy]
 * @param {string} [options.ip]
 */
async function revokeAllTokensForUser(
    uid,
    { types = SESSION_TOKEN_TYPES, exceptTokenIds = null, exceptLinkCodes = null, reason = 'unspecified', revokedBy = null, ip = null } = {}
) {
    const refusal = statelessTierRefusal();
    if (refusal) return refusal;

    if (!uid) return { error: true, errorCode: 'TOKEN-REVOCATION::INVALID-TARGET::A::p' };

    return executeRevocation({
        functionName: 'revokeAllTokensForUser',
        filters: { uid, types, exceptTokenIds, exceptLinkCodes },
        uid,
        reason,
        revokedBy,
        ip,
        target: `all tokens for uid ${uid}`,
        requireMatch: false,
        // One account-wide statement rather than one per session: the fact worth
        // transmitting is that this user's sessions are over.
        accountWide: true
    });
}

/**
 * Active session view for a user: non-expired session token rows grouped by
 * link code, so an access/refresh pair reads as one session. Rows without a
 * link code stand alone under their tokenId.
 */
async function listActiveTokenSessions(uid) {
    const refusal = statelessTierRefusal();
    if (refusal) return refusal;

    if (!uid) return { error: true, errorCode: 'TOKEN-REVOCATION::INVALID-TARGET::A::p' };

    try {
        const rows = await TokenModel.getActiveTokens(uid);

        const sessions = new Map();
        for (const row of rows) {
            if (!SESSION_TOKEN_TYPES.includes(row.type)) continue;

            const key = row.link_code || row.token_id;
            if (!sessions.has(key)) {
                sessions.set(key, {
                    linkCode: row.link_code,
                    userAgent: row.user_agent,
                    securityTier: row.security_tier,
                    createdAt: row.created_at,
                    tokens: []
                });
            }
            sessions.get(key).tokens.push({ tokenId: row.token_id, type: row.type, expiry: row.expiry });
        }

        return { error: false, sessions: [...sessions.values()] };
    } catch (e) {
        return { error: true, errorCode: 'TOKEN-REVOCATION::FAILED::A::i' };
    }
}

export { revokeTokenById, revokeTokensByLinkCode, revokeAllTokensForUser, revokeStatelessToken, listActiveTokenSessions, SESSION_TOKEN_TYPES };
