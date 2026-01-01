import { __Status__, __Version__ } from '../../orion.meta.js';
import { routeHandlerResetCookies } from '../../Utils/Core/SecurityManagment/CookieReset.js';
import { formatTime, getCurrentUnixTime } from '../../Utils/Date&Time.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';

const serverUtilitiesMiddleware = async (request, response, next) => {
    const systemConfig = globalAccessPoint.systemConfig();
    const server = globalAccessPoint.getValue('server');

    const path = request.path;

    if (path.startsWith('/server-utilities')) {
        if (path.startsWith('/server-utilities/health')) {

            const memData = globalAccessPoint.getValue('memoryMonitioringSystem').getMemoryStats();

            const etsLockdown = globalAccessPoint.getValue('ETS_LOCKDOWN');

            const timeOfLife = globalAccessPoint.getValue('timeOfLife');

            const uptime = formatTime((getCurrentUnixTime() - timeOfLife) * 1000);

            const returnData = {
                alive: true,
                status: etsLockdown ? 'UNHEALTHY' : 'HEALTHY',
                serverLockdownStatus: server,
                serviceId: systemConfig.serviceID,
                memoryUsage: memData,
                uptime,
                timestamp: getCurrentUnixTime(),
                orionSystemInfo: {
                    __Version__,
                    __Status__
                }
            };

            response.status(200).json(returnData);
            return;
        }

        // Cookie reset endpoint is at the top of the middlware chain to prevent edge cases where the endpoint is unreachable due to middlware conflict
        if (path.startsWith('/server-utilities/reset-client-cookies')) {
            return routeHandlerResetCookies(request, response);
        }

        return respondWithError(response, 'UNKNOWN-API-ROUTE');
    }

    return next();
};

export { serverUtilitiesMiddleware };