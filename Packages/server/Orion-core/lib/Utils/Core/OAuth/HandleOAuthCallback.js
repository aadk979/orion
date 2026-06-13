import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { verifyHash } from '../../CryptoFunctions.js';
import { parseDuration } from '../../Date&Time.js';
import { base64Decode } from '../../Encoders.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { RequestModel } from '../../Databases/models/index.js';
import { getIp, isIpInRange } from '../../Ip.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateAccessToken } from '../TokenManagement/AccessTokens.js';
import { generateRefreshToken } from '../TokenManagement/RefreshTokens.js';
import { accountExist, checkAndAddProviderToAccount, createAccountWithProvider } from './Account.js';
import { isDeviceRecognizedForUserEmail, sendDeviceAuthorizationMail } from '../AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js';
import { stringifyCookieData, parseCookieData } from '../../CookieUtils.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { isValidEmailDomain } from '../../Validator.js';
import { userControl } from '../AccountManagment/UserControl.js';

const handleOAuthCallback = async (code, state, flowSecret, fingerprint, ip, userAgent, deviceId, deviceCode) => {
    const Function = async parameters => {
        const auditTrail = globalAccessPoint.auditTrailSystem();
        const requestMetadata = requestContext.getStore();
        const oAuthToolKit = globalAccessPoint.oAuthToolKit();

        const stateFromClient = JSON.parse(base64Decode(parameters.state));

        const stateFromServer = await RequestModel.getOAuthRequest(stateFromClient.requestId);

        if (stateFromServer === null) {
            auditTrail.record({
                user: {},
                device: {
                    userAgent: parameters.userAgent
                },
                action: 'OAUTH_CALLBACK_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth callback blocked - invalid or expired request',
                metadata: {
                    reason: 'INVALID_OR_EXPIRED_REQUEST',
                    requestId: stateFromClient.requestId
                },
                errorCode: 'O-AUTH-REQUEST-INVALID-OR-EXPIRED'
            });
            return { error: true, errorCode: 'O-AUTH-REQUEST-INVALID-OR-EXPIRED' };
        }

        if (!(await verifyHash(parameters.flowSecret, stateFromServer.hashed_flow_secret))) {
            auditTrail.record({
                user: {},
                device: {
                    userAgent: parameters.userAgent
                },
                action: 'OAUTH_CALLBACK_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth callback blocked - flow secret mismatch',
                metadata: {
                    reason: 'FLOW_SECRET_MISMATCH',
                    requestId: stateFromClient.requestId
                },
                errorCode: 'O-AUTH-FLOW-SECRET-MISMATCH'
            });
            return { error: true, errorCode: 'O-AUTH-FLOW-SECRET-MISMATCH' };
        }

        if (!(await isIpInRange(parameters.ip, stateFromServer.ip_range))) {
            auditTrail.record({
                user: {},
                device: {
                    userAgent: parameters.userAgent
                },
                action: 'OAUTH_CALLBACK_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth callback blocked - IP address mismatch',
                metadata: {
                    reason: 'IP_MISMATCH',
                    requestId: stateFromClient.requestId
                },
                errorCode: 'O-AUTH-IP-MISMATCH'
            });
            return { error: true, errorCode: 'O-AUTH-IP-MISMATCH' };
        }

        if (!(await verifyHash(stateFromClient.challenge, stateFromServer.hashed_challenge))) {
            auditTrail.record({
                user: {},
                device: {
                    userAgent: parameters.userAgent
                },
                action: 'OAUTH_CALLBACK_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth callback blocked - invalid state challenge',
                metadata: {
                    reason: 'INVALID_STATE_CHALLENGE',
                    requestId: stateFromClient.requestId
                },
                errorCode: 'O-AUTH-INVALID-STATE-CHALLENGE'
            });
            return { error: true, errorCode: 'O-AUTH-INVALID-STATE-CHALLENGE' };
        }

        const provider = stateFromServer.provider_name.trim().toLowerCase();

        const oAuthResponse = await oAuthToolKit.handleCallback(provider, parameters.code, parameters.state, { nonce: stateFromServer.nonce });

        if (oAuthResponse?.error) {
            auditTrail.record({
                user: {},
                device: {
                    userAgent: parameters.userAgent
                },
                action: 'OAUTH_CALLBACK_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth callback failed - provider error',
                metadata: {
                    reason: 'PROVIDER_ERROR',
                    provider: provider,
                    requestId: stateFromClient.requestId
                },
                errorCode: oAuthResponse.errorCode
            });
            return { error: true, errorCode: oAuthResponse.errorCode };
        }

        if (!oAuthResponse.verified) {
            auditTrail.record({
                user: { email: oAuthResponse.email },
                device: {
                    userAgent: parameters.userAgent
                },
                action: 'OAUTH_CALLBACK_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth callback blocked - email not verified',
                metadata: {
                    reason: 'EMAIL_NOT_VERIFIED',
                    provider: provider,
                    requestId: stateFromClient.requestId
                },
                errorCode: 'O-AUTH-EMAIL-NOT-VERIFIED'
            });
            return { error: true, errorCode: 'O-AUTH-EMAIL-NOT-VERIFIED' };
        }

        if (globalAccessPoint.allowedEmailDomains() !== '*') {
            const emailValidation = isValidEmailDomain(globalAccessPoint.allowedEmailDomains(), oAuthResponse.email);

            if (!emailValidation) {
                auditTrail.record({
                    user: { email: oAuthResponse.email },
                    device: {
                        userAgent: parameters.userAgent
                    },
                    action: 'OAUTH_CALLBACK_ATTEMPT',
                    status: 'FAILED',
                    source: 'HandleOAuthCallback.js',
                    functionName: 'handleOAuthCallback',
                    requestId: requestMetadata?.requestId,
                    ipAddress: parameters.ip,
                    impact: 'OAuth callback blocked - email not verified',
                    metadata: {
                        reason: 'EMAIL_NOT_VERIFIED',
                        provider: provider,
                        requestId: stateFromClient.requestId
                    },
                    errorCode: 'O-AUTH-EMAIL-NOT-VERIFIED'
                });

                return { error: true, errorCode: 'EMAIL-DOMAIN-NOT-ALLOWED' };
            }
        }

        const accountExistCheck = await accountExist(oAuthResponse.email);

        if (accountExistCheck.error) {
            return accountExistCheck;
        }

        let uid;

        if (accountExistCheck.userExist) {
            const addProviderResult = await checkAndAddProviderToAccount(oAuthResponse.email, provider);

            if (addProviderResult.error) {
                return addProviderResult;
            }

            uid = addProviderResult.uid;
        } else {
            const createAccountResult = await createAccountWithProvider(oAuthResponse.email, provider);

            if (createAccountResult.error) {
                return createAccountResult;
            }

            uid = createAccountResult.uid;
        }

        const userAccState = await userControl.getUserAccountState().byEmail(oAuthResponse.email);

        if (userAccState.disabled) {
            return { error: true, errorCode: 'O-AUTH-ACC-DISABLED' };
        }

        const deviceAuthorizationEnabled = globalAccessPoint.deviceAuthorization();

        if (deviceAuthorizationEnabled) {
            if (!parameters?.deviceId || !parameters?.deviceCode) {
                const cookies = [{ key: 'deviceAuthEmailOffset', data: oAuthResponse.email, maxAge: parseDuration('15m') }];

                return { error: true, errorCode: 'DEVICE-2FA-DEVICE-AUTHORIZATION-STARTED', cookies };
            }

            const deviceRecognition = await isDeviceRecognizedForUserEmail(
                oAuthResponse.email,
                parameters.userAgent,
                parameters.deviceId,
                parameters.deviceCode
            );

            if (deviceRecognition.error) {
                const cookies = [
                    { key: 'authorizedDeviceId', data: '', maxAge: 0 },
                    { key: 'authorizedDeviceCode', data: '', maxAge: 0 },
                    { key: 'deviceAuthEmailOffset', data: oAuthResponse.email, maxAge: parseDuration('15m') }
                ];

                return { error: true, errorCode: 'DEVICE-2FA-DEVICE-AUTHORIZATION-STARTED', cookies };
            }
        }

        const accessToken = await generateAccessToken(
            uid,
            oAuthResponse.email,
            parameters.fingerprint,
            `PROVIDER-${provider.trim().toUpperCase()}`,
            'USER',
            parameters.ip,
            parameters.userAgent
        );

        if (accessToken.error) {
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(
            uid,
            oAuthResponse.email,
            parameters.fingerprint,
            `PROVIDER-${provider.trim().toUpperCase()}`,
            'USER',
            parameters.ip,
            parameters.userAgent,
            accessToken.accessTokenLinkCode
        );

        if (refreshToken.error) {
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            signedIn: true
        };

        const systemConfig = globalAccessPoint.systemConfig();

        const tokenCookies = [
            { key: 'ACCESS_TOKEN', data: accessToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.accessTokens) },
            { key: 'REFRESH_TOKEN', data: refreshToken.token, maxAge: parseDuration(systemConfig.tokens.lifespans.refreshTokens) }
        ];

        auditTrail.record({
            user: { email: oAuthResponse.email, uid: uid },
            device: {
                userAgent: parameters.userAgent
            },
            action: 'OAUTH_SIGN_IN_SUCCESS',
            status: 'SUCCESS',
            source: 'HandleOAuthCallback.js',
            functionName: 'handleOAuthCallback',
            requestId: requestMetadata?.requestId,
            ipAddress: parameters.ip,
            impact: 'User successfully signed in via OAuth',
            metadata: {
                provider: provider,
                method: 'OAUTH',
                accessTokenGenerated: true,
                refreshTokenGenerated: true,
                requestId: stateFromClient.requestId
            }
        });

        return { error: false, data: response, completed: true, cookies: [...tokenCookies] };
    };

    const parameters = {
        state,
        code,
        flowSecret,
        fingerprint,
        ip,
        userAgent,
        deviceId,
        deviceCode
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'handleOAuthCallback', functionSource);

    if (results.error && results.errorCode === 'UNKNOWN-ERROR') {
        return { error: true, errorCode: 'O-AUTH-CALLBACK-PROCESSING-FAILED' };
    }

    return results;
};

const routeHandlerHandleOAuthCallback = async (request, response) => {
    const packet = request.body.packet;

    const code = packet.code;
    const state = packet.state;

    const ip = getIp(request);
    const fingerprint = request.headers['orion-fingerprint'];
    const userAgent = request.headers['orion-user-agent'];
    const flowSecret = parseCookieData(request.cookies['oAuthFlowSecret']) || '';

    const deviceId = request.cookies['authorizedDeviceId'];
    const deviceCode = request.cookies['authorizedDeviceCode'];

    const callback = await handleOAuthCallback(code, state, flowSecret, fingerprint, ip, userAgent, deviceId, deviceCode);

    if (callback.error && callback.errorCode !== 'DEVICE-2FA-DEVICE-AUTHORIZATION-STARTED') {
        return respondWithError(response, callback.errorCode);
    }

    if (callback?.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), { httpOnly: true, secure: true, sameSite: 'None', maxAge: cookie.maxAge });
        }
    }

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    response.cookie('oAuthFlowSecret', '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0 });

    delete callback.cookies;

    return respondWithSuccess(response, 200, callback);
};

export { handleOAuthCallback, routeHandlerHandleOAuthCallback };
