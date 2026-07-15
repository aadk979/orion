import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { getIp } from '../../Ip.js';
import {
    authorizeDeviceWithCode,
    sendDeviceAuthorizationMail,
    authorizeDeviceDirect
} from '../AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js';
import { stringifyCookieData, parseCookieData } from '../../CookieUtils.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, PasskeyModel, TOTPModel } from '../../Databases/models/index.js';
import { parseDuration } from '../../Date&Time.js';
import { veryifyAndCompletePasskeyAuthentication } from '../AccountManagment/Passkeys/completeAuthentication.js';
import { verifyTOTPToken } from '../AccountManagment/TOTP.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'DeviceAuthorization.js');


const routeHandlerDeviceAuthorization = async (request, response) => {
    const headers = request.headers;
    const userAgent = headers['orion-user-agent'];
    const ip = getIp(request);

    const requestId = parseCookieData(request.cookies['deviceAuthorizationRequestId']);
    const flowSecret = parseCookieData(request.cookies['deviceAuthFlowSecret']) || '';

    if (!requestId) {
        return respondWithError(response, 'DEVICE-AUTH::MISSING-REQUEST-ID::A::p');
    }

    const code = request.body.packet.authorizationCode;

    const callback = await authorizeDeviceWithCode(requestId, code, flowSecret, ip, userAgent);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback?.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), { httpOnly: true, secure: true, sameSite: 'None', maxAge: cookie.maxAge });
        }
    }

    response.cookie('deviceAuthorizationRequestId', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });
    response.cookie('deviceAuthEmailOffset', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });
    response.cookie('deviceAuthFlowSecret', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerGetAvailable2faMethods = async (request, response) => {
    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p');
    }

    const uid = await UserModel.getUidByEmail(email);

    if (!uid) {
        return respondWithError(response, 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p');
    }

    const hasPasskey = await PasskeyModel.hasPasskey(uid);
    const totpEnabled = await TOTPModel.isEnabled(uid);

    const totpSystemDisabled = globalAccessPoint.getValue('totpSystemDisabled');
    const passkeySystemDisabled = !systemConfigModule.getModule()?.authMethods?.passkey;

    const methods = {
        'email-code': true,
        passkey: passkeySystemDisabled ? false : hasPasskey,
        totp: totpSystemDisabled ? false : totpEnabled
    };

    return respondWithSuccess(response, 200, { methods });
};

const routeHandlerSendDeviceAuthorizationMail = async (request, response) => {
    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p');
    }

    const headers = request.headers;
    const userAgent = headers['orion-user-agent'];
    const ip = getIp(request);

    const deviceAuthorizationRequest = await sendDeviceAuthorizationMail(email, ip, userAgent);

    if (deviceAuthorizationRequest.error) {
        return respondWithError(response, deviceAuthorizationRequest.errorCode);
    }

    response.cookie('deviceAuthorizationRequestId', deviceAuthorizationRequest.reqId, {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        path: '/',
        maxAge: parseDuration('15m')
    });

    // Deliver the flow_secret to the client as an HttpOnly cookie for later verification
    response.cookie('deviceAuthFlowSecret', deviceAuthorizationRequest.flowSecret, {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        path: '/',
        maxAge: parseDuration('15m')
    });

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerAuthorizeDeviceWithPasskey = async (request, response) => {
    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p');
    }

    const cookie = request.cookies['PASSKEY-AUTHENTICATION-INFO-STEP-1'];
    const responseData = request.body.packet.authenticationResponse;
    const clientURL = request.get('Origin') || request.get('Referer');
    const parsedClientURL = new URL(clientURL).host;

    const userAgent = request.headers['orion-user-agent'];

    const verification = await veryifyAndCompletePasskeyAuthentication(responseData, cookie, email, clientURL, parsedClientURL);

    if (verification.error) {
        return respondWithError(response, verification.errorCode);
    }

    const authorization = await authorizeDeviceDirect(email, undefined, userAgent);

    if (authorization.error) {
        return respondWithError(response, authorization.errorCode);
    }

    if (authorization.cookies) {
        for (let i = 0; i < authorization.cookies.length; i++) {
            const cookieData = authorization.cookies[i];
            response.cookie(cookieData.key, stringifyCookieData(cookieData.data), {
                httpOnly: true,
                secure: true,
                sameSite: 'None',
                maxAge: cookieData.maxAge
            });
        }
    }

    response.cookie('PASSKEY-AUTHENTICATION-INFO-STEP-1', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });
    response.cookie('deviceAuthEmailOffset', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerAuthorizeDeviceWithTOTP = async (request, response) => {
    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p');
    }

    if (globalAccessPoint.getValue('totpSystemDisabled')) {
        return respondWithError(response, 'TOTP::SYSTEM-DISABLED::A::i');
    }

    const totpCode = request.body.packet.totpCode || request.body.packet.code;
    const userAgent = request.headers['orion-user-agent'];

    const uid = await UserModel.getUidByEmail(email);

    if (!uid) {
        return respondWithError(response, 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p');
    }

    const totpConfig = await TOTPModel.getTOTPConfig(uid);

    if (!totpConfig?.enabled) {
        return respondWithError(response, 'TOTP::NOT-ENABLED::A::p');
    }

    const secret = totpConfig.secret;

    const verification = await verifyTOTPToken(totpCode, secret);

    if (verification.error) {
        return respondWithError(response, 'DEVICE-AUTH::INVALID-TOTP::A::p');
    }

    const authorization = await authorizeDeviceDirect(email, undefined, userAgent);

    if (authorization.error) {
        return respondWithError(response, authorization.errorCode);
    }

    if (authorization.cookies) {
        for (let i = 0; i < authorization.cookies.length; i++) {
            const cookieData = authorization.cookies[i];
            response.cookie(cookieData.key, stringifyCookieData(cookieData.data), {
                httpOnly: true,
                secure: true,
                sameSite: 'None',
                maxAge: cookieData.maxAge
            });
        }
    }

    response.cookie('deviceAuthEmailOffset', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true });
};

export {
    routeHandlerDeviceAuthorization,
    routeHandlerGetAvailable2faMethods,
    routeHandlerSendDeviceAuthorizationMail,
    routeHandlerAuthorizeDeviceWithPasskey,
    routeHandlerAuthorizeDeviceWithTOTP
};
