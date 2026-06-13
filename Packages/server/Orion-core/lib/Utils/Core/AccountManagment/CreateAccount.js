import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { hashString } from '../../CryptoFunctions.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel } from '../../Databases/models/index.js';
import { sanitizeString } from '../../Sanitizer.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmail, isPasswordSafe, isValidEmailDomain } from '../../Validator.js';
import { generateUID } from '../../valueGenerator.js';
import { logger } from "../../logger.js";

const createAccount = async (email, password) => {
    const Function = async parameters => {
        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();

        const systemConfig = globalAccessPoint.systemConfig();

        if (!systemConfig.authMethods.passkey) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'ACCOUNT_CREATION_ATTEMPT',
                status: 'FAILED',
                source: 'CreateAccount.js',
                functionName: 'createAccount',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Account creation blocked - method disabled',
                metadata: { reason: 'EMAIL_PASSWORD_DISABLED' },
                errorCode: 'ACC-REG-EMAIL-PASSWORD-DISABLED'
            });
            return { error: true, errorCode: 'ACC-REG-EMAIL-PASSWORD-DISABLED' };
        }

        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);
        const sanitizedPassword = sanitizeString(parameters.password);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'ACCOUNT_CREATION_ATTEMPT',
                status: 'FAILED',
                source: 'CreateAccount.js',
                functionName: 'createAccount',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Account creation blocked - invalid email',
                metadata: { reason: 'INVALID_EMAIL_FORMAT' },
                errorCode: 'ACC-REG-INVALID-EMAIL'
            });
            return { error: true, errorCode: 'ACC-REG-INVALID-EMAIL' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), sanitizedEmail);

            if (!emailValidation) {
                return respondWithError(parameters.response, 'EMAIL-DOMAIN-NOT-ALLOWED');
            }
        }

        const emailTaken = await UserModel.emailExists(sanitizedEmail);

        if (emailTaken) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'ACCOUNT_CREATION_ATTEMPT',
                status: 'FAILED',
                source: 'CreateAccount.js',
                functionName: 'createAccount',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Account creation blocked - account already exists',
                metadata: { reason: 'ACCOUNT_EXISTS' },
                errorCode: 'ACC-REG-ACC-EXISTS'
            });
            return { error: true, errorCode: 'ACC-REG-ACC-EXISTS' };
        }

        const passwordStrong = isPasswordSafe(sanitizedPassword);

        if (!passwordStrong) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'ACCOUNT_CREATION_ATTEMPT',
                status: 'FAILED',
                source: 'CreateAccount.js',
                functionName: 'createAccount',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Account creation blocked - weak password',
                metadata: { reason: 'WEAK_PASSWORD' },
                errorCode: 'ACC-REG-PASSWORD-WEAK'
            });
            return { error: true, errorCode: 'ACC-REG-PASSWORD-WEAK' };
        }

        const hashedPassword = await hashString(sanitizedPassword);
        const uid = generateUID(sanitizedEmail);

        const createResult = await UserModel.createUser({
            uid,
            email: sanitizedEmail,
            passwordHash: hashedPassword,
            role: 'USER'
        });

        if (createResult.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: uid },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'ACCOUNT_CREATION_ATTEMPT',
                status: 'FAILED',
                source: 'CreateAccount.js',
                functionName: 'createAccount',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Account creation failed - database error',
                metadata: {
                    reason: 'DATABASE_ERROR'
                },
                errorCode: 'ACC-REG-UNABLE-TO-CREATE-ACC'
            });
            return { error: true, errorCode: 'ACC-REG-UNABLE-TO-CREATE-ACC' };
        }

        auditTrail.record({
            user: { email: parameters.email, uid: uid },
            device: {
                fingerprint: requestMetadata?.fingerprint,
                userAgent: requestMetadata?.userAgent
            },
            action: 'ACCOUNT_CREATION_SUCCESS',
            status: 'SUCCESS',
            source: 'CreateAccount.js',
            functionName: 'createAccount',
            requestId: requestMetadata?.requestId,
            ipAddress: requestMetadata?.ip,
            impact: 'New account created successfully',
            metadata: {
                method: 'EMAIL_PASSWORD',
                emailVerified: false,
                twoFAEnabled: false
            }
        });

        try {
            systemConfig?.utilities?.onUserCreation(sanitizedEmail, uid);
        } catch (e) {
            logger.error('An error occurred in the onUserCreation callback: ' + e);
        }

        return { error: false, completed: true };
    };

    const parameters = {
        email: email,
        password: password
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'createAccount', functionSource);

    return result;
};

const routeHandlerCreateAccount = async (request, response) => {
    const packet = request.body.packet;

    const email = packet.email;
    const password = packet.password;

    const callback = await createAccount(email, password);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    return respondWithSuccess(response, 201, callback);
};

export { createAccount, routeHandlerCreateAccount };
