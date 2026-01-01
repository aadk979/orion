import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { verifyHash, generateSignature } from '../../CryptoFunctions.js';
import { parseDuration } from '../../Date&Time.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { getIp } from '../../Ip.js';
import { sanitizeString } from '../../Sanitizer.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { isValidEmail, isValidEmailDomain } from '../../Validator.js';
import { generateId } from '../../valueGenerator.js';
import { generateAccessToken } from '../TokenManagement/AccessTokens.js';
import { generateRefreshToken } from '../TokenManagement/RefreshTokens.js';
import { stringifyCookieData } from '../../CookieUtils.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { userControl } from './UserControl.js';

const signInWithPassword = async (email, password, fingerprint, ip, userAgent) => {
    const Function = async parameters => {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
        const requestMetadata = requestContext.getStore();
        const systemConfig = globalAccessPoint.getValue('systemConfig');

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
                errorCode: 'ACC-SIGN-IN-EMAIL-PASSWORD-DISABLED'
            });
            return { error: true, errorCode: 'ACC-SIGN-IN-EMAIL-PASSWORD-DISABLED' };
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
                errorCode: 'ACC-SIGN-IN-INVALID-EMAIL'
            });
            return { error: true, errorCode: 'ACC-SIGN-IN-INVALID-EMAIL' };
        }

        if (globalAccessPoint.getValue('allowedEmailDomains') !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.getValue('allowedEmailDomains'), sanitizedEmail);

            if (!emailValidation) {
                return respondWithError(parameters.response, 'EMAIL-DOMAIN-NOT-ALLOWED');
            }
        }

        const userAccState = await userControl.getUserAccountState().byEmail(sanitizedEmail);

        if (userAccState.error && userAccState.errorCode === 'USER-CONTROL-NO-SUCH-USER') {
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
                errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS'
            });
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        if (userAccState.disabled) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-DISABLED' };
        }

        const uid = await userControl.getUserUidByEmail(sanitizedEmail);

        const user = await globalAccessPoint.db().getData('Users', uid.uid);

        if (!user.data.credentials.password) {
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
                errorCode: 'ACC-SIGN-IN-NO-PASSWORD-SETUP'
            });
            return { error: true, errorCode: 'ACC-SIGN-IN-NO-PASSWORD-SETUP' };
        }

        const passwordMatch = await verifyHash(sanitizedPassword, user.data.credentials.password);

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
                errorCode: 'ACC-SIGN-IN-INVALID-PASSWORD'
            });
            return { error: true, errorCode: 'ACC-SIGN-IN-INVALID-PASSWORD' };
        }

        const accessToken = await generateAccessToken(
            user.data.credentials.uid,
            sanitizedEmail,
            parameters.fingerprint,
            'PASSWORD',
            'USER',
            parameters.ip,
            parameters.userAgent
        );

        if (accessToken.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: user.data.credentials.uid },
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
            user.data.credentials.uid,
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
                user: { email: parameters.email, uid: user.data.credentials.uid },
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

        const SID = generateId('SID', 64);

        const signatureKeyPair = globalAccessPoint.getValue('signatureSecretsManager').getRandomKeyPair('internal');

        const signature = generateSignature(SID + refreshToken.token, signatureKeyPair.privateKey);
        const cookieSignature = `${signature}:*:${signatureKeyPair.keyPairId}`;

        const tokenCookies = [
            { key: 'ACCESS_TOKEN', data: accessToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.accessTokens) },
            { key: 'REFRESH_TOKEN', data: refreshToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) },
            { key: 'SID', data: SID, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) },
            { key: 'SID_SIGNATURE', data: cookieSignature, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) }
        ];

        auditTrail.record({
            user: { email: parameters.email, uid: user.data.credentials.uid },
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
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), { httpOnly: true, secure: true, sameSite: 'None', maxAge: cookie.maxAge });
        }
    }

    delete callback.cookies;

    return respondWithSuccess(response, 200, callback);
};

export { signInWithPassword, routeHandlerSignInWithPassword };
