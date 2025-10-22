import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { tryCatch } from '../../../TryCatch.js';
import { respondWithError, respondWithSuccess } from '../../../../Server/Response/response.js';
import { parseCookieData } from '../../../CookieUtils.js';

const veryifyAndCompletePasskeyRegistration = async (registrationResponse, cookie, email, expectedOrigin, parsedClientURL) => {
    const Function = async (parameters) => {
        const systemConfig = globalAccessPoint.getValue("systemConfig");

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: "PASSKEY-SIGN-IN-DISABLED" }
        }
        
        const cookie = parameters.cookie ? parseCookieData(parameters.cookie) : undefined;

        if (!cookie) {
            return { error: true , errorCode: "PASSKEY-REGISTRATION-EXPIRED" };
        }

        if (cookie.email !== parameters.email) {
            return { error: true , errorCode: "PASSKEY-REGISTRATION-EMAIL-MISMATCH" }
        }

        const verification = await verifyRegistrationResponse({
            response: parameters.registrationResponse,
            expectedChallenge: cookie.challenge,
            expectedOrigin: parameters.expectedOrigin,
            expectedRPID: parameters.clientURL
        });

        if (!verification.verified) {
            return { error: true , errorCode: "PASSKEY-REGISTRATION-FAILED" }
        }

        const storageObj = {
            id: verification.registrationInfo.credential.id,
            publicKey: verification.registrationInfo.credential.publicKey,
            counter: verification.registrationInfo.credential.counter,
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
            transports: verification.registrationInfo.credential.transports
        }

        let user = await globalAccessPoint.db().getData("Users" , cookie.uid);

        user.data.credentials.passkey.exist = true;
        user.data.credentials.passkey.creds = storageObj;

        await globalAccessPoint.db().addData("Users" , cookie.uid, user.data);

        return { error: false , data: {}};
    }

    const parameters = {
        registrationResponse: registrationResponse,
        expectedOrigin: expectedOrigin,
        cookie: cookie,
        email: email,
        clientURL: parsedClientURL
    }

    const results = await tryCatch(Function, true , parameters);

    return results;
}

const routeHandlerVerifyAndCompletePasskeyRegistration = async (request, response) => {
    const cookie = request.cookies["PASSKEY-REGISTRATION-INFO-STEP-1"];
    const email = request.user.email;
    const clientURL = request.get("Origin") || request.get("Referer");
    const responseData = request.body.packet.registrationResponse;

    const parsedClientURL = clientURL.split("//")[clientURL.split("//").length - 1];

    const callback = await veryifyAndCompletePasskeyRegistration(responseData, cookie, email, clientURL, parsedClientURL);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    response.clearCookie("PASSKEY-REGISTRATION-INFO-STEP-1" , { httpOnly: true, secure: false, sameSite: "None" });

    return respondWithSuccess(response, 200, callback.data);
}

export { routeHandlerVerifyAndCompletePasskeyRegistration };;