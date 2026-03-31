/**
 * Authentication Middleware – Version 2
 *
 * Handles authentication validation for protected routes, including access token
 * and refresh token verification. Provides secure authentication flow management.
 */
import { validateAccessToken, generateAccessToken } from '../../Utils/Core/TokenManagement/AccessTokens.js';
import { getIp } from '../../Utils/Ip.js';
import { respondWithError, respondWithSuccess } from '../Response/response.js';
import { validateRefreshToken, generateRefreshToken } from '../../Utils/Core/TokenManagement/RefreshTokens.js';
import { validateNoAuthToken } from '../../Utils/Core/SecurityManagment/NoAuthToken.js';
import { defaultServerRoutes } from '../Endpoints/index.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { parseDuration } from '../../Utils/Date&Time.js';
import { parseCookieData, stringifyCookieData } from '../../Utils/CookieUtils.js';
import { slugParser } from '../../Utils/Parsers.js';
import { generateStepUpContextToken } from '../../Utils/Core/SecurityManagment/StepUpAuth.js';
import { requestContext } from './requestMetadata.js';

const NAME_SPACE = globalAccessPoint.nameSpace();

const TOKEN_TYPES = ['ACCESS_BEARER', 'NO_AUTH_BEARER', 'NO_BEARER'];

