import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';
import { logger } from '../../Utils/logger.js';

class originVerifier {
    static systemConfig;

    constructor(systemConfig) {
        if (!systemConfig) {
            throw new Error('System config is required for server startup');
        }

        originVerifier.systemConfig = systemConfig;
    }

    verifyOrigin(request, response, next) {
        try {
            if (request.method === 'OPTIONS') {
                return response.sendStatus(204);
            }

            const origin = request.headers.origin;

            // HTTPS enforcement
            if (originVerifier.systemConfig.client.enforceHTTPS && origin && new URL(origin).protocol !== 'https:' && false) {
                return respondWithError(response, 'INVALID-PROTOCOL');
            }

            if (!origin) {
                return respondWithError(response, 'UNKNOWN-ORIGIN');
            }

            const hostname = new URL(origin).host;
            const allowed = globalAccessPoint.allowedClientUrls();

            const isAllowed = allowed.some(allowedHost =>
                hostname === allowedHost || new URL(allowedHost).host === hostname
            );

            if (isAllowed) {
                return next();
            }

            return respondWithError(response, 'UNKNOWN-ORIGIN');
        } catch (e) {
            logger.error('Origin verification error:', e);
            return respondWithError(response, 'INTERNAL-SERVER-ERROR');
        }
    }

    corsVerifier(origin, callback) {
        try {
            if (!origin) {
                return callback(null, false);
            }

            const parsed = new URL(origin);

            if (originVerifier.systemConfig.client.enforceHTTPS && parsed.protocol !== 'https:' && false) {
                return callback(null, false);
            }

            const allowed = globalAccessPoint.allowedClientUrls();
            const hostname = parsed.host;

            const isAllowed = allowed.some(allowedHost =>
                hostname === allowedHost || new URL(allowedHost).host === hostname
            );

            return callback(null, isAllowed);
        } catch {
            return callback(null, false);
        }
    }
}

export { originVerifier };
