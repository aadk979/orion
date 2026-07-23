import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { getFutureUnixTime, isUnixExpired } from '../../Date&Time.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, RequestModel } from '../../Databases/models/index.js';
import { getIp, getIpRange, isIpInRange } from '../../Ip.js';
import { sanitizeString } from '../../Sanitizer.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmail, isValidEmailDomain } from '../../Validator.js';
import { generateRandomNumber, generateRequestId } from '../../valueGenerator.js';
import { generateAndSendMail } from '../../Mail/sendMail.js';
import { parseCookieData, setManagedCookie, clearManagedCookie } from '../../CookieUtils.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { userControl } from './UserControl.js';
import { getDeviceDetails } from '../../Device.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'PasswordReset.js');

const createPasswordResetRequest = async (email, ip, userAgent) => {
    const Function = async parameters => {
        const to = parameters.email.toLowerCase();
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();

        const sanitizedEmail = sanitizeString(to);

        if (!isValidEmail(sanitizedEmail)) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-INVALID-EMAIL' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), sanitizedEmail);

            if (!emailValidation) {
                return { error: true, errorCode: 'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p' };
            }
        }

        const uid = await UserModel.getUidByEmail(sanitizedEmail);

        if (!uid) {
            // Report success for an unknown address. Distinguishing "sent" from
            // "no such account" here is a free membership oracle, and the caller
            // learns nothing either way — the code only ever reaches a real inbox.
            // The audit trail below still records the real outcome.
            auditTrail?.record({
                user: { email: sanitizedEmail },
                device: { fingerprint: requestMetadata?.fingerprint, userAgent: requestMetadata?.userAgent },
                action: 'PASSWORD_RESET_REQUEST_IGNORED',
                status: 'FAILED',
                source: 'PasswordReset.js',
                functionName: 'createPasswordResetRequest',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Password reset requested for an address with no account — indistinguishable response returned',
                metadata: { reason: 'NO_SUCH_ACCOUNT' }
            });

            return { error: false, sent: true, reqId: null };
        }

        const code = generateRandomNumber(6);
        const codeHash = await hashString(code);

        const reqId = generateRequestId('PASSWORD_RESET', 52);

        await RequestModel.createPasswordResetRequest(reqId, {
            email: sanitizedEmail,
            uid,
            codeHash,
            ipRange: getIpRange(parameters.ip),
            userAgentHash: await hashString(parameters.userAgent),
            expiry: getFutureUnixTime('15m')
        });

        const send = await generateAndSendMail(2, sanitizedEmail, {
            EMAIL: sanitizedEmail,
            CODE: code,
            IP: parameters.ip,
            USERAGENT: parameters.userAgent,
            MODEL: getDeviceDetails(parameters.userAgent).device.model
        });

        if (send.error) {
            await RequestModel.deletePasswordResetRequest(reqId);
            return { error: true, errorCode: 'UNABLE-TO-SEND-PASSWORD-RESET-EMAIL' };
        }

        if (auditTrail) {
            auditTrail.record({
                user: { email: sanitizedEmail, uid },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSWORD_RESET_REQUEST_CREATED',
                status: 'SUCCESS',
                source: 'PasswordReset.js',
                functionName: 'createPasswordResetRequest',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Password reset email sent',
                metadata: { reqId }
            });
        }

        return { error: false, sent: true, reqId };
    };

    const parameters = {
        email,
        ip,
        userAgent
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'createPasswordResetRequest', functionSource);

    return result;
};

const verifyPasswordResetCodeAndUpdate = async (reqId, code, newPassword, ip, userAgent) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();

        const cleanReqId = parseCookieData(parameters.reqId);
        const cleanCode = sanitizeString(parameters.code);

        const record = await RequestModel.getPasswordResetRequest(cleanReqId);

        if (!record) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-REQUEST-EXPIRED' };
        }

        if (isUnixExpired(record.expiry)) {
            await RequestModel.deletePasswordResetRequest(cleanReqId);
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-REQUEST-EXPIRED' };
        }

        if (!(await verifyHash(parameters.userAgent, record.user_agent_hash))) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-USERAGENT-MISMATCH' };
        }

        // NOTE: there is deliberately no IP check here.
        //
        // The party who initiates a reset is the party who completes it, so the
        // stored range is the requester's OWN — for an attacker it always matches,
        // and for a legitimate user opening the emailed code on mobile data it
        // often does not. It only helps if the victim initiates and the attacker
        // completes, which is not how this flow is abused. Removing it costs no
        // security and stops locking real users out of their own recovery.
        //
        // What actually guards this flow: code entropy, the attempt ceiling below
        // (which destroys the request), and the endpoint's rate-limit cost.

        if (!(await verifyHash(cleanCode, record.code_hash))) {
            // Charge the attempt and destroy the request once the ceiling is hit.
            // Without this the record survived every wrong guess for its full
            // 15-minute life, so a 6-digit code was brute-forceable end to end.
            const attempt = await RequestModel.chargeFailedAttempt('password_reset_requests', cleanReqId);

            if (attempt.exhausted) {
                await RequestModel.deletePasswordResetRequest(cleanReqId);
                return { error: true, errorCode: 'ACC-PASSWORD-RESET-ATTEMPTS-EXCEEDED' };
            }

            return { error: true, errorCode: 'ACC-PASSWORD-RESET-INVALID-CODE' };
        }

        const userExists = await UserModel.uidExists(record.user_uid);

        if (!userExists) {
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
        }

        const passwordUpdate = await userControl.updateUserPassword(record.user_uid, parameters.newPassword);

        if (passwordUpdate.error) {
            return passwordUpdate;
        }

        await RequestModel.deletePasswordResetRequest(cleanReqId);

        if (auditTrail) {
            auditTrail.record({
                user: { email: record.email, uid: record.user_uid },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSWORD_RESET_COMPLETED',
                status: 'SUCCESS',
                source: 'PasswordReset.js',
                functionName: 'verifyPasswordResetCodeAndUpdate',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'User password updated via reset flow',
                metadata: { reqId: cleanReqId }
            });
        }

        return { error: false, completed: true };
    };

    const parameters = {
        reqId,
        code,
        newPassword,
        ip,
        userAgent
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'verifyPasswordResetCodeAndUpdate', functionSource);

    return result;
};

const routeHandlerInitiatePasswordReset = async (request, response) => {
    const packet = request.body.packet;

    const email = packet.email;

    const ip = getIp(request);
    const userAgent = request.headers['orion-user-agent'];

    const callback = await createPasswordResetRequest(email, ip, userAgent);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback.reqId) {
        setManagedCookie(response, 'passwordResetRequestId', callback.reqId);
    }

    return respondWithSuccess(response, 200, { sent: true });
};

const routeHandlerCompletePasswordReset = async (request, response) => {
    const packet = request.body.packet;

    const code = packet.code;
    const newPassword = packet.newPassword;

    const ip = getIp(request);
    const userAgent = request.headers['orion-user-agent'];

    const reqId = request.cookies['passwordResetRequestId'];

    if (!reqId) {
        return respondWithError(response, 'ACC-PASSWORD-RESET-MISSING-REQUEST-ID');
    }

    const callback = await verifyPasswordResetCodeAndUpdate(reqId, code, newPassword, ip, userAgent);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    clearManagedCookie(response, 'passwordResetRequestId');

    return respondWithSuccess(response, 200, { success: true });
};

export { createPasswordResetRequest, verifyPasswordResetCodeAndUpdate, routeHandlerInitiatePasswordReset, routeHandlerCompletePasswordReset };
