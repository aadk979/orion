/**
 * Authentication Middleware – Version 2
 *
 * Handles authentication validation for protected routes, including access token
 * and refresh token verification. Provides secure authentication flow management.
 */
import { validateAccessToken, generateAccessToken } from '../../Utils/Core/TokenManagement/AccessTokens.js';
import { getIp } from '../../Utils/Ip.js';
import { respondWithError, respondWithSuccess } from '../Response/response.js';
import { validateRefreshToken, generateRefreshToken, retireRefreshToken } from '../../Utils/Core/TokenManagement/RefreshTokens.js';
import { UserModel } from '../../Utils/Databases/models/index.js';
import { validateNoAuthToken } from '../../Utils/Core/SecurityManagment/NoAuthToken.js';
import { defaultServerRoutes } from '../Endpoints/index.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { parseCookieData, setManagedCookie, clearManagedCookie } from '../../Utils/CookieUtils.js';
import { slugParser } from '../../Utils/Parsers.js';
import { generateStepUpContextToken } from '../../Utils/Core/SecurityManagment/StepUpAuth.js';
import { requestContext } from './requestMetadata.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'authentication.js');

const NAME_SPACE = globalAccessPoint.nameSpace();

// Matches a registered endpoint path (which may contain Express-style `:param`
// segments, e.g. `/todos/:id`) against an actual request path. Segment counts
// must match exactly and only `:`-prefixed segments are wildcards — this keeps
// the allowlist as strict as a literal match for every route that doesn't
// declare params, while letting parameterized custom endpoints resolve.
const pathMatchesPattern = (pattern, actualPath) => {
    if (pattern === actualPath) {
        return true;
    }

    const patternSegments = pattern.split('/');
    const actualSegments = actualPath.split('/');

    if (patternSegments.length !== actualSegments.length) {
        return false;
    }

    return patternSegments.every((segment, index) => segment.startsWith(':') || segment === actualSegments[index]);
};

const TOKEN_TYPES = ['ACCESS_BEARER', 'NO_AUTH_BEARER', 'NO_BEARER'];

const ROUTES_ACCESSIBLE_WITH_NO_AUTH_BEARER = [
    `/${NAME_SPACE}/api/v1/action/sign-in-user`,
    `/${NAME_SPACE}/api/v1/action/sign-up-user`,
    `/${NAME_SPACE}/api/v1/action/generate-passkey-authentication-options`,
    `/${NAME_SPACE}/api/v1/action/sign-in-with-passkey-authentication`,
    `/${NAME_SPACE}/api/v1/action/get-o-auth-redirect-url`,
    `/${NAME_SPACE}/api/v1/action/authorize-me`,
    `/${NAME_SPACE}/api/v1/action/handle-o-auth-callback`,
    `/${NAME_SPACE}/api/v1/request/available-2fa-methods`,
    `/${NAME_SPACE}/api/v1/action/send-device-authorization-email`,
    `/${NAME_SPACE}/api/v1/action/authorize-device-with-passkey`,
    `/${NAME_SPACE}/api/v1/action/authorize-device-with-totp`,
    `/${NAME_SPACE}/api/v1/action/generate-passkey-sign-up-options`,
    `/${NAME_SPACE}/api/v1/action/complete-passkey-sign-up`,
    `/${NAME_SPACE}/api/v1/request/step-up-methods`,
    `/${NAME_SPACE}/api/v1/action/initiate-step-up-email`,
    `/${NAME_SPACE}/api/v1/action/verify-step-up-email`,
    `/${NAME_SPACE}/api/v1/action/generate-step-up-passkey-options`,
    `/${NAME_SPACE}/api/v1/action/verify-step-up-passkey`,
    `/${NAME_SPACE}/api/v1/action/verify-step-up-totp`
];

const ROUTES_ACCESSIBLE_WITH_NO_BEARER = [
    `/${NAME_SPACE}/api/v1/action/generate-no-auth-token-transaction`,
    `/${NAME_SPACE}/api/v1/action/generate-no-auth-token`,
    `/${NAME_SPACE}/api/v1/request/have-no-auth-token`
];

const STEP_UP_FLOW_ROUTES = [
    `/${NAME_SPACE}/api/v1/request/step-up-methods`,
    `/${NAME_SPACE}/api/v1/action/initiate-step-up-email`,
    `/${NAME_SPACE}/api/v1/action/verify-step-up-email`,
    `/${NAME_SPACE}/api/v1/action/generate-step-up-passkey-options`,
    `/${NAME_SPACE}/api/v1/action/verify-step-up-passkey`,
    `/${NAME_SPACE}/api/v1/action/verify-step-up-totp`
];

