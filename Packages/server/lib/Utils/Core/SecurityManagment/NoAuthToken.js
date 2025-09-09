const { respondWithError, respondWithSuccess } = require("../../../Server/Response/response")
const { hashString, verifyHash } = require("../../CryptoFunctions")
const { getFutureUnixTime, getCurrentUnixTime } = require("../../Date&Time")
const { globalAccessPoint } = require("../../GlobalAccessPoint")
const { getIp } = require("../../Ip")
const { tryCatch } = require("../../TryCatch")
const { generateRequestId } = require("../../valueGenerator")
const svgCaptcha = require("ppfun-captcha")
const crypto = require("crypto")
const { cronScheduler } = require("../../Cron")
const { verifyCaptcha, generateCaptchaImage } = require("../../CustomCaptchaSystem")

const captchaSystemVersion = "[orion:v1]-[1.0.0]-[BETA]"

const deletionFunction = async (parameters) => {
    await globalAccessPoint.db().deleteData(parameters.collection , parameters.docId);
}

const generateNoAuthTokenCreationTransaction = async (ip, fingerprint, userAgent) => {
    const Function = async (parameters) => {
        const transactionId = generateRequestId("NO_AUTH_TOKEN_CREATION_TRANSACTION");

        const captcha = await generateCaptchaImage();

        const payload = {
            ip: parameters.ip,
            fingerprint: parameters.fingerprint,
            userAgent: parameters.userAgent,
            captchaCode: captcha.hashedCode,
            captchaSystemVersion: captchaSystemVersion,
        }

        const storage = await globalAccessPoint.db().addData("noAuthTokenCreationTransactions", transactionId, payload);

        if (storage.error) {
            return { error: true, errorCode: storage.errorCode }
        }

        cronScheduler.addEvent(transactionId, deletionFunction, "5m" , { collection: "noAuthTokenCreationTransactions", docId: transactionId });

        return { error: false, transactionId: transactionId , captchaBase64Img: captcha.imageBase64 , captchaSystemVersion: captchaSystemVersion };
    }

    const parameters = {
        ip: ip,
        fingerprint: await hashString(fingerprint),
        userAgent: userAgent
    }

    const result = await tryCatch(Function, true, parameters)
    return result;
}

const routeHandlerGenerateNoAuthTokenCreationTransaction = async (request, response) => {
    const ip = getIp(request);
    const fingerprint = request.headers["orion-fingerprint"];
    const userAgent = request.headers["orion-user-agent"];

    const callback = await generateNoAuthTokenCreationTransaction(ip, fingerprint, userAgent);

    if (callback.error) {
        return respondWithError(response, callback?.errorCode);
    }

    return respondWithSuccess(response, 200, callback);
}

async function sha256(message) {
    return crypto
        .createHash('sha256')
        .update(Buffer.from(message, 'utf8'))
        .digest('hex');
}

const generateNoAuthToken = async (ip, fingerprint, userAgent, recaptchaResponse, transactionId) => {
    const Function = async (parameters) => {
        const startTime = parameters.recaptchaResponse.startTime;
        const endTime = parameters.recaptchaResponse.endTime;

        if (endTime - startTime < 35) {
            return { error: true, errorCode: "INVALID-CAPTCHA-RESPONSE" };
        }

        const transactionStorage = await globalAccessPoint.db().getData("noAuthTokenCreationTransactions", parameters.transactionId);

        if (transactionStorage.data === undefined) {
            return { error: true, errorCode: "INVALID-CAPTCHA-TRANSACTION-ID" };
        }

        if (transactionStorage.data.captchaSystemVersion !== captchaSystemVersion) {
            return { error: true, errorCode: "CAPTCHA-SYSTEM-VERSION-ERROR" };
        }

        if (transactionStorage.data.ip !== parameters.ip) {
            await deletionFunction({ collection: "noAuthTokenCreationTransactions", docId: parameters.transactionId });
            return { error: true, errorCode: "INVALID-CAPTCHA-TRANSACTION-IP" };
        }

        if (!(await verifyHash(parameters.fingerprint, transactionStorage.data.fingerprint))) {
            await deletionFunction({ collection: "noAuthTokenCreationTransactions", docId: parameters.transactionId });
            return { error: true, errorCode: "INVALID-CAPTCHA-TRANSACTION-FINGERPRINT" };
        }

        if (transactionStorage.data.userAgent !== parameters.userAgent) {
            await deletionFunction({ collection: "noAuthTokenCreationTransactions", docId: parameters.transactionId });
            return { error: true, errorCode: "INVALID-CAPTCHA-TRANSACTION-USERAGENT" };
        }

        if (!(await verifyCaptcha(parameters.recaptchaResponse.captchaCode, transactionStorage.data.captchaCode))) {
            await deletionFunction({ collection: "noAuthTokenCreationTransactions", docId: parameters.transactionId });
            return { error: true, errorCode: "INVALID-CAPTCHA-CODE" };
        }

        const systemConfig = globalAccessPoint.getValue("systemConfig");

        const exp = getFutureUnixTime("1d");

        const combinedString = `${ip}-${fingerprint}-${userAgent}-${exp}-${systemConfig.serviceID}`;

        const sha256Hash = await sha256(combinedString);
        const token = `${"NO_AUTH_TOKEN"}-${sha256Hash}-${exp}`;

        return { error: false , success: true , cookies: [{ key: "NO_AUTH_TOKEN", data: token, maxAge: 86400000 }]};
    }

    const parameters = {
        ip: ip,
        fingerprint: fingerprint,
        userAgent: userAgent,
        recaptchaResponse: recaptchaResponse,
        transactionId: transactionId
    }

    const result = await tryCatch(Function, true, parameters)
    return result;
}

