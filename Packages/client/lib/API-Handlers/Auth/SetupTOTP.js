async function setupTOTP({ Api, getAuthHeader, dipConfig, This }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/generate-totp-secret`,
        'POST',
        authHeader.authHead,
        {},
        null,
        null
    );

    const data = await res.json();

    if (data.error) return { error: true, errorCode: 'CLIENT-TOTP-SETUP-FAILED' };

    return { error: false, secret: data.data.secret, uri: data.data.uri };
}

async function verifyAndEnableTOTP({ Api, getAuthHeader, dipConfig, This, totpCode }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const encryptedPayload = await Api.prepareDataForEncryption({ totpCode });

    const postEncryptionPayload = {
        packet: { encryptedString: encryptedPayload.encryptedString }
    };

    const dipSignature = await Api.prepareDataForDIP(postEncryptionPayload, dipConfig);

    const dipOptions = {
        ...dipConfig,
        dipState: 'ACTIVE',
        dipSignature: dipSignature.dipSignature,
        salt: dipSignature.salt,
        timestamp: dipSignature.timestamp
    };

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/verify-and-enable-totp`,
        'POST',
        authHeader.authHead,
        postEncryptionPayload,
        dipOptions,
        encryptedPayload.encryption
    );

    const data = await res.json();

    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-TOTP-VERIFY-FAILED' };

    return { error: false, complete: true };
}

export { setupTOTP, verifyAndEnableTOTP };
