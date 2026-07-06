import { __Status__, __Version__ } from '../../orion.meta.js';
import { routeHandlerResetCookies } from '../../Utils/Core/SecurityManagment/CookieReset.js';
import { formatTime, getCurrentUnixTime } from '../../Utils/Date&Time.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { errorTrackerSystem } from '../../Utils/Systems/ErrorTrackerSystem.js';
import { respondWithError } from '../Response/response.js';

const serverUtilitiesMiddleware = async (request, response, next) => {
    const systemConfig = globalAccessPoint.systemConfig();
    const server = globalAccessPoint.server();

    const path = request.path;

    if (path.startsWith('/server-utilities')) {
        if (path.startsWith('/server-utilities/health')) {
            const etsLockdown = globalAccessPoint.ETS_LOCKDOWN();
            const elmDegraded = !!globalAccessPoint.getValue('ELM_DEGRADED');
            const serverLocked = !!globalAccessPoint.getValue('OrionSystemsControlServerLock');

            const overallStatus = serverLocked ? 'LOCKED' : etsLockdown ? 'UNHEALTHY' : elmDegraded ? 'DEGRADED': 'OK';

            const timeOfLife = globalAccessPoint.timeOfLife();
            const uptime = formatTime((getCurrentUnixTime() - timeOfLife) * 1000);

            const returnData = {
                alive: true,
                status: overallStatus,
                serverLockdownStatus: server,
                serviceId: systemConfig?.app?.serviceID || systemConfig?.serviceID,
                uptime,
                timestamp: getCurrentUnixTime(),
                orionSystemInfo: { __Version__, __Status__ },
                memory: globalAccessPoint.memoryMonitioringSystem()?.getMemoryStats() || null,
                eventLoop: globalAccessPoint.eventLoopMonitor()?.getStats() || null,
                loadShedder: globalAccessPoint.loadSheddingSystem()?.getStats() || null,
                circuitBreakers: globalAccessPoint.circuitBreakerSystem()?.getAllStates() || {},
                abuseDetection: globalAccessPoint.abuseDetectionSystem()?.getStats() || null,
                errors: errorTrackerSystem.getInsightSummary()
            };

            response.status(200).json(returnData);
            return;
        }

        if (path.startsWith('/server-utilities/health/full')) {
            const returnData = {
                errors: errorTrackerSystem.massExport(),
                systemStatus: globalAccessPoint.getValue('orionSystemsControl')?.getSystemStatus() || null
            };
            response.status(200).json(returnData);
            return;
        }

        // Cookie reset endpoint is at the top of the middleware chain to prevent edge cases where the endpoint is unreachable due to middleware conflict
        if (path.startsWith('/server-utilities/reset-client-cookies')) {
            return routeHandlerResetCookies(request, response);
        }

        return respondWithError(response, 'UNKNOWN-API-ROUTE');
    }

    return next();
};

export { serverUtilitiesMiddleware };