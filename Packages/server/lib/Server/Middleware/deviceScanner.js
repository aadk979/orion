import { isDeviceRecognizedForUserEmail, isDeviceRecognizedForUserUID, sendDeviceAuthorizationMail } from "../../Utils/Core/AccountManagment/2FA/user.js";
import { parseDuration } from "../../Utils/Date&Time.js";
import { globalAccessPoint } from "../../Utils/GlobalAccessPoint.js";
import { getIp } from "../../Utils/Ip.js";
import { tryCatch } from "../../Utils/TryCatch.js"
import { respondWithError } from "../Response/response.js";

const NAME_SPACE = globalAccessPoint.nameSpace();

const PUBLIC_ROUTES_FOR_DEVICE_CHECK = [
    `/${NAME_SPACE}/api/v1/action/sign-in-user`,
    `/${NAME_SPACE}/api/v1/action/generate-passkey-authentication-options`,
    `/${NAME_SPACE}/api/v1/action/complete-passkey-authentication`,
]

const deviceCheckMiddlware = async (request, response, next) => {
    const Function = async (parameters) => {
        const authedUser = (parameters.request?.user !== undefined) ? true : false;

        const headers = parameters.request.headers;
        const fingerprint = headers["orion-fingerprint"];
        const userAgent = headers["orion-user-agent"];
        const ip = getIp(parameters.request);

        const deviceId = parameters.request.cookies["authorizedDeviceId"];
        const deviceCode = parameters.request.cookies["authorizedDeviceCode"];

        if (authedUser && (!deviceId || !deviceCode)) {

            parameters.response.cookie("ACCESS_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

            parameters.response.cookie("REFRESH_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

            parameters.response.cookie("SID", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

            parameters.response.cookie("SID_HMAC", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

            parameters.response.cookie("authorizedDeviceId", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

            parameters.response.cookie("authorizedDeviceCode", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

            return respondWithError(parameters.response, "DEVICE-2FA-MISSING-META-DATA");
        }

       if (authedUser === true) {
            const uid = parameters.request.user.uid;

            const check = await isDeviceRecognizedForUserUID(uid, userAgent, deviceId, deviceCode);

            if (check.error) {

                parameters.response.cookie("ACCESS_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                parameters.response.cookie("REFRESH_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                parameters.response.cookie("SID", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                parameters.response.cookie("SID_HMAC", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                parameters.response.cookie("authorizedDeviceId", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                parameters.response.cookie("authorizedDeviceCode", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                return respondWithError(parameters.response, check.errorCode);
            }

            if (check.valid) {
                return parameters.next();
            }

            return respondWithError(parameters.response, "DEVICE-UNRECOGNIZED");
        }

        if (authedUser === false) {
            const path = parameters.request.path;

            if(!PUBLIC_ROUTES_FOR_DEVICE_CHECK.includes(path)) {
                return parameters.next();
            }

            const email = parameters.request.body.packet.email;

            if (!deviceId || !deviceCode) {
                const deviceAuthorizationRequest = await sendDeviceAuthorizationMail(email, fingerprint, ip, userAgent);

                if (deviceAuthorizationRequest.error) {
                    return respondWithError(parameters.response, deviceAuthorizationRequest.errorCode);
                }

                parameters.response.cookie("deviceAuthorizationRequestId", deviceAuthorizationRequest.reqId, { httpOnly: true , secure: true , sameSite: "None" , maxAge: parseDuration("15m") });

                parameters.response.set("orion-flow-activation", "FLOW-DEVICE-AUTHORIZATION");
                
                // Not a true error, the system sends an error with the specific error code and the client SDK will identify the error code and start device authorization process on the client
                return respondWithError(parameters.response, "DEVICE-2FA-DEVICE-AUTHORIZATION-STARTED");
            }

            const check = await isDeviceRecognizedForUserEmail(email, userAgent, deviceId, deviceCode);

            if (check.error) {

                parameters.response.cookie("authorizedDeviceId", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                parameters.response.cookie("authorizedDeviceCode", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                const deviceAuthorizationRequest = await sendDeviceAuthorizationMail(email, fingerprint, ip, userAgent);

                if (deviceAuthorizationRequest.error) {
                    return respondWithError(parameters.response, deviceAuthorizationRequest.errorCode);
                }

                parameters.response.cookie("deviceAuthorizationRequestId", deviceAuthorizationRequest.reqId, { httpOnly: true , secure: true , sameSite: "None" , maxAge: parseDuration("15m") });

                parameters.response.set("orion-flow-activation", "FLOW-DEVICE-AUTHORIZATION");

                // Not a true error, the system sends an error with the specific error code and the client SDK will identify the error code and start device authorization process on the client
                return respondWithError(parameters.response, "DEVICE-2FA-DEVICE-AUTHORIZATION-STARTED");
            }

            return parameters.next();
        }
    }

    const parameters = {
        request,
        response,
        next
    }

    const result = await tryCatch(Function, true, parameters);

    return;
}

export { deviceCheckMiddlware }