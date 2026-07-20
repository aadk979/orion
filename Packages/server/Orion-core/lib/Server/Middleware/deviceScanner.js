import { isDeviceRecognizedForUserEmail, isDeviceRecognizedForUserUID } from '../../Utils/Core/AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js';
import { userControl } from '../../Utils/Core/AccountManagment/UserControl.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { tryCatch } from '../../Utils/TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmailDomain } from '../../Utils/Validator.js';
import { respondWithError } from '../Response/response.js';
import { slugParser } from '../../Utils/Parsers.js';
import { setManagedCookie, clearManagedCookie } from '../../Utils/CookieUtils.js';

const NAME_SPACE = globalAccessPoint.nameSpace();

const PUBLIC_ROUTES_FOR_DEVICE_CHECK = [
    `/${NAME_SPACE}/api/v1/action/sign-in-user`,
    `/${NAME_SPACE}/api/v1/action/generate-passkey-authentication-options`,
    `/${NAME_SPACE}/api/v1/action/sign-in-with-passkey-authentication`
];

const handleCookieClearence = response => {
    clearManagedCookie(response, 'ACCESS_TOKEN');

    clearManagedCookie(response, 'REFRESH_TOKEN');

    clearManagedCookie(response, 'authorizedDeviceId');

    clearManagedCookie(response, 'authorizedDeviceCode');

    return;
};

const deviceCheckMiddlware = async (request, response, next) => {
    const Function = async parameters => {
        const deviceAuthorizationEnabled = globalAccessPoint.deviceAuthorization();

        if (!deviceAuthorizationEnabled) {
            return parameters.next();
        }

        const authedUser = parameters.request?.user !== undefined ? true : false;

        const headers = parameters.request.headers;
        const userAgent = headers['orion-user-agent'];

        const deviceId = parameters.request.cookies['authorizedDeviceId'];
        const deviceCode = parameters.request.cookies['authorizedDeviceCode'];

        if (authedUser && (!deviceId || !deviceCode)) {
            handleCookieClearence(parameters.response);

            return respondWithError(parameters.response, 'DEVICE-AUTH::MISSING-METADATA::A::p');
        }

        if (authedUser === true) {
            const uid = parameters.request.user.uid;

            const check = await isDeviceRecognizedForUserUID(uid, userAgent, deviceId, deviceCode);

            if (check.error) {
                handleCookieClearence(parameters.response);

                return respondWithError(parameters.response, check.errorCode);
            }

            if (check.valid) {
                return parameters.next();
            }

            return respondWithError(parameters.response, 'DEVICE-AUTH::UNRECOGNIZED::A::p');
        }

        if (authedUser === false) {
            const path = slugParser(parameters.request.path);

            if (!PUBLIC_ROUTES_FOR_DEVICE_CHECK.includes(path)) {
                return parameters.next();
            }

            const email = parameters.request.body.packet.email;

            if (globalAccessPoint.allowedEmailDomains() !== '*') {
                const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), email);

                if (!emailValidation) {
                    return respondWithError(parameters.response, 'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p');
                }
            }

            const userAccState = await userControl.getUserAccountState().byEmail(email);

            if (userAccState.disabled) {
                return respondWithError(parameters.response, 'DEVICE-AUTH::ACCOUNT-DISABLED::A::p');
            }

            if (!deviceId || !deviceCode) {
                setManagedCookie(parameters.response, 'deviceAuthEmailOffset', email);

                // Not a true error, the system sends an error with the specific error code and the client SDK will identify the error code and start device authorization process on the client
                // Update note: the client sdk no longer listens for the error code to trigger the flow but listens for the orion-flow-activation header as to allow future support for other flows
                return respondWithError(parameters.response, 'DEVICE-AUTH::AUTHORIZATION-STARTED::A::p');
            }

            const check = await isDeviceRecognizedForUserEmail(email, userAgent, deviceId, deviceCode);

            if (check.error) {
                clearManagedCookie(parameters.response, 'authorizedDeviceId');

                clearManagedCookie(parameters.response, 'authorizedDeviceCode');

                setManagedCookie(parameters.response, 'deviceAuthEmailOffset', email);

                // Not a true error, the system sends an error with the specific error code and the client SDK will identify the error code and start device authorization process on the client
                return respondWithError(parameters.response, 'DEVICE-AUTH::AUTHORIZATION-STARTED::A::p');
            }

            return parameters.next();
        }
    };

    const parameters = {
        request,
        response,
        next
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'deviceCheckMiddlware', functionSource);

    if (result?.error) {
        return respondWithError(response, result.errorCode);
    }

    return;
};

export { deviceCheckMiddlware };