const routeHandlerGenerateNoAuthToken = async (request, response) => {
    const packet = request.body.packet;

    const recaptchaResponse = packet.recaptchaResponse || "NONE";
    const ip = getIp(request);
    const fingerprint = request.headers["orion-fingerprint"];
    const userAgent = request.headers["orion-user-agent"];
    const transactionId = packet.transactionId || "NONE";

    const callback = await generateNoAuthToken(ip, fingerprint, userAgent, recaptchaResponse, transactionId);

    if (callback.error) {
        return respondWithError(response, callback?.errorCode);
    }

    if (callback.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, JSON.stringify(cookie.data), { httpOnly: true, secure: true, sameSite: "None", maxAge: cookie.maxAge });
        }
    }

    delete callback.cookies;

    return respondWithSuccess(response, 200, callback);
}

const validateNoAuthToken = async (token , ip , fingerprint , userAgent) => {
    const Function = async (parameters) => {
        const tokenParts = parameters.token.split("-");

        if (tokenParts.length !== 3) {
            return { error: true, errorCode: "INVALID-NO-AUTH-TOKEN" };
        }

        const tokenType = tokenParts[0];
        const tokenHash = tokenParts[1];
        const tokenExpiryTime = parseInt(tokenParts[2], 10);

        if (tokenType !== "NO_AUTH_TOKEN") {
            return { error: true, errorCode: "INVALID-NO-AUTH-TOKEN" };
        }

        if (getCurrentUnixTime() > tokenExpiryTime) {
            return { error: true, errorCode: "EXPIRED-NO-AUTH-TOKEN" };
        }

        const systemConfig = globalAccessPoint.getValue("systemConfig");

        const hashString = `${ip}-${fingerprint}-${userAgent}-${tokenExpiryTime}-${systemConfig.serviceID}`;
        const sha256Hash = await sha256(hashString);

        if (sha256Hash !== tokenHash) {
            return { error: true, errorCode: "INVALID-NO-AUTH-TOKEN" };
        }

        return { error: false, valid: true };
    }

    const parameters = {
        token: token
    }

    const result = await tryCatch(Function, true, parameters)
    return result;
}

const routeHandlerDeviceHasNoAuthToken = async (request , response) => {
    const authHeader = request.headers["authorization"] || "DEFAULT NONE";
    const tokenType = authHeader.split(" ")[0];

    if( tokenType !== "NO_BEARER" ){
        return respondWithError(response , "NO_AUTH_TOKEN-UNAUTHORIZED");
    }

    const token = request.cookies["NO_AUTH_TOKEN"] ? JSON.parse(request.cookies["NO_AUTH_TOKEN"]) : "NONE";

    if( token === "NONE" ){
        return respondWithError(response , "NO_AUTH_TOKEN-NOT-FOUND");
    }

    const fingerprint = request.headers["orion-fingerprint"];
    const userAgent = request.headers["orion-user-agent"];
    const ip = getIp(request);

    const verification = await validateNoAuthToken(token , ip , fingerprint , userAgent);

    if( verification.error || !verification.valid ){
        return respondWithError(response , verification.errorCode);
    }

    return respondWithSuccess(response , 200 , { valid: true });
}

module.exports = { routeHandlerGenerateNoAuthTokenCreationTransaction , routeHandlerGenerateNoAuthToken , validateNoAuthToken , routeHandlerDeviceHasNoAuthToken };