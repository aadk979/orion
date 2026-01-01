import { AsyncLocalStorage } from 'async_hooks';
import { getIp } from '../../Utils/Ip.js';

const requestContext = new AsyncLocalStorage();

const requestMetadataMiddleware = (request, response, next) => {
    const metadata = {
        fingerprint: request.headers['orion-fingerprint'],
        userAgent: request.headers['orion-user-agent'] || request.headers['user-agent'],
        ip: getIp(request),
        cookies: request.cookies,
        user: request.user || false,
        clientURL: request.headers.origin || request.headers.referer || `${request.protocol}://${request.get('host')}`
    };

    request.requestContext = requestContext;

    requestContext.run(metadata, () => next());
};

export { requestMetadataMiddleware, requestContext };
