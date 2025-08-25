const { cronScheduler } = require("../../../Cron");
const { hashString, verifyHash } = require("../../../CryptoFunctions");
const { isUnixExpired, getFutureUnixTime } = require("../../../Date&Time");
const { getDeviceDetails } = require("../../../Device");
const { globalAccessPoint } = require("../../../GlobalAccessPoint");
const { getIpRange, isIpInRange } = require("../../../Ip");
const { generateAndSendMail } = require("../../../Mail/sendMail");
const { tryCatch } = require("../../../TryCatch");
const { generateRandomNumber, generateRequestId, generateChallenge } = require("../../../valueGenerator");

const userRequires2FA = (user) => {
    return !!user.security.twoFA;
};

const isDeviceRecognizedForUserUID = async (uid, userAgent, code) => {
    if (!code) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    const user = await globalAccessPoint.db().getData("Users", uid);

    const devices = user.security.recognizedDevices || [];

    const activeDevices = devices.filter(item => !isUnixExpired(item.exp));

    for (const device of activeDevices) {
        const match = await verifyHash(code, device.deviceCodeHash);
        if (match) {

            if (!await verifyHash(userAgent, device.userAgentHash)) {
                return { error: true, errorCode: "DEVICE-UNRECOGNIZED" }
            }

            return { error: false };
        }
    }

    return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
};

const isDeviceRecognizedForUserEmail = async (email, userAgent, code) => {
    const userEmailLink = await globalAccessPoint.db().getData("Users-email", email);

    if (!code) {
        return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
    }

    const user = await globalAccessPoint.db().getData("Users", userEmailLink.uid);

    const devices = user.security.recognizedDevices || [];

    const activeDevices = devices.filter(item => !isUnixExpired(item.exp));

    for (const device of activeDevices) {
        const match = await verifyHash(code, device.deviceCodeHash);
        if (match) {

            if (!await verifyHash(userAgent, device.userAgentHash)) {
                return { error: true, errorCode: "DEVICE-UNRECOGNIZED" }
            }

            return { error: false };
        }
    }

    return { error: true, errorCode: "DEVICE-UNRECOGNIZED" };
};

const sendDeviceAuthorizationMail = async (email, fingerprint, ip, userAgent) => {
    const Function = async (parameters) => {
        const to = parameters.email;

        const code = generateRandomNumber(6);

        const codeHash = await hashString(code);

        const reqID = generateRequestId("DEVICE_AUTHORIZATION", 52);

        const payload = {
            codeHash,
            fingerprintHash: await hashString(parameters.fingerprint),
            ip: getIpRange(parameters.ip),
            userAgent: parameters.userAgent,
            email: parameters.email
        }

        await globalAccessPoint.db().addData("DeviceAuthorizationRequests", reqID, payload);

        const deletionFunction = async (parameters) => {
            await globalAccessPoint.db().deleteData("DeviceAuthorizationRequests", parameters.reqID);
        }

        const parametersInternal = {
            reqID
        }

        cronScheduler.addEvent(reqID, deletionFunction, "15m", parametersInternal);

        const send = await generateAndSendMail(1, to, { EMAIL: to, CODE: code, IP: parameters.ip, USERAGENT: parameters.userAgent, MODEL: getDeviceDetails(parameters.userAgent).model || "Unkown" });

        if (send.error) {
            cronScheduler.cancelEvent(reqID);
            await deletionFunction(parametersInternal);

            return { error: true, errorCode: "UNABLE-TO-SEND-DEVICE-AUTHORIZATION-EMAIL" };
        }

        return { error: false, sent: true, reqID };
    }

    const parameters = {
        email,
        fingerprint,
        ip,
        userAgent
    }

    const results = await tryCatch(Function, true, parameters);

    return results;
}

const authorizeDeviceDirect = async (email, uid, userAgent) => {
    const Function = async (parameters) => {
        let user = null;
        let UID = null;

        if (parameters?.uid) {
            const iUser = await globalAccessPoint.db().getData("Users", parameters.uid);

            user = iUser;
            UID = parameters.uid;
        }

        if (parameters?.email) {
            const UserLink = await globalAccessPoint.db().getData("Users-email", parameters.email);

            if (UserLink.data === undefined) {
                user = UserLink;
            }

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
                if (!await verifyHash(parameters.userAgent, item.userAgentHash)) {
                    cleanedAuthorizedDevices.push(item);
                }
            }
        }

        const code = generateChallenge(64);

        const newDevice = {
            exp: getFutureUnixTime("14d"),
            deviceCodeHash: await hashString(code),
            userAgentHash: await hashString(userAgent)
        }

        cleanedAuthorizedDevices.push(newDevice);

        user.data.security.recognizedDevices = cleanedAuthorizedDevices;

        await globalAccessPoint.db().addData("Users", UID, user);

        return { error: false, cookies: [ { key: "authorizedDeviceCodeNonTrackable", value: code, maxAge: 14 * 24 * 60 * 60 * 1000 } ] }
    }

    const parameters = {
        email,
        uid,
        email
    }

    const results = await tryCatch(Function, true, parameters);

    return results;
}

const authorizeDeviceWithCode = async (reqID, code, fingerprint, ip, userAgent) => {
    const Function = async (parameters) => {
        const storedData = await globalAccessPoint.db().getData("DeviceAuthorizationRequests", parameters.reqID);

        if (storedData.data === undefined) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-AUTHORIZATION-REQUEST-EXPIRED" };
        }

        if (parameters.userAgent !== storedData.data.userAgent) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-USERAGENT-MISMATCH" }
        }

        if (!isIpInRange(parameters.ip, storedData.data.ip)) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-IP-MISMATCH" }
        }

        if (! await verifyHash(parameters.fingerprint, storedData.data.fingerprintHash)) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-FINGERPRINT-MISMATCH" }
        }

        if (! await verifyHash(parameters.code, storedData.data.codeHash)) {
            return { error: true , errorCode: "DEVICE-AUTHORIZATION-INVALID-CODE" }
        }

        const authorization = await authorizeDeviceDirect(storedData.email, null, parameters.userAgent);

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

    const results = await tryCatch(Function, true, parameters);

    return results;
}

module.exports = { sendDeviceAuthorizationMail, userRequires2FA, authorizeDeviceWithCode, isDeviceRecognizedForUserEmail, isDeviceRecognizedForUserUID }