import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { PasskeyModel, UserSecurityModel, WebAuthnCeremonyModel } from '../../../Databases/models/index.js';
import { tryCatch } from '../../../TryCatch.js';
import { respondWithError, respondWithSuccess } from '../../../../Server/Response/response.js';
import { parseCookieData, clearManagedCookie } from '../../../CookieUtils.js';
import { resolveClientContext } from '../../../Parsers.js';
import { fileURLToPath } from 'url';
import { SafeModuleHandler } from '../../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'completeRegistration.js');

const veryifyAndCompletePasskeyRegistration = async (registrationResponse, cookie, email, expectedOrigin, parsedClientURL) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i' };
        }

        const ceremonyId = parameters.cookie ? parseCookieData(parameters.cookie) : undefined;

        if (!ceremonyId || typeof ceremonyId !== 'string') {
            return { error: true, errorCode: 'PASSKEY::REGISTRATION-EXPIRED::A::p' };
        }

        // Atomic claim — a registration ceremony is single-use, and the 'registration'
        // type predicate stops an authentication ceremony being spent here.
        const ceremony = await WebAuthnCeremonyModel.consume(ceremonyId, 'registration');

        if (!ceremony) {
            return { error: true, errorCode: 'PASSKEY::REGISTRATION-EXPIRED::A::p' };
        }

        // Consistency check only. The ceremony's own uid is what the credential
        // is saved against — the caller can no longer nominate the account.
        if (parameters.email && ceremony.email && ceremony.email.toLowerCase() !== parameters.email.toLowerCase()) {
            return { error: true, errorCode: 'PASSKEY::REGISTRATION-EMAIL-MISMATCH::A::p' };
        }

        const verification = await verifyRegistrationResponse({
            response: parameters.registrationResponse,
            expectedChallenge: ceremony.challenge,
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

        await PasskeyModel.savePasskey(ceremony.user_uid, storageObj);
        await UserSecurityModel.setTwoFAEnabled(ceremony.user_uid, true);

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
    const responseData = request.body.packet?.registrationResponse;

    // Must match the RP ID that generateRegistrationOptions issued the ceremony
    // under — see resolveClientContext in Utils/Parsers.js.
    const clientContext = resolveClientContext(request);

    if (!clientContext) {
        return respondWithError(response, 'GENERAL::UNKNOWN-ORIGIN::A::p');
    }

    const callback = await veryifyAndCompletePasskeyRegistration(responseData, cookie, email, clientContext.origin, clientContext.rpId);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    clearManagedCookie(response, 'PASSKEY-REGISTRATION-INFO-STEP-1');

    return respondWithSuccess(response, 200, callback.data);
};

export { routeHandlerVerifyAndCompletePasskeyRegistration };
