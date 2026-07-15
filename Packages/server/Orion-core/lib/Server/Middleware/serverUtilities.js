import { __Status__, __Version__ } from '../../orion.meta.js';
import { routeHandlerResetCookies } from '../../Utils/Core/SecurityManagment/CookieReset.js';
import { formatTime, getCurrentUnixTime } from '../../Utils/Date&Time.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { errorTrackerSystem } from '../../Utils/Systems/ErrorTrackerSystem.js';
import { respondWithError } from '../Response/response.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'serverUtilities.js');
const serverModule = new SafeModuleHandler('ServerState', 'server', 'serverUtilities.js');
const memoryMonitoringSystemModule = new SafeModuleHandler('MemoryMonitoringSystem', 'memoryMonitioringSystem', 'serverUtilities.js');
const eventLoopMonitorModule = new SafeModuleHandler('EventLoopMonitor', 'eventLoopMonitor', 'serverUtilities.js');
const loadSheddingSystemModule = new SafeModuleHandler('LoadSheddingSystem', 'loadSheddingSystem', 'serverUtilities.js');
const circuitBreakerSystemModule = new SafeModuleHandler('CircuitBreakerSystem', 'circuitBreakerSystem', 'serverUtilities.js');
const abuseDetectionSystemModule = new SafeModuleHandler('AbuseDetectionSystem', 'abuseDetectionSystem', 'serverUtilities.js');


const serverUtilitiesMiddleware = async (request, response, next) => {
    const systemConfig = systemConfigModule.getModule();
    const server = serverModule.getModule();

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
                memory: memoryMonitoringSystemModule.probeModule()?.getMemoryStats() || null,
                eventLoop: eventLoopMonitorModule.probeModule()?.getStats() || null,
                loadShedder: loadSheddingSystemModule.probeModule()?.getStats() || null,
                circuitBreakers: circuitBreakerSystemModule.probeModule()?.getAllStates() || {},
                abuseDetection: abuseDetectionSystemModule.probeModule()?.getStats() || null,
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

        return respondWithError(response, 'GENERAL::UNKNOWN-API-ROUTE::A::p');
    }

    return next();
};

export { serverUtilitiesMiddleware };