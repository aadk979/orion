import { orionVault } from '../../Utils/OrionVault.js';

// When a revocation kills the session that made the request, the server has
// already cleared the cookies — mirror it locally so the UI flips immediately.
async function teardownLocalSession(This) {
    try {
        await orionVault.deleteItem('USER_EMAIL');
    } catch (e) {
        // vault may be unavailable — losing this cleanup is fine
    }

    This.setUserSignedInState(false);
}

async function listActiveSessions({ Api, getAuthHeader, This }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/request/active-sessions`, 'POST', authHeader.authHead, {});

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-SESSION-LIST-FAILED' };

    return { error: false, sessions: data.data.sessions };
}

async function revokeSession({ Api, getAuthHeader, This, tokenId, linkCode }) {
    if (!tokenId && !linkCode) return { error: true, errorCode: 'CLIENT-MISSING-REVOCATION-TARGET' };
    if (tokenId && linkCode) return { error: true, errorCode: 'CLIENT-AMBIGUOUS-REVOCATION-TARGET' };

    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const payload = { packet: tokenId ? { tokenId } : { linkCode } };

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/revoke-session`, 'POST', authHeader.authHead, payload);

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-SESSION-REVOKE-FAILED' };

    const currentSessionRevoked = data.data?.currentSessionRevoked === true;

    if (currentSessionRevoked) await teardownLocalSession(This);

    return { error: false, revokedCount: data.data.revokedCount, currentSessionRevoked };
}

async function revokeAllSessions({ Api, getAuthHeader, This, keepCurrent = true }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const payload = { packet: { keepCurrent } };

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/revoke-all-sessions`, 'POST', authHeader.authHead, payload);

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-SESSION-REVOKE-ALL-FAILED' };

    const currentSessionRevoked = data.data?.currentSessionRevoked === true;

    if (currentSessionRevoked) await teardownLocalSession(This);

    return { error: false, revokedCount: data.data.revokedCount, currentSessionRevoked };
}

export { listActiveSessions, revokeSession, revokeAllSessions };
