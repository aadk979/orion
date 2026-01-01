import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { getIp } from '../../Ip.js';
import { authorizeDeviceWithCode } from '../AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js';
import { stringifyCookieData, parseCookieData } from '../../CookieUtils.js';

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

    response.cookie('deviceAuthorizationRequestId', '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true });
};

export { routeHandlerDeviceAuthorization };
