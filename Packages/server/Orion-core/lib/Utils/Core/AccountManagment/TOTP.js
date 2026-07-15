import { generateSecret, verify, generateURI } from 'otplib';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';

const generateTOTPSecret = async () => {
    const Function = async () => {
        const secret = generateSecret();
        return { error: false, secret };
    };

    return await tryCatch(Function, true, {}, 'generateTOTPSecret', fileURLToPath(import.meta.url));
};

const verifyTOTPToken = async (token, secret, window = 1) => {
    const Function = async (parameters) => {
        const result = await verify({ token: parameters.token, secret: parameters.secret, window: parameters.window });

        if (result.valid) {
            return { error: false, valid: true };
        }

        return { error: true, errorCode: 'TOTP::INVALID-TOKEN::A::p' };
    };

    const parameters = { token, secret, window };
    return await tryCatch(Function, true, parameters, 'verifyTOTPToken', fileURLToPath(import.meta.url));
};

const generateTOTPAuthURI = async (secret, accountName, issuer) => {
    const Function = async (parameters) => {
        const uri = generateURI({
            label: parameters.accountName,
            issuer: parameters.issuer,
            secret: parameters.secret
        });
        return { error: false, uri };
    };

    const parameters = { secret, accountName, issuer };
    return await tryCatch(Function, true, parameters, 'generateTOTPAuthURI', fileURLToPath(import.meta.url));
};

export { generateTOTPSecret, verifyTOTPToken, generateTOTPAuthURI };