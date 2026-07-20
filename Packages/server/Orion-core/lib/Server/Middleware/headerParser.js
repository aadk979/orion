import { respondWithError } from '../Response/response.js';

// NOTE: The DIP (orion-dip-*) and transport-encryption (orion-encryption-*) headers
// were removed when those subsystems were decommissioned in favour of TLS 1.3.
// See Graveyard/ for the historical record.
const orionHeaders = ['orion-fingerprint', 'orion-user-agent', 'orion-api-system-version'];

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
            return respondWithError(response, 'GENERAL::HEADERS-INVALID::A::p');
        }

        next();
    }
}

export { headerParser };
