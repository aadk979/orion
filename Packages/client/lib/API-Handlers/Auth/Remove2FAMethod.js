async function initiate2FAMethodRemoval({ Api, getAuthHeader, This, method }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const payload = {
        packet: { method }
    };

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/initiate-2fa-method-removal`, 'POST', authHeader.authHead, payload);

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-2FA-REMOVAL-INITIATE-FAILED' };

    return { error: false, sent: true };
}

async function complete2FAMethodRemoval({ Api, getAuthHeader, This, code }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const payload = {
        packet: { code }
    };

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/complete-2fa-method-removal`, 'POST', authHeader.authHead, payload);

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-2FA-REMOVAL-COMPLETE-FAILED' };

    return { error: false, complete: true, method: data.data?.method };
}

export { initiate2FAMethodRemoval, complete2FAMethodRemoval };
