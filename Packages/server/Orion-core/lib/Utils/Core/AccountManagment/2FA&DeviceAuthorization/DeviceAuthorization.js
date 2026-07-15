import { cronScheduler } from '../../../Cron.js';
import { hashString, verifyHash } from '../../../CryptoFunctions.js';
import { isUnixExpired, getFutureUnixTime } from '../../../Date&Time.js';
import { getDeviceDetails } from '../../../Device.js';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { UserModel, DeviceModel, RequestModel } from '../../../Databases/models/index.js';
import { getIpRange, isIpInRange } from '../../../Ip.js';
import { generateAndSendMail } from '../../../Mail/sendMail.js';
import { tryCatch } from '../../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateRandomNumber, generateRequestId, generateChallenge, generateId } from '../../../valueGenerator.js';
import { parseCookieData } from '../../../CookieUtils.js';

const cleanUpDevices = async uid => {
    const Function = async parameters => {
        await DeviceModel.removeExpiredDevices(parameters.uid);
        return { error: false, completed: true };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);

    return await tryCatch(Function, false, parameters, 'cleanUpDevices', functionSource);
};

const isDeviceRecognizedForUserUID = async (uid, userAgent, deviceId, code) => {
    if (!code || !deviceId) {
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    const cleanDeviceId = parseCookieData(deviceId);
    const cleanCode = parseCookieData(code);

    const userExists = await UserModel.uidExists(uid);

    if (!userExists) {
        return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
    }

    const activeRefs = await DeviceModel.getActiveDeviceRefs(uid);
    const deviceRef = activeRefs.find(item => item.device_id === cleanDeviceId);

    if (!deviceRef) {
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    const device = await DeviceModel.getDevice(deviceRef.device_id);

    if (!device) {
        // Ghost ref — clean it up
        await DeviceModel.removeDeviceRef(uid, deviceRef.device_id);
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    if (!(await verifyHash(cleanCode, device.device_code_hash))) {
        await DeviceModel.deleteDevice(device.device_id);
        await DeviceModel.removeDeviceRef(uid, device.device_id);
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    if (!(await verifyHash(userAgent, device.user_agent_hash))) {
        await DeviceModel.deleteDevice(device.device_id);
        await DeviceModel.removeDeviceRef(uid, device.device_id);
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    return { error: false, valid: true };
};

const isDeviceRecognizedForUserEmail = async (email, userAgent, deviceId, code) => {
    if (!code || !deviceId) {
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    const cleanDeviceId = parseCookieData(deviceId);
    const cleanCode = parseCookieData(code);

    const uid = await UserModel.getUidByEmail(email);

    if (!uid) {
        return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
    }

    const activeRefs = await DeviceModel.getActiveDeviceRefs(uid);
    const deviceRef = activeRefs.find(item => item.device_id === cleanDeviceId);

    if (!deviceRef) {
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    const device = await DeviceModel.getDevice(deviceRef.device_id);

    if (!device) {
        await DeviceModel.removeDeviceRef(uid, deviceRef.device_id);
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    if (!(await verifyHash(cleanCode, device.device_code_hash))) {
        await DeviceModel.deleteDevice(device.device_id);
        await DeviceModel.removeDeviceRef(uid, device.device_id);
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    if (!(await verifyHash(userAgent, device.user_agent_hash))) {
        await DeviceModel.deleteDevice(device.device_id);
        await DeviceModel.removeDeviceRef(uid, device.device_id);
        return { error: true, errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p' };
    }

    return { error: false, valid: true };
};

const sendDeviceAuthorizationMail = async (email, ip, userAgent) => {
    const Function = async parameters => {
        const to = parameters.email;

        const uid = await UserModel.getUidByEmail(to);

        if (!uid) {
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
        }

        const code = generateRandomNumber(6);

        const codeHash = await hashString(code);

        const reqId = generateRequestId('DEVICE_AUTHORIZATION', 52);

        const flowSecret = generateChallenge(32);
        const hashedFlowSecret = await hashString(flowSecret);

        await RequestModel.createDeviceAuthRequest(reqId, {
            codeHash,
            hashedFlowSecret,
            ip: getIpRange(parameters.ip),
            userAgentHash: await hashString(parameters.userAgent),
            email: parameters.email
        });

        const deletionFunction = async parameters => {
            await RequestModel.deleteDeviceAuthRequest(parameters.reqId);
        };

        const parametersInternal = { reqId };

        cronScheduler.addEvent(reqId, deletionFunction, '15m', parametersInternal);

        const send = await generateAndSendMail(1, to, {
            EMAIL: to,
            CODE: code,
            IP: parameters.ip,
            USERAGENT: parameters.userAgent,
            MODEL: getDeviceDetails(parameters.userAgent).device.model || 'Unkown Device'
        });

        if (send.error) {
            cronScheduler.cancelEvent(reqId);
            await deletionFunction(parametersInternal);

            return { error: true, errorCode: 'DEVICE-AUTH::EMAIL-SEND-FAILED::A::i' };
        }

        return { error: false, sent: true, reqId, flowSecret };
    };

    const parameters = {
        email,
        ip,
        userAgent
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'sendDeviceAuthorizationMail', functionSource);

    return results;
};

const authorizeDeviceDirect = async (email, uid, userAgent) => {
    const Function = async parameters => {
        let UID = parameters.uid;

        if (!UID && parameters.email) {
            UID = await UserModel.getUidByEmail(parameters.email);
            if (!UID) {
                return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
            }
        }

        // Get current active device refs and clean stale ones
        const allRefs = await DeviceModel.getActiveDeviceRefs(UID);
        const cleanedRefs = [];

        for (const ref of allRefs) {
            const device = await DeviceModel.getDevice(ref.device_id);

            if (device && device.user_agent_hash) {
                if (!(await verifyHash(parameters.userAgent || '', device.user_agent_hash))) {
                    cleanedRefs.push(ref);
                } else {
                    // Same user agent — remove old device for this agent
                    await DeviceModel.deleteDevice(ref.device_id);
                    await DeviceModel.removeDeviceRef(UID, ref.device_id);
                }
            } else if (!device) {
                // Ghost ref — drop it
                await DeviceModel.removeDeviceRef(UID, ref.device_id);
            } else {
                cleanedRefs.push(ref);
            }
        }

        const deviceId = generateId('DEVICE_ID', 32);
        const code = generateChallenge(32);
        const exp = getFutureUnixTime('7d');

        // Create the device
        await DeviceModel.createDevice({
            deviceId,
            uid: UID,
            deviceCodeHash: await hashString(code),
            userAgentHash: await hashString(parameters.userAgent),
            expiry: exp
        });

        // Add lightweight ref
        await DeviceModel.addDeviceRef(UID, deviceId, exp);

        // Clean up expired devices asynchronously
        cleanUpDevices(UID);

        return {
            error: false,
            cookies: [
                { key: 'authorizedDeviceCode', data: code, maxAge: 7 * 24 * 60 * 60 * 1000 },
                { key: 'authorizedDeviceId', data: deviceId, maxAge: 7 * 24 * 60 * 60 * 1000 }
            ]
        };
    };

    const parameters = {
        email,
        uid,
        userAgent
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'authorizeDeviceDirect', functionSource);

    return results;
};

const authorizeDeviceWithCode = async (reqID, code, flowSecret, ip, userAgent) => {
    const Function = async parameters => {
        const storedData = await RequestModel.getDeviceAuthRequest(parseCookieData(parameters.reqID));

        if (!storedData) {
            return { error: true, errorCode: 'DEVICE-AUTH::REQUEST-EXPIRED::A::p' };
        }

        if (!(await verifyHash(parameters.userAgent, storedData.user_agent_hash))) {
            return { error: true, errorCode: 'DEVICE-AUTH::USERAGENT-MISMATCH::A::p' };
        }

        if (!(await isIpInRange(parameters.ip, storedData.ip_range))) {
            return { error: true, errorCode: 'DEVICE-AUTH::IP-MISMATCH::A::p' };
        }

        if (!(await verifyHash(parameters.flowSecret, storedData.hashed_flow_secret))) {
            return { error: true, errorCode: 'DEVICE-AUTH::FLOW-SECRET-MISMATCH::A::p' };
        }

        if (!(await verifyHash(parameters.code, storedData.code_hash))) {
            return { error: true, errorCode: 'DEVICE-AUTH::INVALID-CODE::A::p' };
        }

        const authorization = await authorizeDeviceDirect(storedData.email, undefined, parameters.userAgent);

        if (authorization.error) {
            return authorization;
        }

        return { error: false, cookies: authorization.cookies };
    };

    const parameters = {
        reqID,
        code,
        flowSecret,
        ip,
        userAgent
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'authorizeDeviceWithCode', functionSource);

    return results;
};

export { sendDeviceAuthorizationMail, authorizeDeviceWithCode, isDeviceRecognizedForUserEmail, isDeviceRecognizedForUserUID, authorizeDeviceDirect };
