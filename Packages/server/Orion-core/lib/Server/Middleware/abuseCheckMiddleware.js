import { respondWithError } from '../Response/response.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';

const abuseDetectionSystemModule = new SafeModuleHandler('AbuseDetectionSystem', 'abuseDetectionSystem', 'abuseCheckMiddleware.js');

const abuseCheckMiddleware = (req, res, next) => {
    const abuseDetection = abuseDetectionSystemModule.probeModule();
    if (!abuseDetection) return next();

    const metadata = req.requestContext ? req.requestContext.getStore() : {};
    const ip = metadata?.ip || req.ip;
    const fingerprint = metadata?.fingerprint || req.headers['orion-fingerprint'];

    const check = abuseDetection.isBlocked(ip, fingerprint);
    if (check.blocked) {
        return respondWithError(res, 'SYSTEM::REQUEST-BLOCKED-ABUSE::A::p');
    }

    return next();
};

export { abuseCheckMiddleware };
