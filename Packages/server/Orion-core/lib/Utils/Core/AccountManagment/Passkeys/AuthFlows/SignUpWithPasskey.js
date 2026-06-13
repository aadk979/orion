import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { respondWithError, respondWithSuccess } from '../../../../../Server/Response/response.js';
import { globalAccessPoint } from '../../../../GlobalAccessPoint.js';
import { UserModel, PasskeyModel } from '../../../../Databases/models/index.js';
import { getIp } from '../../../../Ip.js';
import { sanitizeString } from '../../../../Sanitizer.js';
import { tryCatch } from '../../../../TryCatch.js';
import { isValidEmail, isValidEmailDomain } from '../../../../Validator.js';
import { generateUID } from '../../../../valueGenerator.js';
import { stringifyCookieData, parseCookieData } from '../../../../CookieUtils.js';
import { fileURLToPath } from 'url';
import { requestContext } from '../../../../../Server/Middleware/requestMetadata.js';
import { logger } from '../../../../logger.js';

// ─── Step 1: Generate registration options for a NEW user ────────────────────

const generatePasskeySignUpOptions = async (email, clientURL) => {
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
                action: 'PASSKEY_SIGN_UP_ATTEMPT',
                status: 'FAILED',
                source: 'SignUpWithPasskey.js',
                functionName: 'generatePasskeySignUpOptions',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Passkey sign up blocked - method disabled',
                metadata: { reason: 'PASSKEY_DISABLED' },
                errorCode: 'PASSKEY-SIGN-UP-DISABLED'
            });
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-DISABLED' };
        }

        const lowerCaseEmail = parameters.email.toLowerCase();
        const sanitizedEmail = sanitizeString(lowerCaseEmail);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSKEY_SIGN_UP_ATTEMPT',
                status: 'FAILED',
                source: 'SignUpWithPasskey.js',
                functionName: 'generatePasskeySignUpOptions',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Passkey sign up blocked - invalid email',
                metadata: { reason: 'INVALID_EMAIL_FORMAT' },
                errorCode: 'PASSKEY-SIGN-UP-INVALID-EMAIL'
            });
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-INVALID-EMAIL' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), sanitizedEmail);

            if (!emailValidation) {
                return { error: true, errorCode: 'EMAIL-DOMAIN-NOT-ALLOWED' };
            }
        }

        const emailExists = await UserModel.emailExists(sanitizedEmail);

        if (emailExists) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSKEY_SIGN_UP_ATTEMPT',
                status: 'FAILED',
                source: 'SignUpWithPasskey.js',
                functionName: 'generatePasskeySignUpOptions',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Passkey sign up blocked - account already exists',
                metadata: { reason: 'ACCOUNT_EXISTS' },
                errorCode: 'PASSKEY-SIGN-UP-ACC-EXISTS'
            });
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-ACC-EXISTS' };
        }

        const tempUid = generateUID(sanitizedEmail);
        const rpName = 'Orion';

        const options = await generateRegistrationOptions({
            rpId: parameters.clientURL,
            rpName: rpName,
            userid: Uint8Array.from(tempUid, c => c.charCodeAt(0)),
            userName: sanitizedEmail,
            userDisplayName: sanitizedEmail.split('@')[0]
        });

        return {
            error: false,
            options: options,
            cookies: [
                {
                    key: 'PASSKEY-SIGN-UP-INFO-STEP-1',
                    data: {
                        tempUid: tempUid,
                        id: options.user.id,
                        email: sanitizedEmail,
                        challenge: options.challenge
                    },
                    maxAge: 60 * 1000
                }
            ]
        };
    };

    const parameters = {
        email,
        clientURL
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'generatePasskeySignUpOptions', functionSource);

    return results;
};

const routeHandlerGeneratePasskeySignUpOptions = async (request, response) => {
    const email = request.body.packet.email;
    const clientURL = request.get('Origin') || request.get('Referer');

    const parsedClientURL = clientURL.split('//')[clientURL.split('//').length - 1];

    const callback = await generatePasskeySignUpOptions(email, parsedClientURL);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), {
                httpOnly: true,
                secure: true,
                sameSite: 'None',
                maxAge: cookie.maxAge
            });
        }
    }

    return respondWithSuccess(response, 200, { options: callback.options });
};

// ─── Step 2: Complete registration + create account (no sign-in) ─────────────

