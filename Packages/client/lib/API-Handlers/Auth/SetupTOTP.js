async function setupTOTP({ Api, getAuthHeader, This }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/generate-totp-secret`,
        'POST',
        authHeader.authHead,
        {}
    );

    const data = await res.json();

    if (data.error) return { error: true, errorCode: 'CLIENT-TOTP-SETUP-FAILED' };

    return { error: false, qrCode: data.data.qrCode, secret: data.data.secret };
}

async function verifyAndEnableTOTP({ Api, getAuthHeader, This, totpCode }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const payload = {
        packet: { totpCode }
    };

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/verify-and-enable-totp`,
        'POST',
        authHeader.authHead,
        payload
    );

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-TOTP-VERIFY-FAILED' };

    return { error: false, complete: true };
}

export { setupTOTP, verifyAndEnableTOTP };
