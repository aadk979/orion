import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';

const volatileSecretsManagerModule = new SafeModuleHandler('VolatileSecretsManager', 'volatileSecretsManager', 'serverStatus.js');


const serverStatusMiddlware = (request, response, next) => {
    const etsLockdown = globalAccessPoint.ETS_LOCKDOWN();
    const orionSystemsControlServerLock = globalAccessPoint.getValue("OrionSystemsControlServerLock");

    if (orionSystemsControlServerLock) {
        return respondWithError(response, 'GENERAL::SERVER-LOCKDOWN::A::i');
    }

    if (etsLockdown) {
        return respondWithError(response, 'SYSTEM::UNHEALTHY::A::i');  // now defined in Errors/System/system.js
    }

    const systemsReady = volatileSecretsManagerModule.getModule().ready();

    if (!systemsReady) {
        return respondWithError(response, 'GENERAL::SERVER-INITIALIZING::A::i');
    }

    return next();
};

export { serverStatusMiddlware };