import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';

const serverStatusMiddlware = (request, response, next) => {
    const etsLockdown = globalAccessPoint.ETS_LOCKDOWN();
    const orionSystemsControlServerLock = globalAccessPoint.getValue("OrionSystemsControlServerLock");

    if (orionSystemsControlServerLock) {
        return respondWithError(response, 'SERVER-LOCKDOWN');
    }

    if (etsLockdown) {
        return respondWithError(response, 'SERVER-UNHEALTHY');
    }

    const systemsReady = globalAccessPoint.volatileSecretsManager().ready();

    if (!systemsReady) {
        return respondWithError(response, 'SERVER-INITIALIZING');
    }

    return next();
};

export { serverStatusMiddlware };