const handleSessionClearance = parameters => {
    clearManagedCookie(parameters.response, 'ACCESS_TOKEN');

    clearManagedCookie(parameters.response, 'REFRESH_TOKEN');
};

// The auth-state check is a virtual endpoint — it is not in the route registry,
// so handleValidateEndpoint has to special-case it. Compare the WHOLE normalized
// path: matching only the last segment meant any path ending in
// `/get-current-auth-state` was treated as the virtual endpoint by this function
// but rejected by the exact comparison in handleValidateEndpoint, leaving that
// function with no branch to return from.
const AUTH_STATE_PATH = `/${NAME_SPACE}/api/v1/action/get-current-auth-state`;

const handleIsAuthStateCheck = parameters => {
    return slugParser(parameters.request.path) === AUTH_STATE_PATH;
};

const handleValidateEndpoint = (parameters, reqIsAuthStateCheck) => {
    const requestPath = slugParser(parameters.request.path);
    const endpoint = defaultServerRoutes.endpoints.find(item => pathMatchesPattern(item.path, requestPath));
    const endpointBackUp = systemConfigModule.getModule().api.customEndpoints.find(item => pathMatchesPattern(item.path, requestPath));

    if (!endpoint && !endpointBackUp && !reqIsAuthStateCheck) {
        return { error: true, errorCode: 'UNKOWN-API-ROUTE' };
    }

    if (endpoint) {
        // If the endpoint is set by default, we set it to 1, else we set it to 2.
        return { error: false, setBy: 1, authRequired: endpoint.requireAuth };
    }

    if (endpointBackUp) {
        // If the endpoint is set by the developer, we set it to 2, else we set it to 1.
        return { error: false, setBy: 2, authRequired: endpointBackUp.requireAuth };
    }

    // Special virtual endpoint that will not be found in the endpoint registry
    if (slugParser(parameters.request.path) === AUTH_STATE_PATH) {
        return { error: false, setBy: 1, authRequired: true };
    }

    // Every branch above returns. Falling through would hand the caller
    // `undefined`, which it immediately dereferences — so an unresolved path
    // fails closed here rather than as a TypeError.
    return { error: true, errorCode: 'UNKOWN-API-ROUTE' };
};

const handleValidateTokenTypeAndpresence = (parameters, tokenType, noAuthTokenEnabled) => {
    if (!TOKEN_TYPES.includes(tokenType)) {
        return { error: true, errorCode: 'AUTH::INVALID-TOKEN-TYPE::A::p' };
    }

    if (
        tokenType !== 'NO_BEARER' &&
        tokenType !== 'NO_AUTH_BEARER' &&
        !parameters.request.cookies['ACCESS_TOKEN'] &&
        !parameters.request.cookies['REFRESH_TOKEN']
    ) {
        return { error: true, errorCode: 'AUTH::MISSING-TOKEN::A::p' };
    }

    if (tokenType === 'NO_AUTH_BEARER' && !parameters.request.cookies['NO_AUTH_TOKEN'] && noAuthTokenEnabled) {
        return { error: true, errorCode: 'AUTH::MISSING-TOKEN::A::p' };
    }

    return { error: false };
};

