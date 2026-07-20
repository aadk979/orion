import { startAuthentication } from '../../../External-Scripts/webAuthn.js';
import { orionVault } from '../../../Utils/OrionVault.js';

async function signInWithPasskey({ Api, getAuthHeader, This, email }) {
    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/generate-passkey-authentication-options`, 'POST', authHeader.authHead, {
        packet: { email: email }
    });

    const data = await res.json();
    if (data.error) return { error: true, errorCode: 'CLIENT-PASSKEY-AUTH-OPTIONS-FAILED' };

    const passkeyAuthentication = await startAuthentication({ optionsJSON: data.data.options });

    const payload = {
        packet: { authenticationResponse: passkeyAuthentication, email: email }
    };

    const finalRes = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/sign-in-with-passkey-authentication`, 'POST', authHeader.authHead, payload);

    const data2 = await finalRes.json();

    if (data2.error) return { error: true, errorCode: 'CLIENT-UNABLE-TO-AUTHENTICATE-PASSKEY' };

    await orionVault.setItem('USER_EMAIL', email);

    This.setUserSignedInState(true);

    return { error: false, complete: true };
}

export { signInWithPasskey };
