import { internalErrors } from '../../Errors/internal-errors.js';
import { logger } from '../../Utils/logger.js';

const EXPOSED_HEADERS = [
    'orion-flow-activation',
    'orion-response-refresh',
    'orion-dip-failure',
    'orion-served-by',
];

const respondWithError = (response, errorCode) => {
    if (!internalErrors[errorCode]) {
        logger.warn(`Unrecognised error code: ${errorCode}`);
    }

    response.setHeader('orion-response-status', internalErrors[errorCode]?.customStatus || internalErrors[errorCode]?.status || 'UNKNOWN');

    response.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS.join(' ,'));

    response.setHeader('orion-response-refresh', internalErrors[errorCode]?.refresh || false);

    const error = internalErrors[errorCode] || internalErrors['UNKNOWN-ERROR'];

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