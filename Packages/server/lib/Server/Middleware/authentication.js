// Do not modify this file unless you know what you are doing.
// This file contains critical code for the authentication process for incoming requests.
// Modifying this file can lead to security vulnerabilities and should only be done by experienced developers.

const { validateAccessToken, generateAccessToken } = require("../../Utils/Core/TokenManagement/AccessTokens");
const { getIp } = require("../../Utils/Ip");
const { respondWithError } = require("../Response/response");
const { validateRefreshToken } = require("../../Utils/Core/TokenManagement/RefreshTokens");
const { validateNoAuthToken } = require("../../Utils/Core/SecurityManagment/NoAuthToken");
const { defaultServerRoutes } = require("../Endpoints");
const { globalAccessPoint } = require("../../Utils/GlobalAccessPoint");

const tokenTypes = [
    "ACCESS_BEARER",
    "REFRESH_BEARER",
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

        const token = authHeader.split(" ")[1] || "NONE";
        const tokenType = authHeader.split(" ")[0];

        let authRequired = true;
        let setBy;

        const endpoint = defaultServerRoutes.endpoints.find(item => item.path === parameters.request.path);
        const endpointBackUp = globalAccessPoint.getValue("systemConfig").api.customEndpoints.find(item => item.path === parameters.request.path);

        if (!endpoint && !endpointBackUp && parameters.path.split("/")[parameters.path.split("/").length -1] !== "refresh-access-token-blind") {
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

        if (token === "NONE" && tokenType !== "NO_BEARER" && tokenType !== "NO_AUTH_BEARER") {
            return respondWithError(parameters.response , "MISSING-AUTHENTICATION-TOKEN")
        }

        if (!tokenTypes.includes(tokenType)) {
            return respondWithError(parameters.response , "INVALID-AUTHENTICATION-TOKEN-TYPE")
        }

        switch (tokenType) {
            case "ACCESS_BEARER":
                const verification = await validateAccessToken(token , parameters.request.cookies , fingerprint , ip);

                if (verification.error || !verification.valid) {
                    return respondWithError(parameters.response , verification.errorCode)
                }

                parameters.request.user = verification.data;

                return next();

            case "REFRESH_BEARER":
                const refreshVerification = await validateRefreshToken(token , fingerprint , ip);

                if (refreshVerification.error || !refreshVerification.valid) {
                    return respondWithError(parameters.response , refreshVerification.errorCode)
                }

                const newAccessToken = await generateAccessToken(refreshVerification.data.uid , refreshVerification.data.email , refreshVerification.data.hashedDeviceFingerprint , refreshVerification.data.authMethod , refreshVerification.data.role , ip , userAgent , refreshVerification.data.tokenData.accessTokenLinkCode);

                if (newAccessToken.error) {
                    return respondWithError(parameters.response , newAccessToken.errorCode);
                }

                if(newAccessToken.cookies){
                    for (let i = 0; i < newAccessToken.cookies.length; i++) {
                        const cookie = newAccessToken.cookies[i];
                        parameters.response.cookie(cookie.key, JSON.stringify(cookie.data) , { httpOnly: true , secure: true , sameSite: "None" , maxAge: cookie.maxAge });
                    }
                }

                parameters.response.cookie(refreshVerification.data.cookieKey, "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

                return parameters.response.status(200).json({ accessTokenRefreshed: true , accessToken: newAccessToken.token });

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

                console.log("No auth token Response: " , noAuthVerification);

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