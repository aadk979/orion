import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';
import { logger } from '../../Utils/logger.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * True when the origin is https:, or is a loopback origin outside production
 * (browsers already treat loopback as a secure context, and requiring TLS on
 * localhost is what pushed the original enforcement into being disabled).
 */
const isSecureOrigin = origin => {
    try {
        const parsed = new URL(origin);
        if (parsed.protocol === 'https:') return true;
        return process.env.NODE_ENV !== 'production' && LOOPBACK_HOSTS.has(parsed.hostname);
    } catch {
        return false;
    }
};

/**
 * Compares a request origin against the configured allowlist.
 *
 * Full-origin comparison — scheme, host AND port. The previous host-only compare
 * made http://app.example.com and https://app.example.com indistinguishable, so
 * an insecure origin could be accepted by an allowlist that only ever named the
 * secure one. Allowlist entries given as bare hostnames are still honoured
 * (matched on host), because that form is accepted elsewhere in config.
 */
const originIsAllowed = origin => {
    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return false;
    }

    const allowed = globalAccessPoint.allowedClientUrls() || [];

    return allowed.some(entry => {
        if (typeof entry !== 'string' || entry === '') return false;

        try {
            const allowedUrl = new URL(entry);
            return allowedUrl.protocol === parsed.protocol && allowedUrl.host === parsed.host;
        } catch {
            // Bare hostname (or host:port) entry — no scheme to compare against.
            return entry === parsed.host || entry === parsed.hostname;
        }
    });
};

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

            if (!origin) {
                return respondWithError(response, 'GENERAL::UNKNOWN-ORIGIN::A::p');
            }

            // HTTPS enforcement. The `&& false` that used to terminate this
            // condition made client.enforceHTTPS a setting that silently did
            // nothing — presumably a local-development escape hatch. Development
            // is now handled explicitly by exempting loopback origins outside
            // production, so the setting means what it says everywhere else.
            if (originVerifier.systemConfig.client.enforceHTTPS && !isSecureOrigin(origin)) {
                return respondWithError(response, 'GENERAL::INVALID-PROTOCOL::A::p');
            }

            if (!originIsAllowed(origin)) {
                return respondWithError(response, 'GENERAL::UNKNOWN-ORIGIN::A::p');
            }

            return next();
        } catch (e) {
            logger.error('Origin verification error:', e);
            return respondWithError(response, 'SYSTEM::INTERNAL-ERROR::A::i');
        }
    }

    corsVerifier(origin, callback) {
        try {
            if (!origin) {
                return callback(null, false);
            }

            // Same two gates as verifyOrigin, in the same order, so the CORS
            // decision and the request decision can never disagree.
            if (originVerifier.systemConfig.client.enforceHTTPS && !isSecureOrigin(origin)) {
                return callback(null, false);
            }

            return callback(null, originIsAllowed(origin));
        } catch {
            return callback(null, false);
        }
    }
}

export { originVerifier };
