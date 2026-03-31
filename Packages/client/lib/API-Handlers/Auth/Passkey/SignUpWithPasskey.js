import { startRegistration } from '../../../External-Scripts/webAuthn.js';

async function signUpWithPasskey({ Api, getAuthHeader, dipConfig, This, email }) {
    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    // Step 1: Request registration options for the new account
    const dipSignature1 = await Api.prepareDataForDIP({ packet: { email: email } }, dipConfig);

    const dipOptions1 = {
        ...dipConfig,
        dipState: 'ACTIVE',
        dipSignature: dipSignature1.dipSignature,
        salt: dipSignature1.salt,
        timestamp: dipSignature1.timestamp
    };

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/generate-passkey-sign-up-options`,
        'POST',
        authHeader.authHead,
        { packet: { email: email } },
        dipOptions1,
        null
    );

    const data = await res.json();
    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-PASSKEY-SIGN-UP-OPTIONS-FAILED' };

    // Step 2: Perform WebAuthn registration ceremony
    const passkeyRegistration = await startRegistration({ optionsJSON: data.data.options });

    const encryptedPayload = await Api.prepareDataForEncryption({ registrationResponse: passkeyRegistration, email: email });

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

    const finalRes = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/complete-passkey-sign-up`,
        'POST',
        authHeader.authHead,
        postEncryptionPayload,
        dipOptions,
        encryptedPayload.encryption
    );

    const data2 = await finalRes.json();

    if (data2.error) return { error: true, errorCode: data2.errorData?.errorCode || 'CLIENT-UNABLE-TO-SIGN-UP-WITH-PASSKEY' };

    return { error: false, accountCreated: true };
}

export { signUpWithPasskey };
