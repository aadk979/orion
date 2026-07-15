import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, TOTPModel, PasskeyModel, UserSecurityModel, RequestModel } from '../../Databases/models/index.js';
import { getIp, getIpRange, isIpInRange } from '../../Ip.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateRandomNumber, generateRequestId } from '../../valueGenerator.js';
import { generateAndSendMail } from '../../Mail/sendMail.js';
import { cronScheduler } from '../../Cron.js';
import { parseCookieData, stringifyCookieData } from '../../CookieUtils.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { getDeviceDetails } from '../../Device.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'Remove2FAMethod.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'Remove2FAMethod.js');


const VALID_METHODS = ['totp', 'passkey'];

const initiate2FAMethodRemoval = async (uid, email, method, fingerprint, ip, userAgent) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();

        if (!VALID_METHODS.includes(parameters.method)) {
            return { error: true, errorCode: 'TWO-FA::INVALID-METHOD::A::p' };
        }

        if (parameters.method === 'totp' && globalAccessPoint.getValue('totpSystemDisabled')) {
            return { error: true, errorCode: 'TOTP::SYSTEM-DISABLED::A::i' };
        }

        if (parameters.method === 'passkey' && !systemConfigModule.getModule()?.authMethods?.passkey) {
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i' };
        }

        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
        }

        // Validate the method is actually enabled
        if (parameters.method === 'totp') {
            const totpEnabled = await TOTPModel.isEnabled(parameters.uid);
            if (!totpEnabled) {
                return { error: true, errorCode: 'TWO-FA::METHOD-NOT-ENABLED::A::p' };
            }
        }

        if (parameters.method === 'passkey') {
            const hasPasskey = await PasskeyModel.hasPasskey(parameters.uid);
            if (!hasPasskey) {
                return { error: true, errorCode: 'TWO-FA::METHOD-NOT-ENABLED::A::p' };
            }
        }

        const code = generateRandomNumber(6);
        const codeHash = await hashString(code);

        const reqId = generateRequestId('2FA_REMOVAL', 52);

        await RequestModel.create2FARemovalRequest(reqId, {
            codeHash,
            fingerprintHash: await hashString(parameters.fingerprint),
            ip: getIpRange(parameters.ip),
            userAgent: parameters.userAgent,
            email: parameters.email,
            uid: parameters.uid,
            method: parameters.method
        });

        const deletionFunction = async parameters => {
            await RequestModel.delete2FARemovalRequest(parameters.reqId);
        };

        const parametersInternal = { reqId };

        cronScheduler.addEvent(reqId, deletionFunction, '15m', parametersInternal);

        const send = await generateAndSendMail(1, parameters.email, {
            EMAIL: parameters.email,
            CODE: code,
            IP: parameters.ip,
            USERAGENT: parameters.userAgent,
            MODEL: getDeviceDetails(parameters.userAgent).device.model || 'Unknown Device'
        });

        if (send.error) {
            cronScheduler.cancelEvent(reqId);
            await deletionFunction(parametersInternal);
            return { error: true, errorCode: 'TWO-FA::EMAIL-SEND-FAILED::A::i' };
        }

        if (auditTrail) {
            auditTrail.record({
                user: { email: parameters.email, uid: parameters.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: '2FA_REMOVAL_REQUEST_CREATED',
                status: 'SUCCESS',
                source: 'Remove2FAMethod.js',
                functionName: 'initiate2FAMethodRemoval',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: `2FA removal email sent for method: ${parameters.method}`,
                metadata: { method: parameters.method, reqId }
            });
        }

        return { error: false, sent: true, reqId };
    };

    const parameters = { uid, email, method, fingerprint, ip, userAgent };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'initiate2FAMethodRemoval', functionSource);
};