const completePasskeySignUp = async (registrationResponse, cookie, email, clientURL, parsedClientURL) => {
    const Function = async parameters => {
        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();
        const systemConfig = globalAccessPoint.systemConfig();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-DISABLED' };
        }

        const cookie = parameters.cookie ? parseCookieData(parameters.cookie) : undefined;

        if (!cookie) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSKEY_SIGN_UP_COMPLETE',
                status: 'FAILED',
                source: 'SignUpWithPasskey.js',
                functionName: 'completePasskeySignUp',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Passkey sign up failed - session expired',
                metadata: { reason: 'SESSION_EXPIRED' },
                errorCode: 'PASSKEY-SIGN-UP-EXPIRED'
            });
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-EXPIRED' };
        }

        if (cookie.email !== parameters.email.toLowerCase()) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSKEY_SIGN_UP_COMPLETE',
                status: 'FAILED',
                source: 'SignUpWithPasskey.js',
                functionName: 'completePasskeySignUp',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Passkey sign up failed - email mismatch',
                metadata: { reason: 'EMAIL_MISMATCH' },
                errorCode: 'PASSKEY-SIGN-UP-EMAIL-MISMATCH'
            });
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-EMAIL-MISMATCH' };
        }

        // Double-check account doesn't already exist (race condition guard)
        const emailExists = await UserModel.emailExists(cookie.email);

        if (emailExists) {
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-ACC-EXISTS' };
        }

        const verification = await verifyRegistrationResponse({
            response: parameters.registrationResponse,
            expectedChallenge: cookie.challenge,
            expectedOrigin: parameters.expectedOrigin,
            expectedRPID: parameters.clientURL
        });

        if (!verification.verified) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSKEY_SIGN_UP_COMPLETE',
                status: 'FAILED',
                source: 'SignUpWithPasskey.js',
                functionName: 'completePasskeySignUp',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Passkey sign up failed - registration verification failed',
                metadata: { reason: 'VERIFICATION_FAILED' },
                errorCode: 'PASSKEY-SIGN-UP-REGISTRATION-FAILED'
            });
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-REGISTRATION-FAILED' };
        }

        const passkeyStorageObj = {
            id: verification.registrationInfo.credential.id,
            publicKey: verification.registrationInfo.credential.publicKey,
            counter: verification.registrationInfo.credential.counter,
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
            transports: verification.registrationInfo.credential.transports
        };

        const uid = cookie.tempUid;

        // Create user
        const createResult = await UserModel.createUser({
            uid,
            email: cookie.email,
            passwordHash: null,
            role: 'USER'
        });

        if (createResult.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: uid },
                device: {
                    fingerprint: requestMetadata?.fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'PASSKEY_SIGN_UP_COMPLETE',
                status: 'FAILED',
                source: 'SignUpWithPasskey.js',
                functionName: 'completePasskeySignUp',
                requestId: requestMetadata?.requestId,
                ipAddress: requestMetadata?.ip,
                impact: 'Passkey sign up failed - database error',
                metadata: { reason: 'DATABASE_ERROR' },
                errorCode: 'PASSKEY-SIGN-UP-UNABLE-TO-CREATE-ACC'
            });
            return { error: true, errorCode: 'PASSKEY-SIGN-UP-UNABLE-TO-CREATE-ACC' };
        }

        // Save passkey credentials
        await PasskeyModel.savePasskey(uid, passkeyStorageObj);

        auditTrail.record({
            user: { email: cookie.email, uid: uid },
            device: {
                fingerprint: requestMetadata?.fingerprint,
                userAgent: requestMetadata?.userAgent
            },
            action: 'PASSKEY_SIGN_UP_SUCCESS',
            status: 'SUCCESS',
            source: 'SignUpWithPasskey.js',
            functionName: 'completePasskeySignUp',
            requestId: requestMetadata?.requestId,
            ipAddress: requestMetadata?.ip,
            impact: 'New account created with passkey',
            metadata: {
                method: 'PASSKEY'
            }
        });

        try {
            systemConfig?.utilities?.onUserCreation(cookie.email, uid);
        } catch (e) {
            logger.error('An error occurred in the onUserCreation callback: ' + e);
        }

        return {
            error: false,
            data: { accountCreated: true },
            completed: true
        };
    };

    const parameters = {
        registrationResponse,
        cookie,
        email,
        expectedOrigin: clientURL,
        clientURL: parsedClientURL
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'completePasskeySignUp', functionSource);

    return results;
};

const routeHandlerCompletePasskeySignUp = async (request, response) => {
    const cookie = request.cookies['PASSKEY-SIGN-UP-INFO-STEP-1'];
    const email = request.body.packet.email;
    const clientURL = request.get('Origin') || request.get('Referer');
    const responseData = request.body.packet.registrationResponse;

    const parsedClientURL = clientURL.split('//')[clientURL.split('//').length - 1];

    const callback = await completePasskeySignUp(responseData, cookie, email, clientURL, parsedClientURL);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    response.clearCookie('PASSKEY-SIGN-UP-INFO-STEP-1', { httpOnly: true, secure: false, sameSite: 'None', maxAge: 0 });

    return respondWithSuccess(response, 200, callback.data);
};

export { routeHandlerGeneratePasskeySignUpOptions, routeHandlerCompletePasskeySignUp };