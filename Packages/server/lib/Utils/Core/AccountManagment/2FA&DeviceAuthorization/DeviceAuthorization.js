import { cronScheduler } from '../../../Cron.js';
import { hashString, verifyHash } from '../../../CryptoFunctions.js';
import { isUnixExpired, getFutureUnixTime } from '../../../Date&Time.js';
import { getDeviceDetails } from '../../../Device.js';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { getIpRange, isIpInRange } from '../../../Ip.js';
import { generateAndSendMail } from '../../../Mail/sendMail.js';
import { tryCatch } from '../../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateRandomNumber, generateRequestId, generateChallenge, generateId } from '../../../valueGenerator.js';
import { parseCookieData } from '../../../CookieUtils.js';

const isDeviceRecognizedForUserUID = async (uid, userAgent, deviceId, code) => {
    if (!code || !deviceId) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    const cleanDeviceId = parseCookieData(deviceId);
    const cleanCode = parseCookieData(code);

    const user = await globalAccessPoint.db().getData("Users", uid);

    if (user.data == undefined) {
        return { error: true, errorCode: "ACC-SIGN-IN-ACC-NO-EXISTS" }
    }

    const devices = user.data.security.recognizedDevices || [];
    const activeDevices = devices.filter(item => !isUnixExpired(item.exp));
    const device = activeDevices.find(item => item.deviceId === cleanDeviceId);

    if (!device) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    if (!(await verifyHash(cleanCode, device.deviceCodeHash))) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    if (!(await verifyHash(userAgent, device.userAgentHash))) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" }
    }

    return { error: false, valid: true };
};

const isDeviceRecognizedForUserEmail = async (email, userAgent, deviceId, code) => {
    if (!code || !deviceId) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    const cleanDeviceId = parseCookieData(deviceId);
    const cleanCode = parseCookieData(code);

    const userEmailLink = await globalAccessPoint.db().getData("Users-email", email);

    if (userEmailLink.data == undefined) {
        return { error: true, errorCode: "ACC-SIGN-IN-ACC-NO-EXISTS" }
    }

    const user = await globalAccessPoint.db().getData("Users", userEmailLink.data.uid);
    const devices = user.data.security.recognizedDevices || [];
    const activeDevices = devices.filter(item => !isUnixExpired(item.exp));

    const device = activeDevices.find(item => item.deviceId === cleanDeviceId);

    if (!device) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    if (!(await verifyHash(cleanCode, device.deviceCodeHash))) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    if (!(await verifyHash(userAgent, device.userAgentHash))) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" }
    }

    return { error: false, valid: true };
};

const sendDeviceAuthorizationMail = async (email, fingerprint, ip, userAgent) => {
    const Function = async (parameters) => {
        const to = parameters.email;

        const userExist = await globalAccessPoint.db().getData("Users-email", to);

        if (userExist.data == undefined) {
            return { error: true, errorCode: "ACC-SIGN-IN-ACC-NO-EXISTS" }
        }

        const code = generateRandomNumber(6);

        const codeHash = await hashString(code);

        const reqId = generateRequestId("DEVICE_AUTHORIZATION", 52);

        const payload = {
            codeHash,
            fingerprintHash: await hashString(parameters.fingerprint),
            ip: getIpRange(parameters.ip),
            userAgent: parameters.userAgent,
            email: parameters.email
        }

        await globalAccessPoint.db().addData("DeviceAuthorizationRequests", reqId, payload);

        const deletionFunction = async (parameters) => {
            await globalAccessPoint.db().deleteData("DeviceAuthorizationRequests", parameters.reqId);
        }

        const parametersInternal = {
            reqId
        }

        cronScheduler.addEvent(reqId, deletionFunction, "15m", parametersInternal);

        const send = await generateAndSendMail(1, to, { EMAIL: to, CODE: code, IP: parameters.ip, USERAGENT: parameters.userAgent, MODEL: getDeviceDetails(parameters.userAgent).device.model || "Unkown Device" });

        if (send.error) {
            cronScheduler.cancelEvent(reqId);
            await deletionFunction(parametersInternal);

            return { error: true, errorCode: "UNABLE-TO-SEND-DEVICE-AUTHORIZATION-EMAIL" };
        }

        return { error: false, sent: true, reqId };
    }

    const parameters = {
        email,
        fingerprint,
        ip,
        userAgent
    }

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'sendDeviceAuthorizationMail', functionSource);

    return results;
}

