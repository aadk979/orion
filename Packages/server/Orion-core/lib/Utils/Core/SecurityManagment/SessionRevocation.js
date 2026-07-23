/**
 * User-facing session management endpoints, built on TokenManagement/TokenRevocation.js:
 *
 *   request/active-sessions    — list this user's live sessions (grouped by link code)
 *   action/revoke-session      — revoke one session by tokenId OR link code
 *   action/revoke-all-sessions — revoke everything, optionally sparing the current session
 *
 * All three require an authenticated access token; ownership is enforced by
 * scoping every revocation to request.user.uid. When a revocation kills the
 * session that issued the request, the session cookies are cleared in the
 * response and currentSessionRevoked: true tells the client SDK to tear down
 * its local auth state.
 */
import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { clearManagedCookie } from '../../CookieUtils.js';
import {
    revokeTokenById,
    revokeTokensByLinkCode,
    revokeAllTokensForUser,
    revokeStatelessToken,
    listActiveTokenSessions
} from '../TokenManagement/TokenRevocation.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel } from '../../Databases/models/index.js';

// Tier 2-4 payloads carry the link code inside tokenData; tier 1 carries it flat.
const currentSessionRefs = user => ({
    linkCode: user?.tokenData?.accessTokenLinkCode || user?.accessTokenLinkCode || null,
    tokenId: user?.tokenData?.tokenId || null
});

const clearSessionCookies = response => {
    clearManagedCookie(response, 'ACCESS_TOKEN');
    clearManagedCookie(response, 'REFRESH_TOKEN');
};

const routeHandlerListActiveSessions = async (request, response) => {
    const result = await listActiveTokenSessions(request.user.uid);

    if (result.error) return respondWithError(response, result.errorCode);

    const { linkCode: currentLinkCode } = currentSessionRefs(request.user);

    const sessions = result.sessions.map(session => ({
        ...session,
        current: session.linkCode !== null && session.linkCode === currentLinkCode
    }));

    return respondWithSuccess(response, 200, { sessions });
};

const routeHandlerRevokeSession = async (request, response) => {
    // Schema enforces exactly one of tokenId / linkCode
    const { tokenId, linkCode } = request.body.packet;
    const uid = request.user.uid;

    const options = { uid, revokedBy: uid, reason: 'user-initiated session revocation' };

    // At tier 1 there is no row to delete, so a targeted revoke goes to the jti
    // denylist instead. Only the caller's OWN token can be revoked this way —
    // the jti is read from the validated session, never from the request body,
    // so this cannot be pointed at someone else's token.
    if (globalAccessPoint.tokenSecurityTier() === 1) {
        const ownJti = request.user?.jti;

        if (!ownJti) {
            return respondWithError(response, 'TOKEN-REVOCATION::STATELESS-TIER::A::p');
        }

        const statelessResult = await revokeStatelessToken(ownJti, options);

        if (statelessResult.error) return respondWithError(response, statelessResult.errorCode);

        clearSessionCookies(response);

        return respondWithSuccess(response, 200, { revokedCount: statelessResult.revokedCount, currentSessionRevoked: true });
    }

    const result = tokenId ? await revokeTokenById(tokenId, options) : await revokeTokensByLinkCode(linkCode, options);

    if (result.error) return respondWithError(response, result.errorCode);

    const current = currentSessionRefs(request.user);
    const currentSessionRevoked = result.revokedTokens.some(
        token => (current.linkCode && token.linkCode === current.linkCode) || (current.tokenId && token.tokenId === current.tokenId)
    );

    if (currentSessionRevoked) clearSessionCookies(response);

    return respondWithSuccess(response, 200, { revokedCount: result.revokedCount, currentSessionRevoked });
};

const routeHandlerRevokeAllSessions = async (request, response) => {
    const { keepCurrent = true } = request.body.packet;
    const uid = request.user.uid;

    const current = currentSessionRefs(request.user);
    const exceptLinkCodes = keepCurrent && current.linkCode ? [current.linkCode] : null;

    // Tier 1 has no rows, but bulk revocation does not need them: moving the
    // account's sessions_valid_from watermark kills every token issued before
    // now, which is exactly "sign out everywhere". keepCurrent cannot be honoured
    // at this tier — the watermark is account-wide — so the caller's own session
    // ends too, and the response says so.
    if (globalAccessPoint.tokenSecurityTier() === 1) {
        await UserModel.invalidateSessionsNow(uid);
        clearSessionCookies(response);

        return respondWithSuccess(response, 200, { revokedCount: null, currentSessionRevoked: true });
    }

    const result = await revokeAllTokensForUser(uid, {
        exceptLinkCodes,
        revokedBy: uid,
        reason: keepCurrent ? 'user-initiated revoke-all (kept current session)' : 'user-initiated revoke-all'
    });

    if (result.error) return respondWithError(response, result.errorCode);

    // Without a link code to spare, keepCurrent could not be honored — treat as revoked
    const currentSessionRevoked = !keepCurrent || !current.linkCode;

    if (currentSessionRevoked) clearSessionCookies(response);

    return respondWithSuccess(response, 200, { revokedCount: result.revokedCount, currentSessionRevoked });
};

export { routeHandlerListActiveSessions, routeHandlerRevokeSession, routeHandlerRevokeAllSessions };
