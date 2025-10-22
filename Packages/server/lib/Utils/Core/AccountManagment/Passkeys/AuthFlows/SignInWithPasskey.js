import { respondWithError, respondWithSuccess } from '../../../../../Server/Response/response.js';
import { generateHmac } from '../../../../CryptoFunctions.js';
import { parseDuration } from '../../../../Date&Time.js';
import { globalAccessPoint } from '../../../../GlobalAccessPoint.js';
import { getIp } from '../../../../Ip.js';
import { tryCatch } from '../../../../TryCatch.js';
import { generateId } from '../../../../valueGenerator.js';
import { generateAccessToken } from '../../../TokenManagement/AccessTokens.js';
import { generateRefreshToken } from '../../../TokenManagement/RefreshTokens.js';
import { veryifyAndCompletePasskeyAuthentication } from '../completeAuthentication.js';
import { stringifyCookieData } from '../../../../CookieUtils.js';

const signInWithPasskey = async (authenticationResponse, cookie, email, clientURL, parsedClientURL, userAgent, fingerprint, ip) => {
    const Function = async (parameters) => {
        const systemConfig = globalAccessPoint.getValue("systemConfig");

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: "PASSKEY-SIGN-IN-DISABLED" }
        }

        const verification = await veryifyAndCompletePasskeyAuthentication(parameters.authenticationResponse, parameters.cookie, parameters.email, parameters.expectedOrigin, parameters.parsedClientURL);

        if (verification.error) {
            return { error: true, errorCode: verification.errorCode };
        }

        if (!verification.authenticated) {
            return { error: true, errorCode: "PASSKEY-UNABLE-TO-AUTHENTICATE" }
        }

        const user = await globalAccessPoint.db().getData("Users", verification.uid)

        const accessToken = await generateAccessToken(user.data.credentials.uid , email , parameters.fingerprint , "PASSKEY" , "USER" , parameters.ip , parameters.userAgent);

        if(accessToken.error){
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(user.data.credentials.uid , email , parameters.fingerprint , "PASSKEY" , "USER" , parameters.ip , parameters.userAgent , accessToken.accessTokenLinkCode);

        if(refreshToken.error){
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            signedIn: true
        }

        const SID = generateId("SID", 64);

        const hmac = await generateHmac(SID + refreshToken.token, globalAccessPoint.getValue("volatileSecretsManager").getKey(0).secret);

        const tokenCookies = [
            { key: "ACCESS_TOKEN", data: accessToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.accessTokens) },
            { key: "REFRESH_TOKEN", data: refreshToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) },
            { key: "SID", data: SID, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) },
            { key: "SID_HMAC", data: hmac, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) }
        ]

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

    const results = await tryCatch(Function, true, parameters);

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