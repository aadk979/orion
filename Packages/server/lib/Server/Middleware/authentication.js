// Do not modify this file unless you know what you are doing.
// This file contains critical code for the authentication process for incoming requests.
// Modifying this file can lead to security vulnerabilities and should only be done by experienced developers.

const { validateAccessToken, generateAccessToken } = require("../../Utils/Core/TokenManagement/AccessTokens");
const { getIp } = require("../../Utils/Ip");
const { respondWithError, respondWithSuccess } = require("../Response/response");
const { validateRefreshToken } = require("../../Utils/Core/TokenManagement/RefreshTokens");
const { validateNoAuthToken } = require("../../Utils/Core/SecurityManagment/NoAuthToken");
const { defaultServerRoutes } = require("../Endpoints");
const { globalAccessPoint } = require("../../Utils/GlobalAccessPoint");
const { parseDuration } = require("../../Utils/Date&Time");
const { generateHmac } = require("../../Utils/CryptoFunctions");

const tokenTypes = [
    "ACCESS_BEARER",
    "NO_AUTH_BEARER",
    "NO_BEARER"
]

const routesAccessibleWithNoAuthBearer = [
    "sign-in-user",
    "sign-up-user",
    "encryption-request-key"
]

const authenticationMiddleware = async (request , response , next) => {
    const Function = async (parameters) => {
        
        const headers = parameters.request.headers;
        const fingerprint = headers["orion-fingerprint"];
        const userAgent = headers["orion-user-agent"];
        const ip = getIp(parameters.request);
        const authHeader = headers["authorization"] || "DEFAULT NONE";

        const reqIsAuthStateCheck = parameters.request.path.split("/")[parameters.request.path.split("/").length -1] === "get-current-auth-state";

        const tokenType = authHeader.split(" ")[0];

        let authRequired = true;
        let setBy;

        const endpoint = defaultServerRoutes.endpoints.find(item => item.path === parameters.request.path);
        const endpointBackUp = globalAccessPoint.getValue("systemConfig").api.customEndpoints.find(item => item.path === parameters.request.path);

        if (!endpoint && !endpointBackUp && !reqIsAuthStateCheck) {
            return respondWithError(parameters.response, "UNKOWN-API-ROUTE");
        }

        if (endpoint) {
            authRequired = endpoint.requireAuth;
            // If the endpoint is set by default, we set it to 1, else we set it to 2.
            setBy = 1;
        }

        if (endpointBackUp) {
            authRequired = endpointBackUp.requireAuth;
            // If the endpoint is set by the developer, we set it to 2, else we set it to 1.
            setBy = 2;
        }

        if (!tokenTypes.includes(tokenType)) {
            return respondWithError(parameters.response , "INVALID-AUTHENTICATION-TOKEN-TYPE")
        }

        if (tokenType !== "NO_BEARER" && !parameters.request.cookies["NO_AUTH_TOKEN"] && !parameters.request.cookies["ACCESS_TOKEN"] && !parameters.request.cookies["REFRESH_TOKEN"]) {
            return respondWithError(parameters.response , "MISSING-AUTHENTICATION-TOKEN")
        }

        switch (tokenType) {
            case "ACCESS_BEARER":

                if (!parameters.request.cookies["SID"] || !parameters.request.cookies["SID_HMAC"]) {

                    parameters.response.cookie("ACCESS_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                    parameters.response.cookie("REFRESH_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                    parameters.response.cookie("SID", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                    parameters.response.cookie("SID_HMAC", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });
                    
                    return respondWithError(parameters.response, "MISSING-SESSION-ID-OR-SESSION-HMAC");
                }

                const sessionId = JSON.parse(parameters.request.cookies["SID"]);

                const refreshToken = parameters.request.cookies["REFRESH_TOKEN"] ? JSON.parse(parameters.request.cookies["REFRESH_TOKEN"]) : "NONE";

                const secretKey = globalAccessPoint.getValue("volatileSecretsManager").getKey(0).secret;

                const generatedHmac = await generateHmac(sessionId + refreshToken, secretKey);

                if (generatedHmac !== JSON.parse(parameters.request.cookies["SID_HMAC"])) {

                    parameters.response.cookie("ACCESS_TOKEN", "", { httpOnly: true, secure: true, sameSite: "None", maxAge: 0 });

                    parameters.response.cookie("REFRESH_TOKEN", "", { httpOnly: true, secure: true, sameSite: "None", maxAge: 0 });

                    parameters.response.cookie("SID", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                    parameters.response.cookie("SID_HMAC", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });
                    
                    return respondWithError(parameters.response, "INVALID-SESSION-ID");
                }

                let verification = await validateAccessToken(parameters.request.cookies["ACCESS_TOKEN"] , parameters.request.cookies , fingerprint , ip);


                if (verification.error || !verification.valid) {

                    // Guard clause early exit of issue is not that the access token is expired
                    if (verification.errorCode !== "ACCESS-TOKEN-EXPIRED" && verification.errorCode !== "MISSING-AUTHENTICATION-TOKEN") {
                        return respondWithError(parameters.response , verification.errorCode)
                    }

                    if (verification.errorCode === "ACCESS-TOKEN-EXPIRED" || verification.errorCode === "MISSING-AUTHENTICATION-TOKEN") {

                        if (!parameters.request.cookies["REFRESH_TOKEN"]) {
                            return respondWithError(parameters.response, "MISSING-AUTHENTICATION-TOKEN");
                        }

                        const refreshVerification = await validateRefreshToken(parameters.request.cookies["REFRESH_TOKEN"] , fingerprint , ip);

                        if (refreshVerification.error || !refreshVerification.valid) {
                            return respondWithError(parameters.response , refreshVerification.errorCode)
                        }

                        const refreshAllowed = globalAccessPoint.getValue("refreshRateLimiter").canRefresh(parameters.request.cookies["SID"]);

                        if (!refreshAllowed) {
                            return respondWithError(parameters.response, "REFRESH-TOKEN-LIMIT-HIT");
                        }

                        const newAccessToken = await generateAccessToken(refreshVerification.data.uid , refreshVerification.data.email , fingerprint, refreshVerification.data.authMethod , refreshVerification.data.role , ip , userAgent , refreshVerification.data.tokenData.accessTokenLinkCode);

                        if (newAccessToken.error) {
                            return respondWithError(parameters.response , newAccessToken.errorCode);
                        }

                        console.log("New access token generated for: " + parameters.request.path)

                        globalAccessPoint.getValue("refreshRateLimiter").increment(parameters.request.cookies["SID"]);

                        let validCookie = { }

                        validCookie[newAccessToken.cookies[0].key] = JSON.stringify(newAccessToken.cookies[0].data);

                        verification = await validateAccessToken(newAccessToken.token, validCookie , fingerprint , ip);

                        if (verification.error || !verification.valid) {
                            return respondWithError(parameters.response , verification.errorCode)
                        }

                        if(newAccessToken.cookies){
                            for (let i = 0; i < newAccessToken.cookies.length; i++) {
                                const cookie = newAccessToken.cookies[i];
                                parameters.response.cookie(cookie.key, JSON.stringify(cookie.data) , { httpOnly: true , secure: true , sameSite: "None" , maxAge: cookie.maxAge });
                            }
                        }

                        const durationForAccessToken = globalAccessPoint.getValue("systemConfig").tokens.lifespans.accessTokens;

                        parameters.response.cookie("ACCESS_TOKEN", JSON.stringify(newAccessToken.token) , { httpOnly: true , secure: true , sameSite: "None" , maxAge: parseDuration(durationForAccessToken) });
                        
                        // Cleanup logic flaw: since the cookies key is inside the refresh token, auto-cleanup will only work on the first refresh. On subsequent refreshes, the cookies key is different, so the line below has no effect.
                        // However, the flaw is negligible since the cookie will automatically expire 15 minutes after the access token does.
                        parameters.response.cookie(refreshVerification.data.cookieKey, "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });
                    }

                }

                if (reqIsAuthStateCheck) {
                    const responseData = {
                        authed: true
                    }

                    return respondWithSuccess(parameters.response, 200, responseData);
                }

                parameters.request.user = verification.data;

                return next();

            case "NO_AUTH_BEARER":

                if (authRequired) {
                    return respondWithError(parameters.response, "UNAUTHORIZED-TO-ACCESS-PROTECTED-ROUTE")
                }

                const path = parameters.request.path.split("/").pop();


                // Check if route exists in the accessible routes for no auth bearer, if not and the route is set by default, return an error. Else verify route was set by the user via setBy and allow access.
                if(!routesAccessibleWithNoAuthBearer.includes(path) && setBy === 1) {
                    return respondWithError(parameters.response , "INVALID-BEARER-FOR-CURRENT-ROUTE");
                }
                
                const noAuthToken = parameters.request.cookies["NO_AUTH_TOKEN"] ? JSON.parse(parameters.request.cookies["NO_AUTH_TOKEN"]) : "NONE";

                const noAuthVerification = await validateNoAuthToken(noAuthToken , ip , fingerprint , userAgent);

                if (noAuthVerification.error || !noAuthVerification.valid) {
                    return respondWithError(parameters.response , noAuthVerification.errorCode);
                }

                return next();
            
            case "NO_BEARER":
                
                if (authRequired) {
                    return respondWithError(parameters.response, "UNAUTHORIZED-TO-ACCESS-PROTECTED-ROUTE")
                }

                const approvedRoutes = [
                    "generate-no-auth-token-transaction",
                    "generate-no-auth-token",
                    "have-no-auth-token",
                    "configure-dip"
                ]

                if(!approvedRoutes.includes(parameters.request.path.split("/").pop())) {
                    return respondWithError(parameters.response , "INVALID-BEARER-FOR-CURRENT-ROUTE");
                }

                return next();

            default:
                return respondWithError(parameters.response , "INVALID-AUTHENTICATION-TOKEN-TYPE")
        }
    }

    const parameters = {
        request,
        response,
        next
    }

    const result = await Function(parameters);
}

module.exports = { authenticationMiddleware };