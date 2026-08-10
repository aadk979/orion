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
import { resolveIssuanceBinding } from '../TokenManagement/internals/dpopBinding.js';
import { resolveOAuthIdentity } from './Account.js';
import { isDeviceRecognizedForUserEmail, sendDeviceAuthorizationMail } from '../AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js';
import { generateDeviceAuthContext } from '../SecurityManagment/DeviceAuthContext.js';
import { parseCookieData, setManagedCookie, clearManagedCookie } from '../../CookieUtils.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { cronScheduler } from '../../Cron.js';
import { isValidEmailDomain } from '../../Validator.js';
import { userControl } from '../AccountManagment/UserControl.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'HandleOAuthCallback.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'HandleOAuthCallback.js');
const oAuthToolKitModule = new SafeModuleHandler('OAuthToolKit', 'oAuthToolKit', 'HandleOAuthCallback.js');

const handleOAuthCallback = async (code, state, flowSecret, fingerprint, ip, userAgent, deviceId, deviceCode) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();
        const oAuthToolKit = oAuthToolKitModule.getModule();

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
                errorCode: 'OAUTH::REQUEST-EXPIRED::A::p'
            });
            return { error: true, errorCode: 'OAUTH::REQUEST-EXPIRED::A::p' };
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
                errorCode: 'OAUTH::FLOW-SECRET-MISMATCH::A::p'
            });
            return { error: true, errorCode: 'OAUTH::FLOW-SECRET-MISMATCH::A::p' };
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
                errorCode: 'OAUTH::IP-MISMATCH::A::p'
            });
            return { error: true, errorCode: 'OAUTH::IP-MISMATCH::A::p' };
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
                errorCode: 'OAUTH::INVALID-STATE-CHALLENGE::A::p'
            });
            return { error: true, errorCode: 'OAUTH::INVALID-STATE-CHALLENGE::A::p' };
        }

        const provider = stateFromServer.provider_name.trim().toLowerCase();

        // Consume the request BEFORE the token exchange. Every other short-lived
        // flow in the system deletes its record on use; this one relied on the
        // provider to reject a reused authorization code, which is someone else's
        // guarantee to keep. Deleting here makes a replayed state fail locally.
        await RequestModel.deleteOAuthRequest(stateFromClient.requestId);
        cronScheduler.cancelEvent(stateFromClient.requestId);

        const oAuthResponse = await oAuthToolKit.handleCallback(provider, parameters.code, {
            nonce: stateFromServer.nonce,
            codeVerifier: stateFromServer.code_verifier
        });

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
                errorCode: 'OAUTH::EMAIL-NOT-VERIFIED::A::p'
            });
            return { error: true, errorCode: 'OAUTH::EMAIL-NOT-VERIFIED::A::p' };
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
                    errorCode: 'OAUTH::EMAIL-NOT-VERIFIED::A::p'
                });

                return { error: true, errorCode: 'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p' };
            }
        }

        // Identity is resolved from the provider's stable subject, not from the
        // email it asserted. Keying on email meant anyone who could get any
        // configured provider to vouch for a victim's address — including via a
        // directory tenant they control — landed in the victim's account.
        const identity = await resolveOAuthIdentity({
            providerName: provider,
            subject: oAuthResponse.id,
            email: oAuthResponse.email,
            emailVerified: oAuthResponse.verified === true
        });

        if (identity.error) {
            auditTrail.record({
                user: { email: oAuthResponse.email },
                device: { userAgent: parameters.userAgent },
                action: 'OAUTH_CALLBACK_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth sign-in blocked - provider identity could not be safely resolved',
                metadata: {
                    reason: identity.errorCode,
                    provider,
                    requestId: stateFromClient.requestId
                },
                errorCode: identity.errorCode
            });

            return identity;
        }

        const uid = identity.uid;

        // Keyed on the uid the provider SUBJECT resolved to, not on the email
        // the provider asserted. The identity resolution directly above exists
        // precisely because the email is not a safe account key; looking the
        // account state up by email undid that for this check, and on any
        // account whose local email differs from the provider's the lookup
        // simply missed, leaving `disabled` undefined and a disabled account
        // able to sign in.
        const userAccState = await userControl.getUserAccountState().byUid(uid);

        if (userAccState.error || userAccState.disabled) {
            return { error: true, errorCode: 'OAUTH::ACCOUNT-DISABLED::A::p' };
        }

        const deviceAuthorizationEnabled = globalAccessPoint.deviceAuthorization();

        if (deviceAuthorizationEnabled) {
            // Signed, device-bound context rather than the bare email — see
            // Core/SecurityManagment/DeviceAuthContext.js for why a cookie
            // holding a plain address could not be trusted to name the account
            // the unauthenticated device-auth routes act on.
            const deviceAuthContext = await generateDeviceAuthContext(oAuthResponse.email, uid);

            if (typeof deviceAuthContext !== 'string') {
                return { error: true, errorCode: 'DEVICE-AUTH::CONTEXT-UNAVAILABLE::A::i' };
            }

            if (!parameters?.deviceId || !parameters?.deviceCode) {
                const cookies = [{ key: 'deviceAuthEmailOffset', data: deviceAuthContext, maxAge: parseDuration('15m') }];

                return { error: true, errorCode: 'DEVICE-AUTH::AUTHORIZATION-STARTED::A::p', cookies };
            }

            const deviceRecognition = await isDeviceRecognizedForUserEmail(
                oAuthResponse.email,
                parameters.userAgent,
                parameters.deviceId,
                parameters.deviceCode
            );

            // Both halves of the contract are checked, matching deviceScanner.
            // Testing only `error` left this path depending on an invariant of
            // another module (that it never returns {error:false, valid:false});
            // if that ever changed, this became a device-authorization bypass.
            if (deviceRecognition.error || !deviceRecognition.valid) {
                const cookies = [
                    { key: 'authorizedDeviceId', data: '', maxAge: 0 },
                    { key: 'authorizedDeviceCode', data: '', maxAge: 0 },
                    { key: 'deviceAuthEmailOffset', data: deviceAuthContext, maxAge: parseDuration('15m') }
                ];

                return { error: true, errorCode: 'DEVICE-AUTH::AUTHORIZATION-STARTED::A::p', cookies };
            }
        }

        // Proof-of-possession binding — see the same call in SignIn.js. The
        // callback reaches us as an SDK POST rather than a top-level redirect,
        // so the request can and must carry the client's DPoP header.
        const binding = await resolveIssuanceBinding();

        if (binding.error) {
            auditTrail.record({
                user: { email: oAuthResponse.email, uid },
                device: { userAgent: parameters.userAgent },
                action: 'OAUTH_SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'HandleOAuthCallback.js',
                functionName: 'handleOAuthCallback',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'OAuth sign in failed - device binding could not be established',
                metadata: { provider, reason: 'DPOP_BINDING_FAILED', proofReason: binding.reason },
                errorCode: binding.errorCode
            });
            return { error: true, errorCode: binding.errorCode };
        }

        const accessToken = await generateAccessToken(
            uid,
            oAuthResponse.email,
            parameters.fingerprint,
            `PROVIDER-${provider.trim().toUpperCase()}`,
            'USER',
            parameters.ip,
            parameters.userAgent,
            null,
            binding.jkt
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
            accessToken.accessTokenLinkCode,
            0,
            null,
            binding.jkt
        );

        if (refreshToken.error) {
            return { error: true, errorCode: refreshToken.errorCode };
        }

        const response = {
            signedIn: true
        };

        const systemConfig = systemConfigModule.getModule();

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

    if (results.error && results.errorCode === 'GENERAL::UNKNOWN-ERROR::A::i') {
        return { error: true, errorCode: 'OAUTH::CALLBACK-PROCESSING-FAILED::A::i' };
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

    if (callback.error && callback.errorCode !== 'DEVICE-AUTH::AUTHORIZATION-STARTED::A::p') {
        return respondWithError(response, callback.errorCode);
    }

    if (callback?.cookies) {
        for (const cookie of callback.cookies) {
            if (cookie.maxAge === 0) {
                clearManagedCookie(response, cookie.key);
            } else {
                setManagedCookie(response, cookie.key, cookie.data);
            }
        }
    }

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    clearManagedCookie(response, 'oAuthFlowSecret');

    delete callback.cookies;

    return respondWithSuccess(response, 200, callback);
};

export { handleOAuthCallback, routeHandlerHandleOAuthCallback };
