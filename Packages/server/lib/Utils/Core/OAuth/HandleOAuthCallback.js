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
import { isDeviceRecognizedForUserEmail, sendDeviceAuthorizationMail } from "../AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js"
import { stringifyCookieData } from "../../CookieUtils.js"
import { requestContext } from "../../../Server/Middleware/requestMetadata.js"
import { isValidEmailDomain } from "../../Validator.js"
import { generateResourceToken } from "../ResourceAccessManagment/callbackBasedResources/resourceTokens.js"
import { resourceUriBuilder } from "../ResourceAccessManagment/callbackBasedResources/utils.js"
import { userControl } from "../AccountManagment/UserControl.js"

const handleOAuthCallback = async (code, state, deviceFingerprint, ip, userAgent, deviceId, deviceCode) => {
    const Function = async (parameters) => {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
        const requestMetadata = requestContext.getStore();
        const oAuthToolKit = globalAccessPoint.getValue("oAuthToolKit");

        const stateFromClient = JSON.parse(base64Decode(parameters.state));

        const stateFromServer = await globalAccessPoint.db().getData("O-AUTH-REQUESTS", stateFromClient.requestId);

        if (stateFromServer.data === undefined) {
            auditTrail.record({
                user: {},
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "OAUTH_CALLBACK_ATTEMPT",
                status: "FAILED",
                source: "HandleOAuthCallback.js",
                functionName: "handleOAuthCallback",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth callback blocked - invalid or expired request",
                metadata: { 
                    reason: "INVALID_OR_EXPIRED_REQUEST",
                    requestId: stateFromClient.requestId
                },
                errorCode: "O-AUTH-REQUEST-INVALID-OR-EXPIRED"
            });
            return { error: true, errorCode: "O-AUTH-REQUEST-INVALID-OR-EXPIRED" }
        }

        if (!(await verifyHash(parameters.deviceFingerprint, stateFromServer.data.hashedDeviceFingerprint))) {
            auditTrail.record({
                user: {},
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "OAUTH_CALLBACK_ATTEMPT",
                status: "FAILED",
                source: "HandleOAuthCallback.js",
                functionName: "handleOAuthCallback",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth callback blocked - device fingerprint mismatch",
                metadata: { 
                    reason: "DEVICE_FINGERPRINT_MISMATCH",
                    requestId: stateFromClient.requestId
                },
                errorCode: "O-AUTH-DEVICE-FINGERPRINT-MISMATCH"
            });
            return { error: true, errorCode: "O-AUTH-DEVICE-FINGERPRINT-MISMATCH" }
        }

        if (! (await isIpInRange(parameters.ip, stateFromServer.data.ipRange))) {
            auditTrail.record({
                user: {},
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "OAUTH_CALLBACK_ATTEMPT",
                status: "FAILED",
                source: "HandleOAuthCallback.js",
                functionName: "handleOAuthCallback",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth callback blocked - IP address mismatch",
                metadata: { 
                    reason: "IP_MISMATCH",
                    requestId: stateFromClient.requestId
                },
                errorCode: "O-AUTH-IP-MISMATCH"
            });
            return { error: true, errorCode: "O-AUTH-IP-MISMATCH" }
        }

        if (!(await verifyHash(stateFromClient.challenge, stateFromServer.data.hashedChallenge))) {
            auditTrail.record({
                user: {},
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "OAUTH_CALLBACK_ATTEMPT",
                status: "FAILED",
                source: "HandleOAuthCallback.js",
                functionName: "handleOAuthCallback",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth callback blocked - invalid state challenge",
                metadata: { 
                    reason: "INVALID_STATE_CHALLENGE",
                    requestId: stateFromClient.requestId
                },
                errorCode: "O-AUTH-INVALID-STATE-CHALLENGE"
            });
            return { error: true, errorCode: "O-AUTH-INVALID-STATE-CHALLENGE" }
        }

        const provider = stateFromServer.data.providerName.trim().toLowerCase();

        const oAuthResponse = await oAuthToolKit.handleCallback(provider, parameters.code);

        if (oAuthResponse?.error) {
            auditTrail.record({
                user: {},
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "OAUTH_CALLBACK_ATTEMPT",
                status: "FAILED",
                source: "HandleOAuthCallback.js",
                functionName: "handleOAuthCallback",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth callback failed - provider error",
                metadata: { 
                    reason: "PROVIDER_ERROR",
                    provider: provider,
                    requestId: stateFromClient.requestId
                },
                errorCode: oAuthResponse.errorCode
            });
            return { error: true, errorCode: oAuthResponse.errorCode };
        }

        if (!oAuthResponse.verified) {
            auditTrail.record({
                user: { email: oAuthResponse.email },
                device: { 
                    fingerprint: parameters.deviceFingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "OAUTH_CALLBACK_ATTEMPT",
                status: "FAILED",
                source: "HandleOAuthCallback.js",
                functionName: "handleOAuthCallback",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "OAuth callback blocked - email not verified",
                metadata: { 
                    reason: "EMAIL_NOT_VERIFIED",
                    provider: provider,
                    requestId: stateFromClient.requestId
                },
                errorCode: "O-AUTH-EMAIL-NOT-VERIFIED"
            });
            return { error: true, errorCode: "O-AUTH-EMAIL-NOT-VERIFIED" }
        }

        if (globalAccessPoint.getValue("allowedEmailDomains") !== "*") {
            const emailValidation = isValidEmailDomain(globalAccessPoint.getValue("allowedEmailDomains"), oAuthResponse.email);

            if (!emailValidation) {
                
                auditTrail.record({
                    user: { email: oAuthResponse.email },
                    device: { 
                        fingerprint: parameters.deviceFingerprint,
                        userAgent: parameters.userAgent 
                    },
                    action: "OAUTH_CALLBACK_ATTEMPT",
                    status: "FAILED",
                    source: "HandleOAuthCallback.js",
                    functionName: "handleOAuthCallback",
                    requestId: requestMetadata?.requestId,
                    ipAddress: parameters.ip,
                    impact: "OAuth callback blocked - email not verified",
                    metadata: { 
                        reason: "EMAIL_NOT_VERIFIED",
                        provider: provider,
                        requestId: stateFromClient.requestId
                    },
                    errorCode: "O-AUTH-EMAIL-NOT-VERIFIED"
                });

                return { error: true, errorCode: "EMAIL-DOMAIN-NOT-ALLOWED" };
            }
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

        const userAccState = await userControl.getUserAccountState().byEmail(oAuthResponse.email);

        if (userAccState.disabled) {
            return { error: true, errorCode: "O-AUTH-ACC-DISABLED" }
        }

        const deviceAuthorizationEnabled = globalAccessPoint.getValue("deviceAuthorization");

        if (deviceAuthorizationEnabled) {
            
            if (!parameters?.deviceId || !parameters?.deviceCode) {
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

        auditTrail.record({
            user: { email: oAuthResponse.email, uid: uid },
            device: { 
                fingerprint: parameters.deviceFingerprint,
                userAgent: parameters.userAgent 
            },
            action: "OAUTH_SIGN_IN_SUCCESS",
            status: "SUCCESS",
            source: "HandleOAuthCallback.js",
            functionName: "handleOAuthCallback",
            requestId: requestMetadata?.requestId,
            ipAddress: parameters.ip,
            impact: "User successfully signed in via OAuth",
            metadata: { 
                provider: provider,
                method: "OAUTH",
                accessTokenGenerated: true,
                refreshTokenGenerated: true,
                requestId: stateFromClient.requestId
            }
        });

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