const complete2FAMethodRemoval = async (reqId, code, fingerprint, ip, userAgent) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();

        const storedData = await RequestModel.get2FARemovalRequest(parseCookieData(parameters.reqId));

        if (!storedData) {
            return { error: true, errorCode: 'TWO-FA::REQUEST-EXPIRED::A::p' };
        }

        if (parameters.userAgent !== storedData.user_agent) {
            return { error: true, errorCode: 'TWO-FA::USERAGENT-MISMATCH::A::p' };
        }

        if (!(await isIpInRange(parameters.ip, storedData.ip_range))) {
            return { error: true, errorCode: 'TWO-FA::IP-MISMATCH::A::p' };
        }

        if (!(await verifyHash(parameters.fingerprint, storedData.fingerprint_hash))) {
            return { error: true, errorCode: 'TWO-FA::FINGERPRINT-MISMATCH::A::p' };
        }

        if (!(await verifyHash(parameters.code, storedData.code_hash))) {
            if (auditTrail) {
                auditTrail.record({
                    user: { email: storedData.email, uid: storedData.user_uid },
                    device: {
                        fingerprint: parameters.fingerprint,
                        userAgent: parameters.userAgent
                    },
                    action: '2FA_REMOVAL_VERIFICATION',
                    status: 'FAILED',
                    source: 'Remove2FAMethod.js',
                    functionName: 'complete2FAMethodRemoval',
                    requestId: requestMetadata?.requestId,
                    ipAddress: parameters.ip,
                    impact: '2FA removal verification failed - invalid code',
                    metadata: { method: storedData.method, reason: 'INVALID_CODE' },
                    errorCode: 'TWO-FA::INVALID-CODE::A::p'
                });
            }
            return { error: true, errorCode: 'TWO-FA::INVALID-CODE::A::p' };
        }

        // Code verified, remove the 2FA method
        const user = await UserModel.getUserByUid(storedData.user_uid);

        if (!user) {
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
        }

        const method = storedData.method;

        if (method === 'totp') {
            await TOTPModel.disableTOTP(storedData.user_uid);
        }

        if (method === 'passkey') {
            await PasskeyModel.deleteAllForUser(storedData.user_uid);
        }

        // Check if any 2FA method remains
        const hasTotp = await TOTPModel.isEnabled(storedData.user_uid);
        const hasPasskey = await PasskeyModel.hasPasskey(storedData.user_uid);

        if (!hasTotp && !hasPasskey) {
            await UserSecurityModel.setTwoFAEnabled(storedData.user_uid, false);
        }

        // Clean up the request
        await RequestModel.delete2FARemovalRequest(parseCookieData(parameters.reqId));
        cronScheduler.cancelEvent(parseCookieData(parameters.reqId));

        if (auditTrail) {
            auditTrail.record({
                user: { email: storedData.email, uid: storedData.user_uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: '2FA_METHOD_REMOVED',
                status: 'SUCCESS',
                source: 'Remove2FAMethod.js',
                functionName: 'complete2FAMethodRemoval',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: `2FA method removed: ${method}. 2FA flag: ${!hasTotp && !hasPasskey ? 'disabled' : 'still active'}`,
                metadata: { method, twoFAStillActive: hasTotp || hasPasskey }
            });
        }

        return { error: false, completed: true, method };
    };

    const parameters = { reqId, code, fingerprint, ip, userAgent };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'complete2FAMethodRemoval', functionSource);
};

const routeHandlerInitiate2FAMethodRemoval = async (request, response) => {
    const uid = request.user.uid;
    const email = request.user.email;
    const method = request.body.packet.method;

    const fingerprint = request.headers['orion-fingerprint'];
    const userAgent = request.headers['orion-user-agent'];
    const ip = getIp(request);

    const callback = await initiate2FAMethodRemoval(uid, email, method, fingerprint, ip, userAgent);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback.reqId) {
        response.cookie('twoFARemovalRequestId', stringifyCookieData(callback.reqId), {
            httpOnly: true,
            secure: true,
            sameSite: 'None',
            maxAge: 15 * 60 * 1000
        });
    }

    return respondWithSuccess(response, 200, { sent: true });
};

const routeHandlerComplete2FAMethodRemoval = async (request, response) => {
    const code = request.body.packet.code;

    const fingerprint = request.headers['orion-fingerprint'];
    const userAgent = request.headers['orion-user-agent'];
    const ip = getIp(request);

    const reqId = request.cookies['twoFARemovalRequestId'];

    if (!reqId) {
        return respondWithError(response, 'TWO-FA::MISSING-REQUEST-ID::A::p');
    }

    const callback = await complete2FAMethodRemoval(reqId, code, fingerprint, ip, userAgent);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    response.cookie('twoFARemovalRequestId', '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true, method: callback.method });
};

export {
    initiate2FAMethodRemoval,
    complete2FAMethodRemoval,
    routeHandlerInitiate2FAMethodRemoval,
    routeHandlerComplete2FAMethodRemoval
};
