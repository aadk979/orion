import { AsyncLocalStorage } from 'async_hooks';
import { generateRequestId } from '../../Utils/valueGenerator.js';
import { getIp } from '../../Utils/Ip.js';

const requestContext = new AsyncLocalStorage();

const requestMetadataMiddleware = (request, response, next) => {
    const metadata = {
        requestId: generateRequestId("REQUEST_METADATA_SYSTEM_ID", 36),
        fingerprint: request.headers["orion-fingerprint"],
        userAgent: request.headers["orion-user-agent"],
        ip: getIp(request),
        cookies: request.cookies,
        user: request.user || "UN-AUTHED"
    };
    
    requestContext.run(metadata, () => next());
}

export { requestMetadataMiddleware, requestContext };