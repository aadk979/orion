import { generateRegistrationOptions } from '@simplewebauthn/server';
import { UserModel, PasskeyModel, WebAuthnCeremonyModel } from '../../../Databases/models/index.js';
import { generateRequestId } from '../../../valueGenerator.js';
import { getFutureUnixTime } from '../../../Date&Time.js';
import { sanitizeString } from '../../../Sanitizer.js';
import { tryCatch } from '../../../TryCatch.js';
import { isValidEmail } from '../../../Validator.js';
import { respondWithError, respondWithSuccess } from '../../../../Server/Response/response.js';
import { setManagedCookie } from '../../../CookieUtils.js';
import { resolveClientContext } from '../../../Parsers.js';
import { fileURLToPath } from 'url';
import { SafeModuleHandler } from '../../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'generateRegistrationOptions.js');

const generatePasskeyRegistrationOptionsExistingUser = async (email, clientURL) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i' };
        }

        const rpName = 'Orion';

        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            return { error: true, errorCode: 'PASSKEY::REGISTRATION-INVALID-EMAIL::A::p' };
        }

        const user = await UserModel.getUserByEmail(sanitizedEmail);

        if (!user) {
            return { error: true, errorCode: 'PASSKEY::ACCOUNT-NOT-FOUND::A::p' };
        }

        const existingPasskey = await PasskeyModel.hasPasskey(user.uid);

        if (existingPasskey) {
            return {
                error: true,
                errorCode: 'PASSKEY::REGISTRATION-ALREADY-ACTIVE::A::p'
            };
        }

        const options = await generateRegistrationOptions({
            rpId: parameters.clientURL,
            rpName: rpName,
            userid: Uint8Array.from(user.uid, c => c.charCodeAt(0)),
            userName: parameters.email,
            userDisplayName: parameters.email.split('@')[0]
        });

        // Server-held ceremony state; the cookie is an opaque handle only.
        const ceremonyId = generateRequestId('WEBAUTHN_REG', 32);

        await WebAuthnCeremonyModel.create({
            ceremonyId,
            type: 'registration',
            challenge: options.challenge,
            uid: user.uid,
            email: email,
            expiresAt: getFutureUnixTime('2m')
        });

        return {
            error: false,
            options: options,
            cookies: [
                {
                    key: 'PASSKEY-REGISTRATION-INFO-STEP-1',
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
    const results = await tryCatch(Function, true, parameters, 'generatePasskeyRegistrationOptionsExistingUser', functionSource);

    return results;
};

const routeHandlerGeneratePasskeyRegistrationOptionsExistingUser = async (request, response) => {
    const email = request.user.email;
    // Registration MUST derive the RP ID exactly as authentication does — a
    // credential registered under one RP ID can never be asserted against
    // another. See resolveClientContext in Utils/Parsers.js.
    const clientContext = resolveClientContext(request);

    if (!clientContext) {
        return respondWithError(response, 'GENERAL::UNKNOWN-ORIGIN::A::p');
    }

    const callback = await generatePasskeyRegistrationOptionsExistingUser(email, clientContext.rpId);

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

export { routeHandlerGeneratePasskeyRegistrationOptionsExistingUser };
