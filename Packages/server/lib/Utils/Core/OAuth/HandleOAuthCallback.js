import { respondWithError, respondWithSuccess } from "../../../Server/Response/response.js"
import { verifyHash } from "../../CryptoFunctions.js"
import { parseDuration } from "../../Date&Time.js"
import { base64Decode } from "../../Encoders.js"
import { globalAccessPoint } from "../../GlobalAccessPoint.js"
import { getIp, isIpInRange } from "../../Ip.js"
import { tryCatch } from "../../TryCatch.js"
import { generateId } from "../../valueGenerator.js"
import { generateAccessToken } from "../TokenManagement/AccessTokens.js"
import { generateRefreshToken } from "../TokenManagement/RefreshTokens.js"
import { accountExist, checkAndAddProviderToAccount, createAccountWithProvider } from "./Account.js"
import { generateHmac } from "../../CryptoFunctions.js"
import { isDeviceRecognizedForUserEmail, sendDeviceAuthorizationMail } from "../AccountManagment/2FA/user.js"
import { stringifyCookieData } from "../../CookieUtils.js"

const handleOAuthCallback = async (code, state, deviceFingerprint, ip, userAgent, deviceId, deviceCode) => {
    const Function = async (parameters) => {
        const oAuthToolKit = globalAccessPoint.getValue("oAuthToolKit");

        const stateFromClient = JSON.parse(base64Decode(parameters.state));

        const stateFromServer = await globalAccessPoint.db().getData("O-AUTH-REQUESTS", stateFromClient.requestId);

        if (stateFromServer.data === undefined) {
            return { error: true, errorCode: "O-AUTH-REQUEST-INVALID-OR-EXPIRED" }
        }

        if (!(await verifyHash(parameters.deviceFingerprint, stateFromServer.data.hashedDeviceFingerprint))) {
            return { error: true, errorCode: "O-AUTH-DEVICE-FINGERPRINT-MISMATCH" }
        }

        if (! (await isIpInRange(parameters.ip, stateFromServer.data.ipRange))) {
            return { error: true, errorCode: "O-AUTH-IP-MISMATCH" }
        }

        if (!(await verifyHash(stateFromClient.challenge, stateFromServer.data.hashedChallenge))) {
            return { error: true, errorCode: "O-AUTH-INVALID-STATE-CHALLENGE" }
        }

        const provider = stateFromServer.data.providerName.trim().toLowerCase();

        const oAuthResponse = await oAuthToolKit.handleCallback(provider, parameters.code);

        if (oAuthResponse?.error) {
            return { error: true, errorCode: oAuthResponse.errorCode };
        }

        if (!oAuthResponse.verified) {
            return { error: true, errorCode: "O-AUTH-EMAIL-NOT-VERIFIED" }
        }

        const accountExistCheck = await accountExist(oAuthResponse.email);

        if (accountExistCheck.error) {
            return accountExistCheck;
        }

        let uid;

        if (accountExistCheck.userExist) {
            const addProviderResult = await checkAndAddProviderToAccount(oAuthResponse.email, provider);

            if (addProviderResult.error) {
                return addProviderResult;
            }
            
            uid = addProviderResult.uid;
        } else {
            const createAccountResult = await createAccountWithProvider(oAuthResponse.email, provider);

            if (createAccountResult.error) {
                return createAccountResult;
            }

            uid = createAccountResult.uid;
        }

        if (!parameters?.deviceId || !parameters?.deviceCode) {
            console.log("Trigger 1")
            const deviceAuthorizationRequest = await sendDeviceAuthorizationMail(oAuthResponse.email, parameters.deviceFingerprint, parameters.ip, parameters.userAgent);

            if (deviceAuthorizationRequest.error) {
                return respondWithError(parameters.response, deviceAuthorizationRequest.errorCode);
            }

            const headers = [
                { key: "orion-flow-activation", value: "FLOW-DEVICE-AUTHORIZATION" }
            ]

            const cookies = [
                { key: "deviceAuthorizationRequestId", data: deviceAuthorizationRequest.reqId, maxAge: parseDuration("15m") }
            ]

            return { error: true, errorCode: "DEVICE-UNRECOGNIZED", cookies, headers }
        }

        const deviceRecognition = await isDeviceRecognizedForUserEmail(oAuthResponse.email, parameters.userAgent, parameters.deviceId, parameters.deviceCode);

        if (deviceRecognition.error) {
            console.log("Trigger 2", deviceRecognition)
            const deviceAuthorizationRequest = await sendDeviceAuthorizationMail(oAuthResponse.email, parameters.deviceFingerprint, parameters.ip, parameters.userAgent);

            if (deviceAuthorizationRequest.error) {
                return respondWithError(parameters.response, deviceAuthorizationRequest.errorCode);
            }

            const headers = [
                { key: "orion-flow-activation", value: "FLOW-DEVICE-AUTHORIZATION" }
            ]

            const cookies = [
                { key: "deviceAuthorizationRequestId", data: deviceAuthorizationRequest.reqId, maxAge: parseDuration("15m") }
            ]

            return { error: true, errorCode: "DEVICE-UNRECOGNIZED", cookies, headers }
        }

        const accessToken = await generateAccessToken(uid , oAuthResponse.email , parameters.deviceFingerprint , `PROVIDER-${provider.trim().toUpperCase()}` , "USER" , parameters.ip , parameters.userAgent);

        if(accessToken.error){
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(uid , oAuthResponse.email , parameters.deviceFingerprint , `PROVIDER-${provider.trim().toUpperCase()}` , "USER" , parameters.ip, parameters.userAgent , accessToken.accessTokenLinkCode);

        if(refreshToken.error){
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            signedIn: true
        }

        const SID = generateId("SID", 64);

        const hmac = await generateHmac(SID + refreshToken.token, globalAccessPoint.getValue("volatileSecretsManager").getKey(0).secret);

        const tokenCookies = [
            { key: "ACCESS_TOKEN", data: accessToken.token, maxAge: parseDuration(globalAccessPoint.getValue("systemConfig").tokens.lifespans.accessTokens) },
            { key: "REFRESH_TOKEN", data: refreshToken.token, maxAge: parseDuration(globalAccessPoint.getValue("systemConfig").tokens.lifespans.refreshTokens) },
            { key: "SID", data: SID, maxAge: parseDuration(globalAccessPoint.getValue("systemConfig").tokens.lifespans.refreshTokens) },
            { key: "SID_HMAC", data: hmac, maxAge: parseDuration(globalAccessPoint.getValue("systemConfig").tokens.lifespans.refreshTokens) }
        ]

        return { error: false, data: response , completed: true, cookies: [...tokenCookies] };
    }

    const parameters = {
        state,
        code,
        deviceFingerprint,
        ip,
        userAgent,
        deviceId,
        deviceCode
    }

    const results = await tryCatch(Function, true, parameters);

    if (results.error && results.errorCode === "UNKNOWN-ERROR") {
        return { error: true, errorCode: "O-AUTH-CALLBACK-PROCESSING-FAILED" };
    }

    return results;
}

const routeHandlerHandleOAuthCallback = async (request , response) => {
    const packet = request.body.packet;

    const code = packet.code;
    const state = packet.state;

    const ip = getIp(request);
    const fingerprint = request.headers["orion-fingerprint"];
    const userAgent = request.headers["orion-user-agent"];

    const deviceId = request.cookies["authorizedDeviceId"];
    const deviceCode = request.cookies["authorizedDeviceCode"];

    const callback = await handleOAuthCallback(code, state, fingerprint, ip, userAgent, deviceId, deviceCode);

    if(callback.error && callback.errorCode !== "DEVICE-UNRECOGNIZED") {
        return respondWithError(response , callback.errorCode);
    }

    if (callback?.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), { httpOnly: true, secure: true, sameSite: "None", maxAge: cookie.maxAge });
        }
    }

    if (callback?.headers) {
        for (let i = 0; i < callback.headers.length; i++) {
            const header = callback.headers[i];
            response.setHeader(header.key, header.value);
        }
    }

    if (callback.error) {
        return respondWithError(response , callback.errorCode);
    } 

    delete callback.cookies

    return respondWithSuccess(response , 200 , callback);
}

export { handleOAuthCallback, routeHandlerHandleOAuthCallback };