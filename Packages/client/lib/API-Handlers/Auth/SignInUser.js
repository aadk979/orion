import { sanitizeInput, isValidEmail } from '../../Utils/Utils.js';

async function signInUser({ Api, orionVault, email, password, getAuthHeader, This }) {
    if (!email || !password) return { error: true, errorCode: 'CLIENT-MISSING-DATA' };

    const cleanedEmail = sanitizeInput(email);
    const cleanedPassword = sanitizeInput(password);

    if (!isValidEmail(cleanedEmail)) return { error: true, errorCode: 'CLIENT-INVALID-EMAIL' };
    if (cleanedPassword.length < 8) return { error: true, errorCode: 'CLIENT-PASSWORD-TOO-SHORT' };

    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    const payload = {
        packet: { email: cleanedEmail, password: cleanedPassword }
    };

    const request = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/sign-in-user`, 'POST', authHeader.authHead, payload);

    const data = await request.json();
    if (data.error) return data.errorData;

    await orionVault.setItem('USER_EMAIL', cleanedEmail);

    This.setUserSignedInState(true);

    return { error: false, complete: true };
}

export { signInUser };
