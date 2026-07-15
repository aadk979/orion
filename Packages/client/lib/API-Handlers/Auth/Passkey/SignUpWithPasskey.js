import { startRegistration } from '../../../External-Scripts/webAuthn.js';

async function signUpWithPasskey({ Api, getAuthHeader, This, email }) {
    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    // Step 1: Request registration options for the new account
    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/generate-passkey-sign-up-options`,
        'POST',
        authHeader.authHead,
        { packet: { email: email } }
    );

    const data = await res.json();
    if (data.error) return { error: true, errorCode: data.errorData?.errorCode || 'CLIENT-PASSKEY-SIGN-UP-OPTIONS-FAILED' };

    // Step 2: Perform WebAuthn registration ceremony
    const passkeyRegistration = await startRegistration({ optionsJSON: data.data.options });

    const payload = {
        packet: { registrationResponse: passkeyRegistration, email: email }
    };

    const finalRes = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/complete-passkey-sign-up`,
        'POST',
        authHeader.authHead,
        payload
    );

    const data2 = await finalRes.json();

    if (data2.error) return { error: true, errorCode: data2.errorData?.errorCode || 'CLIENT-UNABLE-TO-SIGN-UP-WITH-PASSKEY' };

    return { error: false, accountCreated: true };
}

export { signUpWithPasskey };
