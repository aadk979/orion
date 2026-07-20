import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { PasskeyModel, UserSecurityModel } from '../../../Databases/models/index.js';
import { tryCatch } from '../../../TryCatch.js';
import { respondWithError, respondWithSuccess } from '../../../../Server/Response/response.js';
import { parseCookieData, clearManagedCookie } from '../../../CookieUtils.js';
import { fileURLToPath } from 'url';
import { SafeModuleHandler } from '../../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'completeRegistration.js');

const veryifyAndCompletePasskeyRegistration = async (registrationResponse, cookie, email, expectedOrigin, parsedClientURL) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i' };
        }

        const cookie = parameters.cookie ? parseCookieData(parameters.cookie) : undefined;

        if (!cookie) {
            return { error: true, errorCode: 'PASSKEY::REGISTRATION-EXPIRED::A::p' };
        }

        if (cookie.email !== parameters.email) {
            return { error: true, errorCode: 'PASSKEY::REGISTRATION-EMAIL-MISMATCH::A::p' };
        }

        const verification = await verifyRegistrationResponse({
            response: parameters.registrationResponse,
            expectedChallenge: cookie.challenge,
            expectedOrigin: parameters.expectedOrigin,
            expectedRPID: parameters.clientURL
        });

        if (!verification.verified) {
            return { error: true, errorCode: 'PASSKEY::REGISTRATION-FAILED::A::i' };
        }

        const storageObj = {
            id: verification.registrationInfo.credential.id,
            publicKey: verification.registrationInfo.credential.publicKey,
            counter: verification.registrationInfo.credential.counter,
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
            transports: verification.registrationInfo.credential.transports
        };

        await PasskeyModel.savePasskey(cookie.uid, storageObj);
        await UserSecurityModel.setTwoFAEnabled(cookie.uid, true);

        return { error: false, data: {} };
    };

    const parameters = {
        registrationResponse: registrationResponse,
        expectedOrigin: expectedOrigin,
        cookie: cookie,
        email: email,
        clientURL: parsedClientURL
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'veryifyAndCompletePasskeyRegistration', functionSource);

    return results;
};

const routeHandlerVerifyAndCompletePasskeyRegistration = async (request, response) => {
    const cookie = request.cookies['PASSKEY-REGISTRATION-INFO-STEP-1'];
    const email = request.user.email;
    const clientURL = request.get('Origin') || request.get('Referer');
    const responseData = request.body.packet.registrationResponse;

    const parsedClientURL = clientURL.split('//')[clientURL.split('//').length - 1];

    const callback = await veryifyAndCompletePasskeyRegistration(responseData, cookie, email, clientURL, parsedClientURL);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    clearManagedCookie(response, 'PASSKEY-REGISTRATION-INFO-STEP-1');

    return respondWithSuccess(response, 200, callback.data);
};

export { routeHandlerVerifyAndCompletePasskeyRegistration };
