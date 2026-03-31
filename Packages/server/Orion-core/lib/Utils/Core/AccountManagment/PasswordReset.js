import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { getFutureUnixTime, isUnixExpired } from '../../Date&Time.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { getIp, getIpRange, isIpInRange } from '../../Ip.js';
import { sanitizeString } from '../../Sanitizer.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmail, isValidEmailDomain } from '../../Validator.js';
import { generateRandomNumber, generateRequestId } from '../../valueGenerator.js';
import { generateAndSendMail } from '../../Mail/sendMail.js';
import { parseCookieData, stringifyCookieData } from '../../CookieUtils.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { userControl } from './UserControl.js';
import { getDeviceDetails } from '../../Device.js';

const createPasswordResetRequest = async (email, ip, userAgent) => {
    const Function = async parameters => {
        const to = parameters.email.toLowerCase();
        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();

        const sanitizedEmail = sanitizeString(to);

        if (!isValidEmail(sanitizedEmail)) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-INVALID-EMAIL' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), sanitizedEmail);

            if (!emailValidation) {
                return { error: true, errorCode: 'EMAIL-DOMAIN-NOT-ALLOWED' };
            }
        }

        const userEmailLink = await globalAccessPoint.db().getData('Users-email', sanitizedEmail);

        if (userEmailLink.data === undefined) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        const code = generateRandomNumber(6);
        const codeHash = await hashString(code);

        const reqId = generateRequestId('PASSWORD_RESET', 52);

        const payload = {
            email: sanitizedEmail,
            uid: userEmailLink.data.uid,
            codeHash,
            ipRange: getIpRange(parameters.ip),
            userAgentHash: await hashString(parameters.userAgent),
            exp: getFutureUnixTime('15m')
        };

        await globalAccessPoint.db().addData('PasswordResetRequests', reqId, payload);

        const send = await generateAndSendMail(2, sanitizedEmail, {
            EMAIL: sanitizedEmail,
            CODE: code,
            IP: parameters.ip,
            USERAGENT: parameters.userAgent,
            MODEL: getDeviceDetails(parameters.userAgent).device.model
        });

        if (send.error) {
            await globalAccessPoint.db().deleteData('PasswordResetRequests', reqId);
            return { error: true, errorCode: 'UNABLE-TO-SEND-PASSWORD-RESET-EMAIL' };
        }

        if (auditTrail) {
            auditTrail.record({
                user: { email: sanitizedEmail, uid: userEmailLink.data.uid },
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
        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();

        const cleanReqId = parseCookieData(parameters.reqId);
        const cleanCode = sanitizeString(parameters.code);

        const record = await globalAccessPoint.db().getData('PasswordResetRequests', cleanReqId);

        if (record.data === undefined) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-REQUEST-EXPIRED' };
        }

        if (isUnixExpired(record.data.exp)) {
            await globalAccessPoint.db().deleteData('PasswordResetRequests', cleanReqId);
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-REQUEST-EXPIRED' };
        }

        if (!(await verifyHash(parameters.userAgent, record.data.userAgentHash))) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-USERAGENT-MISMATCH' };
        }

        if (!(await isIpInRange(parameters.ip, record.data.ipRange))) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-IP-MISMATCH' };
        }

        if (!(await verifyHash(cleanCode, record.data.codeHash))) {
            return { error: true, errorCode: 'ACC-PASSWORD-RESET-INVALID-CODE' };
        }

        const user = await globalAccessPoint.db().getData('Users', record.data.uid);

        if (user.data === undefined) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        const passwordUpdate = await userControl.updateUserPassword(record.data.uid, parameters.newPassword);

        if (passwordUpdate.error) {
            return passwordUpdate;
        }

        await globalAccessPoint.db().deleteData('PasswordResetRequests', cleanReqId);

        if (auditTrail) {
            auditTrail.record({
                user: { email: record.data.email, uid: record.data.uid },
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
        response.cookie('passwordResetRequestId', stringifyCookieData(callback.reqId), {
            httpOnly: true,
            secure: true,
            sameSite: 'None',
            maxAge: 15 * 60 * 1000
        });
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

    response.cookie('passwordResetRequestId', '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0 });

    return respondWithSuccess(response, 200, { success: true });
};

export { createPasswordResetRequest, verifyPasswordResetCodeAndUpdate, routeHandlerInitiatePasswordReset, routeHandlerCompletePasswordReset };
