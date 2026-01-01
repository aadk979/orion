import { respondWithError } from '../Response/response.js';

const orionHeaders = [
    'orion-fingerprint',
    'orion-user-agent',
    'orion-dip-state',
    'orion-dip-id',
    'orion-dip-signature',
    'orion-dip-salt',
    'orion-dip-timestamp',
    'orion-encryption-status',
    'orion-encryption-request-id',
    'orion-api-system-version'
];

class headerParser {
    constructor(systemConfig) {
        if (!systemConfig) {
            throw new Error('System config is required for server startup');
        }

        headerParser.systemConfig = systemConfig;
    }

    verifyHeader(request, response, next) {
        const requiredHeaders = [...orionHeaders];

        const missingOrInvalidHeaders = requiredHeaders.filter(header => {
            const value = request.get(header);
            return typeof value !== 'string' || value.trim() === '';
        });

        if (missingOrInvalidHeaders.length > 0) {
            return respondWithError(response, 'HEADERS-INVALID');
        }

        next();
    }
}

export { headerParser };
