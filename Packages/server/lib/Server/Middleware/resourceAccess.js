import { validateResourceToken } from "../../Utils/Core/ResourceAccessManagment/callbackBasedResources/resourceTokens.js";
import { respondWithFile } from "../../Utils/Core/ResourceAccessManagment/dirBasedResources/fileResponse.js";
import { fileExists, getSafePath } from "../../Utils/Core/ResourceAccessManagment/dirBasedResources/utils.js";
import { globalAccessPoint } from "../../Utils/GlobalAccessPoint.js";
import { getIp } from "../../Utils/Ip.js";
import { tryCatch } from "../../Utils/TryCatch.js"
import { fileURLToPath } from 'url';

const resourceAccessMiddleware = async (request, response, next) => {

    const Function = async (parameters) => {
        const path = parameters.request.path;
        const accessType = parameters.request.query["accessType"] || "public";
        const ip = getIp(parameters.request);
        const clientUrl = parameters.request.headers.origin || parameters.request.headers.referer || `${parameters.request.protocol}://${parameters.request.get('host')}`;

        if (!path.split("/").includes("resource-access-oras")) {
            return next();
        }

        if (accessType.toLowerCase().trim() === "public") {
            
            const viewMode = parameters.request.query["view"] === "true";

            const filePath = parameters.request.query["path"] || "default_orion.txt";

            const safePath = getSafePath(filePath);

            const existCheck = fileExists(safePath);

            if (!existCheck) {
                await respondWithFile(parameters.response, false, null, viewMode);
                return;
            }

            await respondWithFile(parameters.response, true, safePath, viewMode);

            return;
        }

        if (accessType.toLowerCase().trim() === "secure-0") {
            const filePath = parameters.request.query["path"] || "NONE";
            const token = parameters.request.query["token"];

            const tokenValidation = await validateResourceToken(token, undefined, ip, clientUrl);

            if (tokenValidation?.errorCode === "RESOURCE-TOKEN-EXPIRED") {
                return parameters.response.status(401).json({
                    status: "error",
                    code: "RESOURCE-TOKEN-EXPIRED",
                    message: "Access denied. The resource token has expired."
                });
            }
            
            if (tokenValidation.error) {
                return parameters.response.status(401).json({
                    status: "error",
                    code: tokenValidation.errorCode || "RESOURCE-TOKEN-VALIDATION-FAILED",
                    message: "Access denied. Unable to validate the resource token."
                });
            }
            
            if (!tokenValidation.valid) {
                return parameters.response.status(401).json({
                    status: "error",
                    code: "RESOURCE-TOKEN-INVALID",
                    message: "Access denied. The provided resource token is invalid."
                });
            }
            
            if (!tokenValidation.data.accessibleCallbacks.includes(filePath)) {
                return parameters.response.status(403).json({
                    status: "error",
                    code: "RESOURCE-TOKEN-NOT-AUTHORIZED",
                    message: "Access denied. You are not authorized to view this resource or it does not exist."
                });
            }            

            const callbacks = globalAccessPoint.getValue("resourceAccessSystem_Config");

            if (!callbacks.find(val => val.callbackPath === filePath)) {
                await respondWithFile(parameters.response, false, null, true);
                return;
            }

            const callbackConfig = callbacks.find(val => val.callbackPath === filePath);

            const callback = await callbackConfig.callback(tokenValidation.data, tokenValidation.customData);

            if (callback?.error) {
                parameters.response.status(500).send("SERVER ERROR: Unable to obtain resource!");
                parameters.response.end();
                return;
            }

            const base64File = callback.base64File;

            const buffer = Buffer.from(base64File, "base64");

            const type = callback.mimeType;

            parameters.response.removeHeader("Content-Security-Policy");
            parameters.response.removeHeader("X-Content-Type-Options");
            parameters.response.removeHeader("X-Download-Options");
            parameters.response.set("Content-Type", type);
            parameters.response.send(buffer);
            return;
        }
        
        return next();
    }

    const parameters = {
        request,
        response,
        next
    }

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'resourceAccessMiddleware', functionSource);
}

export { resourceAccessMiddleware }