const ROUTES_ACCESSIBLE_WITH_NO_AUTH_BEARER = [
    `/${NAME_SPACE}/api/v1/action/sign-in-user`,
    `/${NAME_SPACE}/api/v1/action/sign-up-user`,
    `/${NAME_SPACE}/api/v1/request/encryption-request-key`,
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
    `/${NAME_SPACE}/api/v1/request/have-no-auth-token`,
    `/${NAME_SPACE}/api/v1/action/configure-dip`
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
    parameters.response.cookie('ACCESS_TOKEN', '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0 });

    parameters.response.cookie('REFRESH_TOKEN', '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0 });
};

const handleIsAuthStateCheck = parameters => {
    return slugParser(parameters.request.path).split('/')[slugParser(parameters.request.path).split('/').length - 1] === 'get-current-auth-state';
};

const handleValidateEndpoint = (parameters, reqIsAuthStateCheck) => {
    const endpoint = defaultServerRoutes.endpoints.find(item => item.path === slugParser(parameters.request.path));
    const endpointBackUp = globalAccessPoint.systemConfig().api.customEndpoints.find(item => item.path === slugParser(parameters.request.path));

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
    if (slugParser(parameters.request.path) === `/${globalAccessPoint.nameSpace()}/api/v1/action/get-current-auth-state`) {
        return { error: false, setBy: 1, authRequired: true };
    }
};

const handleValidateTokenTypeAndpresence = (parameters, tokenType, noAuthTokenEnabled) => {
    if (!TOKEN_TYPES.includes(tokenType)) {
        return { error: true, errorCode: 'INVALID-AUTHENTICATION-TOKEN-TYPE' };
    }

    if (
        tokenType !== 'NO_BEARER' &&
        tokenType !== 'NO_AUTH_BEARER' &&
        !parameters.request.cookies['ACCESS_TOKEN'] &&
        !parameters.request.cookies['REFRESH_TOKEN']
    ) {
        return { error: true, errorCode: 'MISSING-AUTHENTICATION-TOKEN' };
    }

    if (tokenType === 'NO_AUTH_BEARER' && !parameters.request.cookies['NO_AUTH_TOKEN'] && noAuthTokenEnabled) {
        return { error: true, errorCode: 'MISSING-AUTHENTICATION-TOKEN' };
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
                    if (verification.errorCode === 'STEP-UP-AUTH-REQUIRED') {
                        const uid = verification.uid;
                        const currentMetadata = requestContext.getStore();

                        // Step-up already verified for this uid — allow the request through
                        if (currentMetadata?.stepUpAuthComplete && currentMetadata?.stepUpUid === uid) {
                            parameters.request.user = verification.data;
                            return parameters.next();
                        }

                        // Set a signed step-up context cookie so flow routes can identify the user
                        const stepUpContextToken = await generateStepUpContextToken(uid);
                        parameters.response.cookie('stepUpContext', stepUpContextToken, {
                            httpOnly: true,
                            secure: true,
                            sameSite: 'None',
                            path: '/',
                            maxAge: parseDuration('10m')
                        });

                        return respondWithError(parameters.response, 'STEP-UP-AUTH-REQUIRED');
                        // respondWithError auto-sets: orion-flow-activation: FLOW-STEP-UP-AUTH
                    }
                    // ─────────────────────────────────────────────────────────────────

                    if (verification.errorCode !== 'ACCESS-TOKEN-EXPIRED' && verification.errorCode !== 'MISSING-AUTHENTICATION-TOKEN') {
                        return respondWithError(parameters.response, verification.errorCode);
                    }

                    if (verification.errorCode === 'ACCESS-TOKEN-EXPIRED' || verification.errorCode === 'MISSING-AUTHENTICATION-TOKEN') {
                        if (!parameters.request.cookies['REFRESH_TOKEN']) {
                            return respondWithError(parameters.response, 'MISSING-AUTHENTICATION-TOKEN');
                        }

                        const refreshVerification = await validateRefreshToken(parameters.request.cookies['REFRESH_TOKEN'], fingerprint, ip, clientUrl);

                        if (refreshVerification.error || !refreshVerification.valid) {
                            if (refreshVerification.errorCode === 'STEP-UP-AUTH-REQUIRED') {
                                const uid = refreshVerification.uid;
                                const currentMetadata = requestContext.getStore();

                                if (currentMetadata?.stepUpAuthComplete && currentMetadata?.stepUpUid === uid) {
                                    // Can't proceed without a valid access token — force re-auth
                                    handleSessionClearance(parameters);
                                    return respondWithError(parameters.response, 'MISSING-AUTHENTICATION-TOKEN');
                                }

                                const stepUpContextToken = await generateStepUpContextToken(uid);
                                parameters.response.cookie('stepUpContext', stepUpContextToken, {
                                    httpOnly: true,
                                    secure: true,
                                    sameSite: 'None',
                                    path: '/',
                                    maxAge: parseDuration('10m')
                                });

                                return respondWithError(parameters.response, 'STEP-UP-AUTH-REQUIRED');
                            }

                            return respondWithError(parameters.response, refreshVerification.errorCode);
                        }

                        // Check self-contained refresh limits
                        const currentRefreshCount = refreshVerification.data.refreshCount || 0;
                        const currentMaxRefreshes = refreshVerification.data.maxRefreshes;

                        if (currentMaxRefreshes != null && currentRefreshCount >= currentMaxRefreshes) {
                            handleSessionClearance(parameters);

                            return respondWithError(parameters.response, 'REFRESH-TOKEN-LIMIT-HIT');
                        }

                        const accessTokenLinkCode = refreshVerification.data?.tokenData?.accessTokenLinkCode || refreshVerification.data?.accessTokenLinkCode;

                        const newAccessToken = await generateAccessToken(
                            refreshVerification.data.uid,
                            refreshVerification.data.email,
                            fingerprint,
                            refreshVerification.data.authMethod,
                            refreshVerification.data.role,
                            ip,
                            userAgent,
                            accessTokenLinkCode
                        );

                        if (newAccessToken.error) {
                            return respondWithError(parameters.response, newAccessToken.errorCode);
                        }

                        // Rotate refresh token with incremented count
                        const newRefreshToken = await generateRefreshToken(
                            refreshVerification.data.uid,
                            refreshVerification.data.email,
                            fingerprint,
                            refreshVerification.data.authMethod,
                            refreshVerification.data.role,
                            ip,
                            userAgent,
                            accessTokenLinkCode,
                            currentRefreshCount + 1,
                            currentMaxRefreshes
                        );

                        if (newRefreshToken.error) {
                            return respondWithError(parameters.response, newRefreshToken.errorCode);
                        }

                        verification = await validateAccessToken(newAccessToken.token, fingerprint, ip, clientUrl);

                        if (verification.error || !verification.valid) {
                            return respondWithError(parameters.response, verification.errorCode);
                        }

                        const tokenLifespans = globalAccessPoint.systemConfig().tokens.lifespans;

                        parameters.response.cookie('ACCESS_TOKEN', stringifyCookieData(newAccessToken.token), {
                            httpOnly: true,
                            secure: true,
                            sameSite: 'None',
                            maxAge: parseDuration(tokenLifespans.accessTokens)
                        });

                        parameters.response.cookie('REFRESH_TOKEN', stringifyCookieData(newRefreshToken.token), {
                            httpOnly: true,
                            secure: true,
                            sameSite: 'None',
                            maxAge: parseDuration(tokenLifespans.refreshTokens)
                        });
                    }
                }

                if (reqIsAuthStateCheck) {
                    const responseData = {
                        authed: true
                    };

                    return respondWithSuccess(parameters.response, 200, responseData);
                }

                parameters.request.user = verification.data;

                return parameters.next();

            case 'NO_AUTH_BEARER':
                if (!noAuthTokenEnabled) {
                    return parameters.next();
                }

                if (authRequired) {
                    return respondWithError(parameters.response, 'UNAUTHORIZED-TO-ACCESS-PROTECTED-ROUTE');
                }

                const path = slugParser(parameters.request.path);

                // Step-up flow routes bypass NoAuthToken — they use the signed stepUpContext cookie for identity
                if (STEP_UP_FLOW_ROUTES.includes(path)) {
                    return parameters.next();
                }

                // Check if route exists in the accessible routes for no auth bearer, if not and the route is set by default, return an error. Else verify route was set by the user via setBy and allow access.
                if (!ROUTES_ACCESSIBLE_WITH_NO_AUTH_BEARER.includes(path) && setBy === 1) {
                    return respondWithError(parameters.response, 'INVALID-BEARER-FOR-CURRENT-ROUTE');
                }

                const noAuthToken = parseCookieData(parameters.request.cookies['NO_AUTH_TOKEN']) || 'NONE';

                const noAuthVerification = await validateNoAuthToken(noAuthToken, ip, fingerprint, userAgent);

                if (noAuthVerification.error || !noAuthVerification.valid) {
                    parameters.response.cookie('NO_AUTH_TOKEN', '', { httpOnly: true, secure: true, sameSite: 'None', maxAge: 0 });

                    return respondWithError(parameters.response, noAuthVerification.errorCode);
                }

                return parameters.next();

            case 'NO_BEARER':
                if (!noAuthTokenEnabled) {
                    return parameters.next();
                }

                if (authRequired) {
                    return respondWithError(parameters.response, 'UNAUTHORIZED-TO-ACCESS-PROTECTED-ROUTE');
                }

                if (!ROUTES_ACCESSIBLE_WITH_NO_BEARER.includes(slugParser(parameters.request.path))) {
                    return respondWithError(parameters.response, 'INVALID-BEARER-FOR-CURRENT-ROUTE');
                }

                return parameters.next();

            default:
                return respondWithError(parameters.response, 'INVALID-AUTHENTICATION-TOKEN-TYPE');
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
