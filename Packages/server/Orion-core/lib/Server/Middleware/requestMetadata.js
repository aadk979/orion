import { AsyncLocalStorage } from 'async_hooks';
import { getIp } from '../../Utils/Ip.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';

const RULES = [
    { applyTo: "fingerprint", mustHave: true, callback: (fp) => { return fp.length === 64 } },
    { applyTo: "userAgent", mustHave: true, callback: (ua) => { return !ua ? false : !ua.test(/(Mozilla|Chrome|Safari|Firefox|Edge)/i) } },
    { applyTo: "ip", mustHave: true, callback: (ip) => {  } }
]

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
    response.set("orion-served-by", globalAccessPoint.systemConfig().app.serviceID);

    requestContext.run(Object.freeze(metadata), () => next());
};

export { requestMetadataMiddleware, requestContext };