const authenticationMiddleware = async (request, response, next) => {
    const Function = async parameters => {
        // When captcha system is disabled all public routes are no longer protected and free to access
        const noAuthTokenEnabled = globalAccessPoint.captcha();

        const headers = parameters.request.headers;
        const fingerprint = headers['orion-fingerprint'];
        const userAgent = headers['orion-user-agent'];
        const ip = getIp(parameters.request);
        const authHeader = headers['authorization'] || 'DEFAULT NONE';
        const clientUrl =
            parameters.request.headers.origin || parameters.request.headers.referer || `${parameters.request.protocol}://${parameters.request.get('host')}`;

        const reqIsAuthStateCheck = handleIsAuthStateCheck(parameters);

        const tokenType = authHeader.split(' ')[0];

        let authRequired = true;
        let setBy;

        const verifyEndpoint = handleValidateEndpoint(parameters, reqIsAuthStateCheck);

        if (verifyEndpoint.error) {
            return respondWithError(parameters.response, verifyEndpoint.errorCode);
        }

        setBy = verifyEndpoint.setBy;
        authRequired = verifyEndpoint.authRequired;

        const softTokenValidation = handleValidateTokenTypeAndpresence(parameters, tokenType, noAuthTokenEnabled);

        if (softTokenValidation.error) {
            return respondWithError(parameters.response, softTokenValidation.errorCode);
        }

        switch (tokenType) {
            case 'ACCESS_BEARER':
                let verification = await validateAccessToken(parameters.request.cookies['ACCESS_TOKEN'], fingerprint, ip, clientUrl);

                if (verification.error || !verification.valid) {
                    // ── Step-Up Auth gate ─────────────────────────────────────────────
                    if (verification.errorCode === 'STEP-UP::REQUIRED::A::p') {
                        const uid = verification.uid;
                        const currentMetadata = requestContext.getStore();

                        // Step-up already verified for this uid — allow the request through
                        if (currentMetadata?.stepUpAuthComplete && currentMetadata?.stepUpUid === uid) {
                            parameters.request.user = verification.data;
                            return parameters.next();
                        }

                        // Set a signed step-up context cookie so flow routes can identify the user
                        const stepUpContextToken = await generateStepUpContextToken(uid);
                        setManagedCookie(parameters.response, 'stepUpContext', stepUpContextToken);

                        return respondWithError(parameters.response, 'STEP-UP::REQUIRED::A::p');
                        // respondWithError auto-sets: orion-flow-activation: FLOW-STEP-UP-AUTH
                    }
                    // ─────────────────────────────────────────────────────────────────

                    if (verification.errorCode !== 'TOKEN-ACCESS::EXPIRED::A::p' && verification.errorCode !== 'AUTH::MISSING-TOKEN::A::p') {
                        return respondWithError(parameters.response, verification.errorCode);
                    }

                    if (verification.errorCode === 'TOKEN-ACCESS::EXPIRED::A::p' || verification.errorCode === 'AUTH::MISSING-TOKEN::A::p') {
                        if (!parameters.request.cookies['REFRESH_TOKEN']) {
                            return respondWithError(parameters.response, 'AUTH::MISSING-TOKEN::A::p');
                        }

                        const refreshVerification = await validateRefreshToken(parameters.request.cookies['REFRESH_TOKEN'], fingerprint, ip, clientUrl);

                        if (refreshVerification.error || !refreshVerification.valid) {
                            if (refreshVerification.errorCode === 'STEP-UP::REQUIRED::A::p') {
                                const uid = refreshVerification.uid;
                                const currentMetadata = requestContext.getStore();

                                if (currentMetadata?.stepUpAuthComplete && currentMetadata?.stepUpUid === uid) {
                                    // Can't proceed without a valid access token — force re-auth
                                    handleSessionClearance(parameters);
                                    return respondWithError(parameters.response, 'AUTH::MISSING-TOKEN::A::p');
                                }

                                const stepUpContextToken = await generateStepUpContextToken(uid);
                                setManagedCookie(parameters.response, 'stepUpContext', stepUpContextToken);

                                return respondWithError(parameters.response, 'STEP-UP::REQUIRED::A::p');
                            }

                            return respondWithError(parameters.response, refreshVerification.errorCode);
                        }

                        // Check self-contained refresh limits
                        const currentRefreshCount = refreshVerification.data.refreshCount || 0;
                        const currentMaxRefreshes = refreshVerification.data.maxRefreshes;

                        if (currentMaxRefreshes != null && currentRefreshCount >= currentMaxRefreshes) {
                            handleSessionClearance(parameters);

                            return respondWithError(parameters.response, 'AUTH::REFRESH-LIMIT-HIT::A::p');
                        }

                        const accessTokenLinkCode = refreshVerification.data?.tokenData?.accessTokenLinkCode || refreshVerification.data?.accessTokenLinkCode;

                        // Authorization claims are re-read from the database, never
                        // carried over from the presented token. Copying `role`
                        // forward made a role change unenforceable: each refresh
                        // seeded the next, so a stale privilege propagated for as
                        // long as the session kept refreshing.
                        const currentUser = await UserModel.getUserByUid(refreshVerification.data.uid);

                        if (!currentUser) {
                            handleSessionClearance(parameters);
                            return respondWithError(parameters.response, 'AUTH::MISSING-TOKEN::A::p');
                        }

                        if (currentUser.disabled) {
                            handleSessionClearance(parameters);
                            return respondWithError(parameters.response, 'ACCOUNT-SIGNIN::ACCOUNT-DISABLED::A::p');
                        }

                        const newAccessToken = await generateAccessToken(
                            currentUser.uid,
                            currentUser.email,
                            fingerprint,
                            refreshVerification.data.authMethod,
                            currentUser.role,
                            ip,
                            userAgent,
                            accessTokenLinkCode
                        );

                        if (newAccessToken.error) {
                            return respondWithError(parameters.response, newAccessToken.errorCode);
                        }

                        // Rotate refresh token with incremented count
                        const newRefreshToken = await generateRefreshToken(
                            currentUser.uid,
                            currentUser.email,
                            fingerprint,
                            refreshVerification.data.authMethod,
                            currentUser.role,
                            ip,
                            userAgent,
                            accessTokenLinkCode,
                            currentRefreshCount + 1,
                            currentMaxRefreshes
                        );

                        if (newRefreshToken.error) {
                            return respondWithError(parameters.response, newRefreshToken.errorCode);
                        }

                        // Retire the token we just rotated away: delete its row so it
                        // stops validating, and remember its id so a later replay is
                        // recognised as reuse rather than as an unknown token. Only
                        // after the replacement exists, so a failure here cannot strand
                        // the session without a usable refresh token.
                        await retireRefreshToken(refreshVerification.data);

                        verification = await validateAccessToken(newAccessToken.token, fingerprint, ip, clientUrl);

                        if (verification.error || !verification.valid) {
                            return respondWithError(parameters.response, verification.errorCode);
                        }

                        setManagedCookie(parameters.response, 'ACCESS_TOKEN', newAccessToken.token);

                        setManagedCookie(parameters.response, 'REFRESH_TOKEN', newRefreshToken.token);
                    }
                }

                if (reqIsAuthStateCheck) {
                    const responseData = {
                        authed: true,
                        user: {
                            uid: verification.data.uid,
                            email: verification.data.email,
                            jti: verification.data?.tokenData?.tokenId || 'STATELESS'
                        }
                    };

                    return respondWithSuccess(parameters.response, 200, responseData);
                }

                parameters.request.user = verification.data;

                return parameters.next();

            case 'NO_AUTH_BEARER':
                // The endpoint's own auth requirement is decided FIRST and is never
                // reachable past a subsystem-disabled shortcut. Disabling the captcha
                // system relaxes anti-automation only — it must never relax the
                // authentication decision for a route that declared requireAuth.
                if (authRequired) {
                    return respondWithError(parameters.response, 'AUTH::INSUFFICIENT-PRIVILEGE::A::p');
                }

                if (!noAuthTokenEnabled) {
                    return parameters.next();
                }

                const path = slugParser(parameters.request.path);

                // Step-up flow routes bypass NoAuthToken — they use the signed stepUpContext cookie for identity
                if (STEP_UP_FLOW_ROUTES.includes(path)) {
                    return parameters.next();
                }

                // Check if route exists in the accessible routes for no auth bearer, if not and the route is set by default, return an error. Else verify route was set by the user via setBy and allow access.
                if (!ROUTES_ACCESSIBLE_WITH_NO_AUTH_BEARER.includes(path) && setBy === 1) {
                    return respondWithError(parameters.response, 'AUTH::BEARER-MISMATCH::A::p');
                }

                const noAuthToken = parseCookieData(parameters.request.cookies['NO_AUTH_TOKEN']) || 'NONE';

                const noAuthVerification = await validateNoAuthToken(noAuthToken, ip, fingerprint, userAgent);

                if (noAuthVerification.error || !noAuthVerification.valid) {
                    clearManagedCookie(parameters.response, 'NO_AUTH_TOKEN');

                    return respondWithError(parameters.response, noAuthVerification.errorCode);
                }

                return parameters.next();

            case 'NO_BEARER':
                // See NO_AUTH_BEARER above — authRequired is evaluated before any
                // subsystem-disabled shortcut can reach next().
                if (authRequired) {
                    return respondWithError(parameters.response, 'AUTH::INSUFFICIENT-PRIVILEGE::A::p');
                }

                if (!noAuthTokenEnabled) {
                    return parameters.next();
                }

                if (!ROUTES_ACCESSIBLE_WITH_NO_BEARER.includes(slugParser(parameters.request.path))) {
                    return respondWithError(parameters.response, 'AUTH::BEARER-MISMATCH::A::p');
                }

                return parameters.next();

            default:
                return respondWithError(parameters.response, 'AUTH::INVALID-TOKEN-TYPE::A::p');
        }
    };

    const parameters = {
        request,
        response,
        next
    };

    const result = await Function(parameters);

    if (result?.error) {
        return respondWithError(response, result.errorCode);
    }

    return;
};

export { authenticationMiddleware };
