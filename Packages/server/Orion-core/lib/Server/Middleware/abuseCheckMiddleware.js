import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';

const abuseCheckMiddleware = (req, res, next) => {
    const abuseDetection = globalAccessPoint.abuseDetectionSystem();
    if (!abuseDetection) return next();

    const metadata = req.requestContext ? req.requestContext.getStore() : {};
    const ip = metadata?.ip || req.ip;
    const fingerprint = metadata?.fingerprint || req.headers['orion-fingerprint'];

    const check = abuseDetection.isBlocked(ip, fingerprint);
    if (check.blocked) {
        return respondWithError(res, 'REQUEST-BLOCKED-ABUSE');
    }

    return next();
};

export { abuseCheckMiddleware };
