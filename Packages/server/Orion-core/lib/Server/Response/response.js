import { internalErrors } from '../../Errors/internal-errors.js';
import { logger } from '../../Utils/logger.js';

const EXPOSED_HEADERS = ['orion-flow-activation', 'orion-response-refresh', 'orion-served-by'];

const respondWithError = (response, errorCode) => {
    if (!internalErrors[errorCode]) {
        logger.warn(`Unrecognised error code: ${errorCode}`);
    }

    const trueError = internalErrors[errorCode];

    // If the error has a clientSafeErrorCode, swap it out so sensitive details are not exposed
    const clientError = (trueError?.clientSafeErrorCode && internalErrors[trueError.clientSafeErrorCode]) ? internalErrors[trueError.clientSafeErrorCode] : trueError;

    response.setHeader('orion-response-status', clientError?.customStatus || clientError?.status || 'UNKNOWN');

    response.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(', '));

    response.setHeader('orion-response-refresh', clientError?.refresh || false);

    if (clientError?.flow) {
        response.setHeader('orion-flow-activation', clientError.flow);
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