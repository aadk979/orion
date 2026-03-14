import { generateRegistrationOptions } from '@simplewebauthn/server';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { sanitizeString } from '../../../Sanitizer.js';
import { tryCatch } from '../../../TryCatch.js';
import { isValidEmail } from '../../../Validator.js';
import { respondWithError, respondWithSuccess } from '../../../../Server/Response/response.js';
import { stringifyCookieData } from '../../../CookieUtils.js';
import { fileURLToPath } from 'url';

const generatePasskeyRegistrationOptionsExistingUser = async (email, clientURL) => {
    const Function = async parameters => {
        const systemConfig = globalAccessPoint.systemConfig();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY-SIGN-IN-DISABLED' };
        }

        const rpName = 'Orion';

        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            return { error: true, errorCode: 'PASSKEY-REG-INVALID-EMAIL' };
        }

        const userLink = await globalAccessPoint.db().getData('Users-email', sanitizedEmail);

        if (userLink.data === undefined) {
            return { error: true, errorCode: 'PASSKEY-ACC-NO-EXIST' };
        }

        const user = await globalAccessPoint.db().getData('Users', userLink.data.uid);

        if (user.data.credentials.passkey.exist) {
            return {
                error: true,
                errorCode: 'PASSKEY-REGISTRATION-ACTIVE-PASSKEY-DETECTED'
            };
        }

        const options = await generateRegistrationOptions({
            rpId: parameters.clientURL,
            rpName: rpName,
            userid: Uint8Array.from(user.data.credentials.uid, c => c.charCodeAt(0)),
            userName: parameters.email,
            userDisplayName: parameters.email.split('@')[0]
        });

        return {
            error: false,
            options: options,
            cookies: [
                {
                    key: 'PASSKEY-REGISTRATION-INFO-STEP-1',
                    data: {
                        uid: user.data.credentials.uid,
                        id: options.user.id,
                        email: email,
                        challenge: options.challenge
                    },
                    maxAge: 30 * 1000
                }
            ]
        };
    };

    const parameters = {
        email,
        clientURL
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'generatePasskeyRegistrationOptionsExistingUser', functionSource);

    return results;
};

const routeHandlerGeneratePasskeyRegistrationOptionsExistingUser = async (request, response) => {
    const email = request.user.email;
    const clientURL = request.get('Origin') || request.get('Referer');

    const parsedClientURL = clientURL.split('//')[clientURL.split('//').length - 1];

    const callback = await generatePasskeyRegistrationOptionsExistingUser(email, parsedClientURL);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), {
                httpOnly: true,
                secure: true,
                sameSite: 'None',
                maxAge: cookie.maxAge
            });
        }
    }

    return respondWithSuccess(response, 200, { options: callback.options });
};

export { routeHandlerGeneratePasskeyRegistrationOptionsExistingUser };