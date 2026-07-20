import { respondWithSuccess } from '../../../Server/Response/response.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { clearManagedCookie } from '../../CookieUtils.js';

const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'SignOutUser.js');

const routeHandlerSignOutUser = async (request, response) => {
    const auditTrail = auditTrailSystemModule.getModule();
    const requestMetadata = requestContext.getStore();

    if (request.user) {
        clearManagedCookie(response, 'ACCESS_TOKEN');

        clearManagedCookie(response, 'REFRESH_TOKEN');

        auditTrail.record({
            user: {
                email: request.user.email,
                uid: request.user.uid
            },
            device: {
                fingerprint: requestMetadata?.fingerprint,
                userAgent: requestMetadata?.userAgent
            },
            action: 'USER_SIGN_OUT_SUCCESS',
            status: 'SUCCESS',
            source: 'SignOutUser.js',
            functionName: 'routeHandlerSignOutUser',
            requestId: requestMetadata?.requestId,
            ipAddress: requestMetadata?.ip,
            impact: 'User successfully signed out',
            metadata: {
                method: 'COOKIE_CLEAR',
                tokensCleared: ['ACCESS_TOKEN', 'REFRESH_TOKEN']
            }
        });

        return respondWithSuccess(response, 200, { signedOut: true });
    }

    auditTrail.record({
        user: {},
        device: {
            fingerprint: requestMetadata?.fingerprint,
            userAgent: requestMetadata?.userAgent
        },
        action: 'USER_SIGN_OUT_ATTEMPT',
        status: 'FAILED',
        source: 'SignOutUser.js',
        functionName: 'routeHandlerSignOutUser',
        requestId: requestMetadata?.requestId,
        ipAddress: requestMetadata?.ip,
        impact: 'Sign out attempt failed - no authenticated user',
        metadata: { reason: 'NO_AUTHENTICATED_USER' },
        errorCode: 'NO_AUTHENTICATED_USER'
    });

    return;
};

export { routeHandlerSignOutUser };
