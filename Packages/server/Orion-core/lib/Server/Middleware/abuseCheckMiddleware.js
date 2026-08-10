import { respondWithError } from '../Response/response.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';

const abuseDetectionSystemModule = new SafeModuleHandler('AbuseDetectionSystem', 'abuseDetectionSystem', 'abuseCheckMiddleware.js');

const abuseCheckMiddleware = async (req, res, next) => {
    const abuseDetection = abuseDetectionSystemModule.probeModule();
    if (!abuseDetection) return next();

    const metadata = req.requestContext ? req.requestContext.getStore() : {};
    const ip = metadata?.ip || req.ip;
    const fingerprint = metadata?.fingerprint || req.headers['orion-fingerprint'];

    // Async since blocks may live in Redis so they apply across the cluster.
    // A failure to evaluate is not a reason to refuse traffic — the detector
    // already falls back to local state internally, and anything that escapes
    // that lets the request through rather than turning an infrastructure
    // problem into an outage.
    let check;

    try {
        check = await abuseDetection.isBlocked(ip, fingerprint);
    } catch {
        return next();
    }

    if (check.blocked) {
        return respondWithError(res, 'SYSTEM::REQUEST-BLOCKED-ABUSE::A::p');
    }

    return next();
};

export { abuseCheckMiddleware };
