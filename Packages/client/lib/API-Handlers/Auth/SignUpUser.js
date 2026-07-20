import { sanitizeInput, isValidEmail, checkPasswordStrength } from '../../Utils/Utils.js';

async function signUpUser({ Api, email, password, getAuthHeader, This }) {
    if (!email || !password) return { error: true, errorCode: 'CLIENT-MISSING-DATA' };

    const cleanedEmail = sanitizeInput(email);
    const cleanedPassword = sanitizeInput(password);

    if (!isValidEmail(cleanedEmail)) return { error: true, errorCode: 'CLIENT-INVALID-EMAIL' };
    if (cleanedPassword.length < 8) return { error: true, errorCode: 'CLIENT-PASSWORD-TOO-SHORT' };

    const strength = checkPasswordStrength(cleanedPassword);
    if (strength === 'Weak' || strength === 'Too Short') return { error: true, errorCode: 'CLIENT-PASSWORD-TOO-WEAK' };

    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    const payload = {
        packet: { email: cleanedEmail, password: cleanedPassword }
    };

    const request = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/sign-up-user`, 'POST', authHeader.authHead, payload);

    const data = await request.json();
    if (data.error) return data.errorData;

    return { error: false, complete: data.data.completed };
}

export { signUpUser };
