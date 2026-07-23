import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { UserModel, PasskeyModel, WebAuthnCeremonyModel } from '../../../Databases/models/index.js';
import { generateRequestId } from '../../../valueGenerator.js';
import { getFutureUnixTime } from '../../../Date&Time.js';
import { sanitizeString } from '../../../Sanitizer.js';
import { tryCatch } from '../../../TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmail, isValidEmailDomain } from '../../../Validator.js';
import { respondWithError, respondWithSuccess } from '../../../../Server/Response/response.js';
import { setManagedCookie } from '../../../CookieUtils.js';
import { SafeModuleHandler } from '../../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'generateAuthenticationOptions.js');

const generatePasskeyAuthenticationOptionsExistingUser = async (email, clientURL) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i' };
        }

        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            return { error: true, errorCode: 'PASSKEY::AUTH-INVALID-EMAIL::A::p' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), sanitizedEmail);

            if (!emailValidation) {
                return respondWithError(parameters.response, 'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p');
            }
        }

        const user = await UserModel.getUserByEmail(sanitizedEmail);

        if (!user) {
            return { error: true, errorCode: 'PASSKEY::ACCOUNT-NOT-FOUND::A::p' };
        }

        const passkey = await PasskeyModel.getPasskey(user.uid);

        if (!passkey) {
            return {
                error: true,
                errorCode: 'PASSKEY::AUTH-NO-ACTIVE-PASSKEY::A::p'
            };
        }

        const options = await generateAuthenticationOptions({
            rpId: parameters.clientURL,
            allowCredentials: [
                {
                    id: passkey.credential_id,
                    type: 'public-key',
                    transports: passkey.transports
                }
            ]
        });

        // Challenge and subject stay server-side; the cookie carries an opaque
        // handle. Previously both rode in the cookie, so the caller chose the
        // challenge the assertion was checked against AND which user's credential
        // it was checked with.
        const ceremonyId = generateRequestId('WEBAUTHN_AUTH', 32);

        await WebAuthnCeremonyModel.create({
            ceremonyId,
            type: 'authentication',
            challenge: options.challenge,
            uid: user.uid,
            email: lowerCaseEmail,
            expiresAt: getFutureUnixTime('2m')
        });

        return {
            error: false,
            options: options,
            cookies: [
                {
                    key: 'PASSKEY-AUTHENTICATION-INFO-STEP-1',
                    data: ceremonyId,
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
        for (const cookie of callback.cookies) {
            setManagedCookie(response, cookie.key, cookie.data);
        }
    }

    return respondWithSuccess(response, 200, { options: callback.options });
};

export { routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser };
