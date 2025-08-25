const { respondWithError, respondWithSuccess } = require("../../../../../Server/Response/response");
const { globalAccessPoint } = require("../../../../GlobalAccessPoint");
const { getIp } = require("../../../../Ip");
const { tryCatch } = require("../../../../TryCatch");
const { generateAccessToken } = require("../../../TokenManagement/AccessTokens");
const { generateRefreshToken } = require("../../../TokenManagement/RefreshTokens");
const { veryifyAndCompletePasskeyAuthentication } = require("../completeAuthentication");

const signInWithPasskey = async (authenticationResponse, cookie, email, clientURL, parsedClientURL, userAgent, fingerprint, ip) => {
    const Function = async (parameters) => {
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

        const refreshToken = await generateRefreshToken(user.data.credentials.uid , email , parameters.fingerprint , "PASSKEY" , "USER" , parameters.ip, accessToken.cookies[0] , parameters.userAgent , accessToken.accessTokenLinkCode);

        if(refreshToken.error){
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            accessToken: accessToken.token,
            refreshToken: refreshToken.token,
        }

        return { error: false, data: response , completed: true, cookies: accessToken.cookies };
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

    console.log(userAgent)

    const parsedClientURL = clientURL.split("//")[clientURL.split("//").length - 1];

    const callback = await signInWithPasskey(responseData, cookie, email, clientURL, parsedClientURL, userAgent, fingerprint, ip);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    response.clearCookie("PASSKEY-REGISTRATION-INFO-STEP-1" , { httpOnly: true, secure: false, sameSite: "None" });

    return respondWithSuccess(response, 200, callback.data);
}

module.exports = { routeHandlerSignInWithPasskey };