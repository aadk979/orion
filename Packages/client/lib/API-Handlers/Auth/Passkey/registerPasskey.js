import { startRegistration } from '../../../External-Scripts/webAuthn.js';

async function registerPasskey({ Api, getAuthHeader, This }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/generate-passkey-registration-options`, 'POST', authHeader.authHead, {});

    const data = await res.json();

    if (data.error) return { error: true, errorCode: 'CLIENT-PASSKEY-REG-OPTIONS-FAILED' };

    const passkeyRegistration = await startRegistration({ optionsJSON: data.data.options });

    const payload = {
        packet: { registrationResponse: passkeyRegistration }
    };

    const finalRes = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/complete-passkey-registration`, 'POST', authHeader.authHead, payload);

    const data2 = await finalRes.json();
    if (data2.error) return { error: true, errorCode: 'CLIENT-UNABLE-TO-REGISTER-PASSKEY' };

    return { error: false, complete: true };
}

export { registerPasskey };
