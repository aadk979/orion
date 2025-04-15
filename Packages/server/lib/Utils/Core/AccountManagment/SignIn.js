const { respondWithError, respondWithSuccess } = require("../../../Server/Response/response");
const { verifyHash } = require("../../CryptoFunctions");
const { globalAccessPoint } = require("../../GlobalAccessPoint");
const { getIp } = require("../../Ip");
const { sanitizeString } = require("../../Sanitizer");
const { tryCatch } = require("../../TryCatch");
const { isValidEmail } = require("../../Validator");
const { generateAccessToken } = require("../TokenManagement/AccessTokens");
const { generateRefreshToken } = require("../TokenManagement/RefreshTokens");

const signInWithPassword = async (email, password, fingerprint, ip, userAgent) => {
    const Function = async (parameters) => {
        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);
        const sanitizedPassword = sanitizeString(parameters.password);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            return { error: true, errorCode: "ACC-SIGN-IN-INVALID-EMAIL" }
        }

        const userExist = await globalAccessPoint.db().getData("Users-email", sanitizedEmail);

        if (userExist.data === undefined) {
            return { error: true, errorCode: "ACC-SIGN-IN-ACC-NO-EXISTS" };
        }

        const user = await globalAccessPoint.db().getData("Users", userExist.data.uid);

        const passwordMatch = await verifyHash(sanitizedPassword, user.data.credentials.password);

        if(!passwordMatch) {
            return { error: true, errorCode: "ACC-SIGN-IN-INVALID-PASSWORD" };
        }

        const accessToken = await generateAccessToken(user.data.credentials.uid , sanitizedEmail , parameters.fingerprint , "PASSWORD" , "USER" , parameters.ip , parameters.userAgent);

        if(accessToken.error){
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(user.data.credentials.uid , sanitizedEmail , parameters.fingerprint , "PASSWORD" , "USER" , parameters.ip, accessToken.cookies[0] , parameters.userAgent);

        if(refreshToken.error){
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            accessToken: accessToken.token,
            refreshToken: refreshToken.token,
            cookies: accessToken.cookies
        }

        return { error: false, data: response , completed: true };
    }

    const parameters = {
        email: email,
        password: password,
        fingerprint: fingerprint,
        ip: ip,
        userAgent
    }

    const result = await tryCatch(Function, true, parameters);

    return result;
}

const routeHandlerSignInWithPassword = async (request , response) => {
    const packet = request.body.packet;

    const email = packet.email;
    const password = packet.password;

    const ip = getIp(request);
    const fingerprint = request.headers["orion-fingerprint"];
    const userAgent = request.headers["orion-user-agent"];

    const callback = await signInWithPassword(email , password, fingerprint, ip , userAgent);

    if(callback.error) {
        return respondWithError(response , callback.errorCode)
    }

    if(callback.cookies){
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, cookie.data , { httpOnly: true , secure: true , sameSite: "Strict" , maxAge: cookie.maxAge });
        }
    }

    return respondWithSuccess(response , 200 , callback);
}

module.exports = { signInWithPassword , routeHandlerSignInWithPassword };