const authorizeDeviceDirect = async (email, uid, userAgent) => {
    const Function = async (parameters) => {
        let user = undefined;
        let UID = undefined;

        if (parameters.uid) {
            const iUser = await globalAccessPoint.db().getData("Users", parameters.uid);

            user = iUser;
            UID = parameters.uid;
        }

        if (parameters.email) {
            const UserLink = await globalAccessPoint.db().getData("Users-email", parameters.email);

            if (UserLink.data !== undefined) {
                const iUser = await globalAccessPoint.db().getData("Users", UserLink.data.uid);

                user = iUser;
                UID = UserLink.data.uid;
            }
        }

        const authorizedDevices = user.data.security.recognizedDevices;
        const cleanedAuthorizedDevices = [];

        for (const item of authorizedDevices) {
            if (!isUnixExpired(item.exp)) {
                if (!(await verifyHash(parameters.userAgent, item.userAgentHash))) {
                    cleanedAuthorizedDevices.push(item);
                }
            }
        }

        const deviceId = generateId("DEVICE_ID", 32);
        const code = generateChallenge(64);

        const newDevice = {
            exp: getFutureUnixTime("7d"),
            deviceCodeHash: await hashString(code),
            userAgentHash: await hashString(parameters.userAgent),
            deviceId
        }

        cleanedAuthorizedDevices.push(newDevice);

        user.data.security.recognizedDevices = cleanedAuthorizedDevices;

        await globalAccessPoint.db().addData("Users", UID, user.data);

        return { error: false, cookies: [ { key: "authorizedDeviceCode", data: code, maxAge: 7 * 24 * 60 * 60 * 1000 }, { key: "authorizedDeviceId", data: deviceId, maxAge: 7 * 24 * 60 * 60 * 1000 } ] }
    }

    const parameters = {
        email,
        uid,
        userAgent    
    }

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'authorizeDeviceDirect', functionSource);

    return results;
}

const authorizeDeviceWithCode = async (reqID, code, fingerprint, ip, userAgent) => {
    const Function = async (parameters) => {
        const storedData = await globalAccessPoint.db().getData("DeviceAuthorizationRequests", parseCookieData(parameters.reqID));

        if (storedData.data === undefined) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-AUTHORIZATION-REQUEST-EXPIRED" };
        }

        if (parameters.userAgent !== storedData.data.userAgent) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-USERAGENT-MISMATCH" }
        }

        if (! (await isIpInRange(parameters.ip, storedData.data.ip))) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-IP-MISMATCH" }
        }

        if (! (await verifyHash(parameters.fingerprint, storedData.data.fingerprintHash))) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-FINGERPRINT-MISMATCH" }
        }

        if (! (await verifyHash(parameters.code, storedData.data.codeHash))) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-INVALID-CODE" }
        }

        const authorization = await authorizeDeviceDirect(storedData.data.email, undefined, parameters.userAgent);

        if (authorization.error) {
            return authorization;
        }

        return { error: false, cookies: authorization.cookies };
    }

    const parameters = {
        reqID,
        code,
        fingerprint,
        ip,
        userAgent
    }

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'authorizeDeviceWithCode', functionSource);

    return results;
}

export { sendDeviceAuthorizationMail, authorizeDeviceWithCode, isDeviceRecognizedForUserEmail, isDeviceRecognizedForUserUID };