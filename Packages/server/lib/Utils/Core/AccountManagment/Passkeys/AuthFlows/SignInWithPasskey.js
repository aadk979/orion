import { respondWithError, respondWithSuccess } from '../../../../../Server/Response/response.js';
import { generateSignature } from '../../../../CryptoFunctions.js';
import { parseDuration } from '../../../../Date&Time.js';
import { globalAccessPoint } from '../../../../GlobalAccessPoint.js';
import { getIp } from '../../../../Ip.js';
import { tryCatch } from '../../../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateId } from '../../../../valueGenerator.js';
import { generateAccessToken } from '../../../TokenManagement/AccessTokens.js';
import { generateRefreshToken } from '../../../TokenManagement/RefreshTokens.js';
import { veryifyAndCompletePasskeyAuthentication } from '../completeAuthentication.js';
import { stringifyCookieData } from '../../../../CookieUtils.js';
import { requestContext } from '../../../../../Server/Middleware/requestMetadata.js';
import { userControl } from '../../UserControl.js';

const signInWithPasskey = async (authenticationResponse, cookie, email, clientURL, parsedClientURL, userAgent, fingerprint, ip) => {
    const Function = async (parameters) => {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
        const requestMetadata = requestContext.getStore();
        const systemConfig = globalAccessPoint.getValue("systemConfig");

        if (!systemConfig.authMethods.passkey) {
            auditTrail.record({
                user: { email: parameters.email },
                device: { 
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "PASSKEY_SIGN_IN_ATTEMPT",
                status: "FAILED",
                source: "SignInWithPasskey.js",
                functionName: "signInWithPasskey",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "Passkey sign in blocked - method disabled",
                metadata: { reason: "PASSKEY_DISABLED" },
                errorCode: "PASSKEY-SIGN-IN-DISABLED"
            });
            return { error: true, errorCode: "PASSKEY-SIGN-IN-DISABLED" }
        }

        const userAccState = await userControl.getUserAccountState().byEmail(parameters.email);

        if (userAccState.disabled) {
            return { error: true, errorCode: "PASSKEY-SIGN-IN-ACC-DISABLED" }
        }

        const verification = await veryifyAndCompletePasskeyAuthentication(parameters.authenticationResponse, parameters.cookie, parameters.email, parameters.expectedOrigin, parameters.parsedClientURL);

        if (verification.error) {
            auditTrail.record({
                user: { email: parameters.email },
                device: { 
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: "PASSKEY_SIGN_IN_ATTEMPT",
                status: "FAILED",
                source: "SignInWithPasskey.js",
                functionName: "signInWithPasskey",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "Passkey authentication failed",
                metadata: { 
                    reason: "VERIFICATION_FAILED",
                    errorCode: verification.errorCode
                },
                errorCode: verification.errorCode
            });
            return { error: true, errorCode: verification.errorCode };
        }

        if (!verification.authenticated) {
            auditTrail.record({
                user: { email: parameters.email },
                device: { 
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "PASSKEY_SIGN_IN_ATTEMPT",
                status: "FAILED",
                source: "SignInWithPasskey.js",
                functionName: "signInWithPasskey",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "Passkey authentication failed - unable to authenticate",
                metadata: { reason: "AUTHENTICATION_FAILED" },
                errorCode: "PASSKEY-UNABLE-TO-AUTHENTICATE"
            });
            return { error: true, errorCode: "PASSKEY-UNABLE-TO-AUTHENTICATE" }
        }

        const user = await globalAccessPoint.db().getData("Users", verification.uid)

        const accessToken = await generateAccessToken(user.data.credentials.uid , email , parameters.fingerprint , "PASSKEY" , "USER" , parameters.ip , parameters.userAgent);

        if(accessToken.error){
            auditTrail.record({
                user: { email: parameters.email, uid: verification.uid },
                device: { 
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "PASSKEY_SIGN_IN_ATTEMPT",
                status: "FAILED",
                source: "SignInWithPasskey.js",
                functionName: "signInWithPasskey",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "Passkey sign in failed - access token generation error",
                metadata: { 
                    reason: "ACCESS_TOKEN_GENERATION_FAILED",
                    errorCode: accessToken.errorCode
                },
                errorCode: accessToken.errorCode
            });
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(user.data.credentials.uid , email , parameters.fingerprint , "PASSKEY" , "USER" , parameters.ip , parameters.userAgent , accessToken.accessTokenLinkCode);

        if(refreshToken.error){
            auditTrail.record({
                user: { email: parameters.email, uid: verification.uid },
                device: { 
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent 
                },
                action: "PASSKEY_SIGN_IN_ATTEMPT",
                status: "FAILED",
                source: "SignInWithPasskey.js",
                functionName: "signInWithPasskey",
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: "Passkey sign in failed - refresh token generation error",
                metadata: { 
                    reason: "REFRESH_TOKEN_GENERATION_FAILED",
                    errorCode: refreshToken.errorCode
                },
                errorCode: refreshToken.errorCode
            });
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            signedIn: true
        }

        const SID = generateId("SID", 64);

        const signatureKeyPair = globalAccessPoint.getValue("signatureSecretsManager").getRandomKeyPair("internal");

        const signature = generateSignature(SID + refreshToken.token, signatureKeyPair.privateKey);
        const cookieSignature = `${signature}:*:${signatureKeyPair.keyPairId}`

        const tokenCookies = [
            { key: "ACCESS_TOKEN", data: accessToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.accessTokens) },
            { key: "REFRESH_TOKEN", data: refreshToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) },
            { key: "SID", data: SID, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) },
            { key: "SID_SIGNATURE", data: cookieSignature, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) }
        ]

        auditTrail.record({
            user: { email: parameters.email, uid: verification.uid },
            device: { 
                fingerprint: parameters.fingerprint,
                userAgent: parameters.userAgent 
            },
            action: "PASSKEY_SIGN_IN_SUCCESS",
            status: "SUCCESS",
            source: "SignInWithPasskey.js",
            functionName: "signInWithPasskey",
            requestId: requestMetadata?.requestId,
            ipAddress: parameters.ip,
            impact: "User successfully signed in with passkey",
            metadata: { 
                method: "PASSKEY",
                accessTokenGenerated: true,
                refreshTokenGenerated: true
            }
        });

        return { error: false, data: response , completed: true, cookies: [...tokenCookies, ...accessToken.cookies] };

    }

    const parameters = {
        authenticationResponse,
        cookie,
        email,
        expectedOrigin: clientURL,
        parsedClientURL,
        userAgent,
        fingerprint,
        ip
    }

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'signInWithPasskey', functionSource);

    return results;
}

const routeHandlerSignInWithPasskey = async (request, response) => {
    const cookie = request.cookies["PASSKEY-AUTHENTICATION-INFO-STEP-1"];
    const email = request.body.packet.email;
    const clientURL = request.get("Origin") || request.get("Referer");
    const responseData = request.body.packet.authenticationResponse;

    const userAgent = request.headers["orion-user-agent"];
    const fingerprint = request.headers["orion-fingerprint"];

    const ip = getIp(request)

    const parsedClientURL = clientURL.split("//")[clientURL.split("//").length - 1];

    const callback = await signInWithPasskey(responseData, cookie, email, clientURL, parsedClientURL, userAgent, fingerprint, ip);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

     if (callback.cookies) {
    for (let i = 0; i < callback.cookies.length; i++) {
      const cookie = callback.cookies[i];
      response.cookie(cookie.key, stringifyCookieData(cookie.data), {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: cookie.maxAge,
      });
    }
  }

    response.clearCookie("PASSKEY-REGISTRATION-INFO-STEP-1" , { httpOnly: true, secure: false, sameSite: "None" , maxAge: 0 });

    return respondWithSuccess(response, 200, callback.data);
}

export { routeHandlerSignInWithPasskey };