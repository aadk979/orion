import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { verifyHash } from '../../CryptoFunctions.js';
import { parseDuration } from '../../Date&Time.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel } from '../../Databases/models/index.js';
import { getIp } from '../../Ip.js';
import { sanitizeString } from '../../Sanitizer.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmail, isValidEmailDomain } from '../../Validator.js';
import { generateAccessToken } from '../TokenManagement/AccessTokens.js';
import { generateRefreshToken } from '../TokenManagement/RefreshTokens.js';
import { setManagedCookie } from '../../CookieUtils.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { userControl } from './UserControl.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'SignIn.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'SignIn.js');

const signInWithPassword = async (email, password, fingerprint, ip, userAgent) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.emailPassword) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignIn.js',
                functionName: 'signInWithPassword',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Sign in blocked - method disabled',
                metadata: { reason: 'EMAIL_PASSWORD_DISABLED' },
                errorCode: 'ACCOUNT-SIGNIN::EMAIL-PASSWORD-DISABLED::A::p'
            });
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::EMAIL-PASSWORD-DISABLED::A::p' };
        }

        const lowerCaseEmail = parameters.email.toLowerCase();

        const sanitizedEmail = sanitizeString(lowerCaseEmail);
        const sanitizedPassword = sanitizeString(parameters.password);

        const emailValid = isValidEmail(sanitizedEmail);

        if (!emailValid) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignIn.js',
                functionName: 'signInWithPassword',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Sign in blocked - invalid email format',
                metadata: { reason: 'INVALID_EMAIL_FORMAT' },
                errorCode: 'ACCOUNT-SIGNIN::INVALID-EMAIL::A::p'
            });
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::INVALID-EMAIL::A::p' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), sanitizedEmail);

            if (!emailValidation) {
                return { error: true, errorCode: 'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p' };
            }
        }

        const userAccState = await userControl.getUserAccountState().byEmail(sanitizedEmail);

        if (userAccState.error && userAccState.errorCode === 'USER-CONTROL::NO-SUCH-USER::A::p') {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignIn.js',
                functionName: 'signInWithPassword',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Sign in blocked - account does not exist',
                metadata: { reason: 'ACCOUNT_NOT_FOUND' },
                errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p'
            });
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
        }

        if (userAccState.disabled) {
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-DISABLED::A::p' };
        }

        const uid = await userControl.getUserUidByEmail(sanitizedEmail);

        const user = await UserModel.getUserByUid(uid.uid);

        if (!user.password_hash) {
            auditTrail.record({
                user: { email: parameters.email, uid: uid.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignIn.js',
                functionName: 'signInWithPassword',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Sign in blocked - no password setup',
                metadata: { reason: 'NO_PASSWORD_SETUP' },
                errorCode: 'ACCOUNT-SIGNIN::NO-PASSWORD-SETUP::A::p'
            });
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::NO-PASSWORD-SETUP::A::p' };
        }

        const passwordMatch = await verifyHash(sanitizedPassword, user.password_hash);

        if (!passwordMatch) {
            auditTrail.record({
                user: { email: parameters.email, uid: uid.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignIn.js',
                functionName: 'signInWithPassword',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Sign in blocked - invalid password',
                metadata: { reason: 'INVALID_PASSWORD' },
                errorCode: 'ACCOUNT-SIGNIN::INVALID-PASSWORD::A::p'
            });
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::INVALID-PASSWORD::A::p' };
        }

        const accessToken = await generateAccessToken(
            user.uid,
            sanitizedEmail,
            parameters.fingerprint,
            'PASSWORD',
            'USER',
            parameters.ip,
            parameters.userAgent
        );

        if (accessToken.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: user.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignIn.js',
                functionName: 'signInWithPassword',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Sign in failed - access token generation error',
                metadata: { reason: 'ACCESS_TOKEN_GENERATION_FAILED' },
                errorCode: accessToken.errorCode
            });
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(
            user.uid,
            sanitizedEmail,
            parameters.fingerprint,
            'PASSWORD',
            'USER',
            parameters.ip,
            parameters.userAgent,
            accessToken.accessTokenLinkCode
        );

        if (refreshToken.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: user.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignIn.js',
                functionName: 'signInWithPassword',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Sign in failed - refresh token generation error',
                metadata: { reason: 'REFRESH_TOKEN_GENERATION_FAILED' },
                errorCode: refreshToken.errorCode
            });
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            signedIn: true
        };

        const tokenCookies = [
            { key: 'ACCESS_TOKEN', data: accessToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.accessTokens) },
            { key: 'REFRESH_TOKEN', data: refreshToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) }
        ];

        auditTrail.record({
            user: { email: parameters.email, uid: user.uid },
            device: {
                fingerprint: parameters.fingerprint,
                userAgent: parameters.userAgent
            },
            action: 'SIGN_IN_SUCCESS',
            status: 'SUCCESS',
            source: 'SignIn.js',
            functionName: 'signInWithPassword',
            requestId: requestMetadata?.requestId,
            ipAddress: parameters.ip,
            impact: 'User successfully signed in',
            metadata: {
                method: 'EMAIL_PASSWORD',
                accessTokenGenerated: true,
                refreshTokenGenerated: true
            }
        });

        return { error: false, data: response, completed: true, cookies: [...tokenCookies] };
    };

    const parameters = {
        email: email,
        password: password,
        fingerprint: fingerprint,
        ip: ip,
        userAgent
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'signInWithPassword', functionSource);

    return result;
};

const routeHandlerSignInWithPassword = async (request, response) => {
    const packet = request.body.packet;

    const email = packet.email;
    const password = packet.password;

    const ip = getIp(request);
    const fingerprint = request.headers['orion-fingerprint'];
    const userAgent = request.headers['orion-user-agent'];

    const callback = await signInWithPassword(email, password, fingerprint, ip, userAgent);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback?.cookies) {
        for (const cookie of callback.cookies) {
            setManagedCookie(response, cookie.key, cookie.data);
        }
    }

    delete callback.cookies;

    return respondWithSuccess(response, 200, callback);
};

export { signInWithPassword, routeHandlerSignInWithPassword };
