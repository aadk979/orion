import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { verifyHash, generateHmac } from '../../CryptoFunctions.js';
import { parseDuration } from '../../Date&Time.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { getIp } from '../../Ip.js';
import { sanitizeString } from '../../Sanitizer.js';
import { tryCatch } from '../../TryCatch.js';
import { isValidEmail } from '../../Validator.js';
import { generateId } from '../../valueGenerator.js';
import { generateAccessToken } from '../TokenManagement/AccessTokens.js';
import { generateRefreshToken } from '../TokenManagement/RefreshTokens.js';
import { stringifyCookieData } from '../../CookieUtils.js';

const signInWithPassword = async (email, password, fingerprint, ip, userAgent) => {
    const Function = async (parameters) => {
        const systemConfig = globalAccessPoint.getValue("systemConfig");

        if (!systemConfig.authMethods.emailPassword) {
            return { error: true, errorCode: "ACC-SIGN-IN-EMAIL-PASSWORD-DISABLED" }
        }
        
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

        if (!user.data.credentials.password) {
            return { error: true, errorCode: "ACC-SIGN-IN-NO-PASSWORD-SETUP" }
        }

        const passwordMatch = await verifyHash(sanitizedPassword, user.data.credentials.password);

        if(!passwordMatch) {
            return { error: true, errorCode: "ACC-SIGN-IN-INVALID-PASSWORD" };
        }

        const accessToken = await generateAccessToken(user.data.credentials.uid , sanitizedEmail , parameters.fingerprint , "PASSWORD" , "USER" , parameters.ip , parameters.userAgent);

        if(accessToken.error){
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(user.data.credentials.uid , sanitizedEmail , parameters.fingerprint , "PASSWORD" , "USER" , parameters.ip, parameters.userAgent , accessToken.accessTokenLinkCode);

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

        return { error: false, data: response , completed: true, cookies: [...tokenCookies] };
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

    if (callback?.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), { httpOnly: true, secure: true, sameSite: "None", maxAge: cookie.maxAge });
        }
    }
    
    delete callback.cookies

    return respondWithSuccess(response , 200 , callback);
}

export { signInWithPassword , routeHandlerSignInWithPassword };