import { globalAccessPoint } from "../../Utils/GlobalAccessPoint.js"
import { respondWithError } from "../Response/response.js";

const serverStatusMiddlware = (request, response, next) => {
    const server = globalAccessPoint.getValue("server");
    const etsLockdown = globalAccessPoint.getValue("ETS_LOCKDOWN");

    if (server.lockdown) {
        return respondWithError(response, "SERVER-LOCKDOWN");
    }

    if (etsLockdown) {
        return respondWithError(response, "SERVER-UNHEALTHY");
    }

    const systemsReady = globalAccessPoint.getValue("volatileSecretsManager").ready() && globalAccessPoint.getValue("tokenSecretsManager").ready();

    if (!systemsReady) {
        return respondWithError(response, "SERVER-INITIALIZING");
    }

    return next();
}

export { serverStatusMiddlware };