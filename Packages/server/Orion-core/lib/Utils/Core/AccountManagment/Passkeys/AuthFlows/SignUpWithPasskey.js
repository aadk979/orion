import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { respondWithError, respondWithSuccess } from '../../../../../Server/Response/response.js';
import { globalAccessPoint } from '../../../../GlobalAccessPoint.js';
import { UserModel, PasskeyModel, WebAuthnCeremonyModel } from '../../../../Databases/models/index.js';
import { getIp } from '../../../../Ip.js';
import { sanitizeString } from '../../../../Sanitizer.js';
import { tryCatch } from '../../../../TryCatch.js';
import { isValidEmail, isValidEmailDomain } from '../../../../Validator.js';
import { generateUID, generateRequestId } from '../../../../valueGenerator.js';
import { getFutureUnixTime } from '../../../../Date&Time.js';
import { parseCookieData, setManagedCookie, clearManagedCookie } from '../../../../CookieUtils.js';
import { fileURLToPath } from 'url';
import { requestContext } from '../../../../../Server/Middleware/requestMetadata.js';
import { logger } from '../../../../logger.js';
import { SafeModuleHandler } from '../../../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'SignUpWithPasskey.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'SignUpWithPasskey.js');

// ─── Step 1: Generate registration options for a NEW user ────────────────────

const generatePasskeySignUpOptions = async (email, clientURL) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();
        const systemConfig = systemConfigModule.getModule();

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
                errorCode: 'PASSKEY::SIGN-UP-DISABLED::A::p'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-DISABLED::A::p' };
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
                errorCode: 'PASSKEY::SIGN-UP-INVALID-EMAIL::A::p'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-INVALID-EMAIL::A::p' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), sanitizedEmail);

            if (!emailValidation) {
                return { error: true, errorCode: 'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p' };
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
                errorCode: 'PASSKEY::SIGN-UP-ACCOUNT-EXISTS::A::p'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-ACCOUNT-EXISTS::A::p' };
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

        // Server-held ceremony state. The sign-up ceremony precedes the account,
        // so the reserved uid travels in metadata rather than in the cookie.
        const ceremonyId = generateRequestId('WEBAUTHN_SIGNUP', 32);

        await WebAuthnCeremonyModel.create({
            ceremonyId,
            type: 'sign-up',
            challenge: options.challenge,
            email: sanitizedEmail,
            metadata: { tempUid },
            expiresAt: getFutureUnixTime('3m')
        });

        return {
            error: false,
            options: options,
            cookies: [
                {
                    key: 'PASSKEY-SIGN-UP-INFO-STEP-1',
                    data: ceremonyId,
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
        for (const cookie of callback.cookies) {
            setManagedCookie(response, cookie.key, cookie.data);
        }
    }

    return respondWithSuccess(response, 200, { options: callback.options });
};

// ─── Step 2: Complete registration + create account (no sign-in) ─────────────

const completePasskeySignUp = async (registrationResponse, cookie, email, clientURL, parsedClientURL) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-DISABLED::A::p' };
        }

        // Opaque handle in, server-held state out. Consumed atomically, so a
        // captured sign-up assertion cannot be replayed to mint a second account.
        const ceremonyId = parameters.cookie ? parseCookieData(parameters.cookie) : undefined;
        const ceremony = typeof ceremonyId === 'string' ? await WebAuthnCeremonyModel.consume(ceremonyId, 'sign-up') : null;

        // Shaped like the old cookie so the audit/verification body below reads
        // unchanged — but every field now comes from the server's own record.
        const cookie = ceremony ? { email: ceremony.email, challenge: ceremony.challenge, tempUid: ceremony.metadata?.tempUid } : undefined;

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
                errorCode: 'PASSKEY::SIGN-UP-EXPIRED::A::p'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-EXPIRED::A::p' };
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
                errorCode: 'PASSKEY::SIGN-UP-EMAIL-MISMATCH::A::p'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-EMAIL-MISMATCH::A::p' };
        }

        // Double-check account doesn't already exist (race condition guard)
        const emailExists = await UserModel.emailExists(cookie.email);

        if (emailExists) {
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-ACCOUNT-EXISTS::A::p' };
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
                errorCode: 'PASSKEY::SIGN-UP-REGISTRATION-FAILED::A::i'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-REGISTRATION-FAILED::A::i' };
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
                errorCode: 'PASSKEY::SIGN-UP-CREATE-FAILED::A::i'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-UP-CREATE-FAILED::A::i' };
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

    clearManagedCookie(response, 'PASSKEY-SIGN-UP-INFO-STEP-1');

    return respondWithSuccess(response, 200, callback.data);
};

export { routeHandlerGeneratePasskeySignUpOptions, routeHandlerCompletePasskeySignUp };
