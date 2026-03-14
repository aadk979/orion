import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { getIp } from '../../Ip.js';
import { authorizeDeviceWithCode, sendDeviceAuthorizationMail, authorizeDeviceDirect } from '../AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js';
import { stringifyCookieData, parseCookieData } from '../../CookieUtils.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { parseDuration } from '../../Date&Time.js';
import { veryifyAndCompletePasskeyAuthentication } from '../AccountManagment/Passkeys/completeAuthentication.js';
import { verifyTOTPToken } from '../AccountManagment/TOTP.js';

const routeHandlerDeviceAuthorization = async (request, response) => {
    const headers = request.headers;
    const fingerprint = headers['orion-fingerprint'];
    const userAgent = headers['orion-user-agent'];
    const ip = getIp(request);

    const requestId = parseCookieData(request.cookies['deviceAuthorizationRequestId']);

    if (!requestId) {
        return respondWithError(response, 'DEVICE-AUTHORIZATION-MISSING-REQUEST-ID');
    }

    const code = request.body.packet.authorizationCode;

    const callback = await authorizeDeviceWithCode(requestId, code, fingerprint, ip, userAgent);

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

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerGetAvailable2faMethods = async (request, response) => {

    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTHORIZATION-MISSING-EMAIL-OFFSET');
    }

    const userLink = await globalAccessPoint.db().getData('Users-email', email);

    if (userLink.data === undefined) {
        return respondWithError(response, 'ACC-SIGN-IN-ACC-NO-EXISTS');
    }

    const user = await globalAccessPoint.db().getData('Users', userLink.data.uid);

    const methods = {
        'email-code': true,
        passkey: user.data.credentials?.passkey?.exist || false,
        totp: user.data.credentials?.totp?.enabled || false
    };

    return respondWithSuccess(response, 200, { methods });
};

const routeHandlerSendDeviceAuthorizationMail = async (request, response) => {
    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTHORIZATION-MISSING-EMAIL-OFFSET');
    }

    const headers = request.headers;
    const fingerprint = headers['orion-fingerprint'];
    const userAgent = headers['orion-user-agent'];
    const ip = getIp(request);

    const deviceAuthorizationRequest = await sendDeviceAuthorizationMail(email, fingerprint, ip, userAgent);

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

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerAuthorizeDeviceWithPasskey = async (request, response) => {
    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTHORIZATION-MISSING-EMAIL-OFFSET');
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
            response.cookie(cookieData.key, stringifyCookieData(cookieData.data), { httpOnly: true, secure: true, sameSite: 'None', maxAge: cookieData.maxAge });
        }
    }

    response.cookie('PASSKEY-AUTHENTICATION-INFO-STEP-1', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });
    response.cookie('deviceAuthEmailOffset', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerAuthorizeDeviceWithTOTP = async (request, response) => {
    const email = request.cookies['deviceAuthEmailOffset'];

    if (!email) {
        return respondWithError(response, 'DEVICE-AUTHORIZATION-MISSING-EMAIL-OFFSET');
    }

    const totpCode = request.body.packet.totpCode || request.body.packet.code;
    const userAgent = request.headers['orion-user-agent'];

    const userLink = await globalAccessPoint.db().getData('Users-email', email);

    if (userLink.data === undefined) {
        return respondWithError(response, 'ACC-SIGN-IN-ACC-NO-EXISTS');
    }

    const user = await globalAccessPoint.db().getData('Users', userLink.data.uid);

    if (!user.data.credentials?.totp?.enabled) {
        return respondWithError(response, 'TOTP-NOT-ENABLED');
    }

    const secret = user.data.credentials.totp.secret;

    const verification = await verifyTOTPToken(totpCode, secret);

    if (verification.error) {
        return respondWithError(response, 'DEVICE-AUTHORIZATION-INVALID-TOTP');
    }

    const authorization = await authorizeDeviceDirect(email, undefined, userAgent);

    if (authorization.error) {
        return respondWithError(response, authorization.errorCode);
    }

    if (authorization.cookies) {
        for (let i = 0; i < authorization.cookies.length; i++) {
            const cookieData = authorization.cookies[i];
            response.cookie(cookieData.key, stringifyCookieData(cookieData.data), { httpOnly: true, secure: true, sameSite: 'None', maxAge: cookieData.maxAge });
        }
    }

    response.cookie('deviceAuthEmailOffset', '', { httpOnly: true, secure: true, sameSite: 'None', path: '/', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true });
};

export { routeHandlerDeviceAuthorization, routeHandlerGetAvailable2faMethods, routeHandlerSendDeviceAuthorizationMail, routeHandlerAuthorizeDeviceWithPasskey, routeHandlerAuthorizeDeviceWithTOTP };