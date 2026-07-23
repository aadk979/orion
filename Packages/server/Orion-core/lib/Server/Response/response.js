import { internalErrors } from '../../Errors/internal-errors.js';
import { isAuthFailureCode } from '../../Errors/authFailureCodes.js';
import { logger } from '../../Utils/logger.js';
import { clearManagedCookie } from '../../Utils/CookieUtils.js';
import { requestContext } from '../Middleware/requestContextStore.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';

const abuseDetectionSystemModule = new SafeModuleHandler('AbuseDetectionSystem', 'abuseDetectionSystem', 'response.js');

const EXPOSED_HEADERS = ['orion-flow-activation', 'orion-response-refresh', 'orion-served-by', 'orion-session-logout'];

/**
 * Charge an authentication/challenge failure to the calling actor.
 *
 * Central so that no failure site has to remember to do it — the omission that
 * previously left the AbuseDetectionSystem with no write path at all. Never
 * allowed to throw: failing to record abuse must not turn an error response
 * into a crash.
 */
const recordFailureIfCredentialGuess = errorCode => {
    if (!isAuthFailureCode(errorCode)) return;

    try {
        const abuseDetection = abuseDetectionSystemModule.probeModule();
        if (!abuseDetection) return;

        const metadata = requestContext.getStore();
        if (!metadata?.ip) return;

        abuseDetection.recordAuthFailure(metadata.ip, metadata.fingerprint);
    } catch (e) {
        logger.warn(`Abuse detection: failed to record auth failure for ${errorCode} — ${e.message}`);
    }
};

const respondWithError = (response, errorCode) => {
    if (!internalErrors[errorCode]) {
        logger.warn(`Unrecognised error code: ${errorCode}`);
    }

    recordFailureIfCredentialGuess(errorCode);

    const trueError = internalErrors[errorCode];

    // If the error has a clientSafeErrorCode, swap it out so sensitive details are not exposed
    const clientError =
        trueError?.clientSafeErrorCode && internalErrors[trueError.clientSafeErrorCode] ? internalErrors[trueError.clientSafeErrorCode] : trueError;

    response.setHeader('orion-response-status', clientError?.customStatus || clientError?.status || 'UNKNOWN');

    response.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));

    response.setHeader('orion-response-refresh', clientError?.refresh || false);

    if (clientError?.flow) {
        response.setHeader('orion-flow-activation', clientError.flow);
    }

    // logout-flagged errors mean the session on this device is no longer usable.
    // Tear it down here — every response path used to be responsible for its own
    // cookie clearing and most forgot — and surface the signal as a header so the
    // client SDK can drop its auth state without parsing response bodies.
    if (clientError?.logout === true) {
        clearManagedCookie(response, 'ACCESS_TOKEN');
        clearManagedCookie(response, 'REFRESH_TOKEN');
        response.setHeader('orion-session-logout', 'true');
    }

    const error = clientError || internalErrors['GENERAL::UNKNOWN-ERROR::A::i'];

    if (trueError?.clientSafeErrorCode) {
        logger.warn(`Obfuscated error '${errorCode}' → client receives '${trueError.clientSafeErrorCode}'`);
    }

    // The error trigger field is for quick dev testing where new error codes have not been populated in the error registry and minimize confusion of what the true error is
    response.status(error.status).json({ error: true, errorData: { ...error }, errorTrigger: errorCode });

    return;
};

const respondWithSuccess = (response, status = 200, data, customStatus) => {
    response.header({ 'orion-response-status': customStatus || status });

    response.status(status).json({ error: false, data: data });
    return;
};

export { respondWithError, respondWithSuccess };
