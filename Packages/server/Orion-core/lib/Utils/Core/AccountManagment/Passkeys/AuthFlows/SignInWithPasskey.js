import { respondWithError, respondWithSuccess } from '../../../../../Server/Response/response.js';
import { parseDuration } from '../../../../Date&Time.js';
import { getIp } from '../../../../Ip.js';
import { tryCatch } from '../../../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateAccessToken } from '../../../TokenManagement/AccessTokens.js';
import { generateRefreshToken } from '../../../TokenManagement/RefreshTokens.js';
import { resolveIssuanceBinding } from '../../../TokenManagement/internals/dpopBinding.js';
import { veryifyAndCompletePasskeyAuthentication } from '../completeAuthentication.js';
import { setManagedCookie, clearManagedCookie } from '../../../../CookieUtils.js';
import { resolveClientContext } from '../../../../Parsers.js';
import { requestContext } from '../../../../../Server/Middleware/requestMetadata.js';
import { userControl } from '../../UserControl.js';
import { SafeModuleHandler } from '../../../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'SignInWithPasskey.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'SignInWithPasskey.js');

const signInWithPasskey = async (authenticationResponse, cookie, email, clientURL, parsedClientURL, userAgent, fingerprint, ip) => {
    const Function = async parameters => {
        const auditTrail = auditTrailSystemModule.getModule();
        const requestMetadata = requestContext.getStore();
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.passkey) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'PASSKEY_SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignInWithPasskey.js',
                functionName: 'signInWithPasskey',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Passkey sign in blocked - method disabled',
                metadata: { reason: 'PASSKEY_DISABLED' },
                errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i'
            });
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i' };
        }

        const verification = await veryifyAndCompletePasskeyAuthentication(
            parameters.authenticationResponse,
            parameters.cookie,
            parameters.email,
            parameters.expectedOrigin,
            parameters.parsedClientURL
        );

        if (verification.error) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'PASSKEY_SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignInWithPasskey.js',
                functionName: 'signInWithPasskey',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Passkey authentication failed',
                metadata: {
                    reason: 'VERIFICATION_FAILED',
                    errorCode: verification.errorCode
                },
                errorCode: verification.errorCode
            });
            return { error: true, errorCode: verification.errorCode };
        }

        if (!verification.authenticated) {
            auditTrail.record({
                user: { email: parameters.email },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'PASSKEY_SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignInWithPasskey.js',
                functionName: 'signInWithPasskey',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Passkey authentication failed - unable to authenticate',
                metadata: { reason: 'AUTHENTICATION_FAILED' },
                errorCode: 'PASSKEY::AUTH-UNAVAILABLE::A::i'
            });
            return { error: true, errorCode: 'PASSKEY::AUTH-UNAVAILABLE::A::i' };
        }

        // Account state, keyed on the uid the CEREMONY resolved — not on the
        // email the caller sent. Checking by the request's email meant omitting
        // that field skipped the check entirely: the lookup errored, `disabled`
        // came back undefined, and the ceremony's own uid then drove the rest of
        // the flow, so a disabled account signed in and this function reported
        // SIGN_IN_SUCCESS to the audit trail. (The account gate in
        // sessionTokenCore refused the resulting token, so the session was inert
        // — but "issued a session to a disabled account and logged it as a
        // success" is not a state worth relying on a later gate to clean up.)
        const userAccState = await userControl.getUserAccountState().byUid(verification.uid);

        // Both halves: an unresolvable account is refused as firmly as a
        // disabled one. Reading only `disabled` is what let an undefined slip
        // through as "not disabled".
        if (userAccState.error || userAccState.disabled) {
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-ACCOUNT-DISABLED::A::p' };
        }

        // Proof-of-possession binding — see the same call in SignIn.js. Resolved
        // before minting so a binding failure never yields an unbound session.
        const binding = await resolveIssuanceBinding();

        if (binding.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: verification.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'PASSKEY_SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignInWithPasskey.js',
                functionName: 'signInWithPasskey',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Passkey sign in failed - device binding could not be established',
                metadata: { reason: 'DPOP_BINDING_FAILED', proofReason: binding.reason },
                errorCode: binding.errorCode
            });
            return { error: true, errorCode: binding.errorCode };
        }

        const accessToken = await generateAccessToken(
            verification.uid,
            email,
            parameters.fingerprint,
            'PASSKEY',
            'USER',
            parameters.ip,
            parameters.userAgent,
            null,
            binding.jkt
        );

        if (accessToken.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: verification.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'PASSKEY_SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignInWithPasskey.js',
                functionName: 'signInWithPasskey',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Passkey sign in failed - access token generation error',
                metadata: {
                    reason: 'ACCESS_TOKEN_GENERATION_FAILED',
                    errorCode: accessToken.errorCode
                },
                errorCode: accessToken.errorCode
            });
            return { error: true, errorCode: accessToken.errorCode };
        }

        const refreshToken = await generateRefreshToken(
            verification.uid,
            email,
            parameters.fingerprint,
            'PASSKEY',
            'USER',
            parameters.ip,
            parameters.userAgent,
            accessToken.accessTokenLinkCode,
            0,
            null,
            binding.jkt
        );

        if (refreshToken.error) {
            auditTrail.record({
                user: { email: parameters.email, uid: verification.uid },
                device: {
                    fingerprint: parameters.fingerprint,
                    userAgent: parameters.userAgent
                },
                action: 'PASSKEY_SIGN_IN_ATTEMPT',
                status: 'FAILED',
                source: 'SignInWithPasskey.js',
                functionName: 'signInWithPasskey',
                requestId: requestMetadata?.requestId,
                ipAddress: parameters.ip,
                impact: 'Passkey sign in failed - refresh token generation error',
                metadata: {
                    reason: 'REFRESH_TOKEN_GENERATION_FAILED',
                    errorCode: refreshToken.errorCode
                },
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
            user: { email: parameters.email, uid: verification.uid },
            device: {
                fingerprint: parameters.fingerprint,
                userAgent: parameters.userAgent
            },
            action: 'PASSKEY_SIGN_IN_SUCCESS',
            status: 'SUCCESS',
            source: 'SignInWithPasskey.js',
            functionName: 'signInWithPasskey',
            requestId: requestMetadata?.requestId,
            ipAddress: parameters.ip,
            impact: 'User successfully signed in with passkey',
            metadata: {
                method: 'PASSKEY',
                accessTokenGenerated: true,
                refreshTokenGenerated: true
            }
        });

        return { error: false, data: response, completed: true, cookies: [...tokenCookies, ...(accessToken.cookies || [])] };
    };

    const parameters = {
        authenticationResponse,
        cookie,
        email,
        expectedOrigin: clientURL,
        parsedClientURL,
        userAgent,
        fingerprint,
        ip
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'signInWithPasskey', functionSource);

    return results;
};

const routeHandlerSignInWithPasskey = async (request, response) => {
    const cookie = request.cookies['PASSKEY-AUTHENTICATION-INFO-STEP-1'];
    const email = request.body.packet?.email;
    const responseData = request.body.packet?.authenticationResponse;

    const userAgent = request.headers['orion-user-agent'];
    const fingerprint = request.headers['orion-fingerprint'];

    const ip = getIp(request);

    // RP ID is the hostname (no port), and a missing origin is answered rather
    // than thrown — see resolveClientContext in Utils/Parsers.js.
    const clientContext = resolveClientContext(request);

    if (!clientContext) {
        return respondWithError(response, 'GENERAL::UNKNOWN-ORIGIN::A::p');
    }

    const callback = await signInWithPasskey(
        responseData,
        cookie,
        email,
        clientContext.origin,
        clientContext.rpId,
        userAgent,
        fingerprint,
        ip
    );

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback.cookies) {
        for (const cookie of callback.cookies) {
            setManagedCookie(response, cookie.key, cookie.data);
        }
    }

    clearManagedCookie(response, 'PASSKEY-REGISTRATION-INFO-STEP-1');

    return respondWithSuccess(response, 200, callback.data);
};

export { routeHandlerSignInWithPasskey };
