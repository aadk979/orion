import { AsyncLocalStorage } from 'async_hooks';
import ipaddr from 'ipaddr.js';
import { getIp } from '../../Utils/Ip.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';

const RULES = [
    {
        applyTo: 'fingerprint',
        mustHave: true,
        missingError: 'MISSING-REQUEST-FINGERPRINT',
        invalidError: 'INVALID-REQUEST-FINGERPRINT',
        callback: (fp) => typeof fp === 'string' && /^[0-9a-fA-F]{64}$/.test(fp)
    },
    {
        applyTo: 'userAgent',
        mustHave: true,
        missingError: 'MISSING-USER-AGENT',
        invalidError: null,
        callback: null
    },
    {
        applyTo: 'ip',
        mustHave: true,
        missingError: 'UNRESOLVABLE-CLIENT-IP',
        invalidError: 'UNRESOLVABLE-CLIENT-IP',
        callback: (ip) => {
            try {
                const parsed = ipaddr.parse(ip);
                const kind = parsed.kind();
                if (kind !== 'ipv4' && kind !== 'ipv6') return false;
                const range = parsed.range();
                return range !== 'unspecified' && range !== 'Reserved';
            } catch {
                return false;
            }
        }
    }
];

const evaluateRules = (metadata) => {
    for (const rule of RULES) {
        const value = metadata[rule.applyTo];
        const absent = value === undefined || value === null || value === '';

        if (absent) {
            if (rule.mustHave) return rule.missingError;
            continue;
        }

        if (typeof rule.callback === 'function') {
            let passed = false;
            try { passed = rule.callback(value); } catch { passed = false; }
            if (!passed && rule.invalidError) return rule.invalidError;
        }
    }

    return null;
};

const requestContext = new AsyncLocalStorage();

const requestMetadataMiddleware = (request, response, next) => {
    const metadata = {
        fingerprint: request.headers['orion-fingerprint'],
        userAgent: request.headers['orion-user-agent'] || request.headers['user-agent'],
        ip: (() => { try { return getIp(request); } catch { return null; } })(),
        cookies: request.cookies,
        user: request.user || false,
        clientURL: request.headers.origin || request.headers.referer || `${request.protocol}://${request.get('host')}`
    };

    const violation = evaluateRules(metadata);
    if (violation) return respondWithError(response, violation);

    response.set('orion-served-by', globalAccessPoint.systemConfig().app.serviceID);

    request.requestContext = requestContext;
    requestContext.run(Object.freeze(metadata), () => next());
};

export { requestMetadataMiddleware, requestContext };