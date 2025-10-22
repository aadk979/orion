import { globalAccessPoint } from "../../Utils/GlobalAccessPoint.js"
import { respondWithError } from "../Response/response.js";

const serverStatusMiddlware = (request, response, next) => {
    const server = globalAccessPoint.getValue("server");

    if (server.lockdown) {
        return respondWithError(response, "SERVER-LOCKDOWN");
    }

    const systemsReady = globalAccessPoint.getValue("volatileSecretsManager").ready() && globalAccessPoint.getValue("tokenSecretsManager").ready();

    if (!systemsReady) {
        return respondWithError(response, "SERVER-INITIALIZING");
    }

    return next();
}

export { serverStatusMiddlware };