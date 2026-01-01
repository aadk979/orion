import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { sanitizeString } from '../../../Sanitizer.js';
import { tryCatch } from '../../../TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmail, isValidEmailDomain } from '../../../Validator.js';
import { respondWithError, respondWithSuccess } from '../../../../Server/Response/response.js';
import { stringifyCookieData } from '../../../CookieUtils.js';

const generatePasskeyAuthenticationOptionsExistingUser = async (email, clientURL) => {
    const Function = async parameters => {
        const systemConfig = globalAccessPoint.getValue('systemConfig');

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY-SIGN-IN-DISABLED' };
        }

        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            return { error: true, errorCode: 'PASSKEY-AUTH-INVALID-EMAIL' };
        }

        if (globalAccessPoint.getValue('allowedEmailDomains') !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.getValue('allowedEmailDomains'), sanitizedEmail);

            if (!emailValidation) {
                return respondWithError(parameters.response, 'EMAIL-DOMAIN-NOT-ALLOWED');
            }
        }

        const userLink = await globalAccessPoint.db().getData('Users-email', sanitizedEmail);

        if (userLink.data === undefined) {
            return { error: true, errorCode: 'PASSKEY-ACC-NO-EXIST' };
        }

        const user = await globalAccessPoint.db().getData('Users', userLink.data.uid);

        if (!user.data.credentials.passkey.exist) {
            return {
                error: true,
                errorCode: 'PASSKEY-AUTH-NO-ACTIVE-PASSKEY'
            };
        }

        const options = await generateAuthenticationOptions({
            rpId: parameters.clientURL,
            allowCredentials: [
                {
                    id: user.data.credentials.passkey.creds.id,
                    type: 'public-key',
                    transports: user.data.credentials.passkey.creds.transports
                }
            ]
        });

        return {
            error: false,
            options: options,
            cookies: [
                {
                    key: 'PASSKEY-AUTHENTICATION-INFO-STEP-1',
                    data: {
                        uid: user.data.credentials.uid,
                        id: options.id,
                        email: lowerCaseEmail,
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
    const results = await tryCatch(Function, true, parameters, 'generatePasskeyAuthenticationOptionsExistingUser', functionSource);

    return results;
};

const routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser = async (request, response) => {
    const email = request.body.packet.email;
    const clientURL = request.get('Origin') || request.get('Referer');

    const parsedClientURL = clientURL.split('//')[clientURL.split('//').length - 1];

    const callback = await generatePasskeyAuthenticationOptionsExistingUser(email, parsedClientURL);

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

export { routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser };
