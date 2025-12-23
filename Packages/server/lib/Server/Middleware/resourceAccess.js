import { fileURLToPath } from 'url';
import { respondWithFile, respondWithBuffer } from "../../Utils/Core/ResourceAccessManagment/dirBasedResources/fileResponse.js";
import { fileExists, getSafePath } from "../../Utils/Core/ResourceAccessManagment/dirBasedResources/utils.js";
import { validateResourceToken } from "../../Utils/Core/TokenManagement/ResourceTokens.js";
import { globalAccessPoint } from "../../Utils/GlobalAccessPoint.js";
import { getIp } from "../../Utils/Ip.js";
import { tryCatch } from "../../Utils/TryCatch.js"
import { respondWithError } from "../Response/response.js";

const resourceAccessMiddleware = async (request, response, next) => {

    const Function = async (parameters) => {
        const req = parameters.request;
        const res = parameters.response;
        const nextFunc = parameters.next;

        const pathParam = req.path;
        const accessType = req.query["accessType"] || "public";
        
        if (!pathParam.split("/").includes("resource-access-oras")) {
            return nextFunc();
        }

        const viewMode = req.query["view"] !== "false";
        const queryPath = req.query["path"];

        if (accessType.toLowerCase().trim() === "public") {
            
            const filePath = queryPath || "default_orion.txt";
            const safePath = getSafePath(filePath);

            if (safePath?.error) {
                 return res.status(403).send("Access denied: Invalid path.");
            }

            const existCheck = fileExists(safePath);

            return await respondWithFile(res, existCheck, safePath, viewMode);
        }

        if (accessType.toLowerCase().trim() === "secure-0") {

            const filePath = queryPath || "NONE";
            const token = req.query["token"] || "NONE";
            const ip = getIp(req);
            const clientUrl = req.headers.origin || req.headers.referer || `${req.protocol}://${req.get('host')}`;

            const tokenValidation = await validateResourceToken(token, undefined, ip, clientUrl);

            if (tokenValidation?.errorCode === "RESOURCE-TOKEN-EXPIRED") {
                return res.status(401).json({ status: "error", code: "RESOURCE-TOKEN-EXPIRED", message: "Access denied. The resource token has expired." });
            }
            
            if (tokenValidation.error) {
                return res.status(401).json({ status: "error", code: tokenValidation.errorCode || "RESOURCE-TOKEN-VALIDATION-FAILED", message: "Access denied. Unable to validate the resource token." });
            }
            
            if (!tokenValidation.valid) {
                return res.status(401).json({ status: "error", code: "RESOURCE-TOKEN-INVALID", message: "Access denied. The provided resource token is invalid." });
            }
            
            if (!tokenValidation.data.accessibleCallbacks.includes(filePath)) {
                return res.status(403).json({ status: "error", code: "RESOURCE-TOKEN-NOT-AUTHORIZED", message: "Access denied. You are not authorized to view this resource." });
            }            

            const callbacks = globalAccessPoint.getValue("resourceAccessSystem_Config");

            const callbackConfig = callbacks.find(val => val.callbackPath === filePath);

            if (!callbackConfig) {
                 return await respondWithFile(res, false, null, true);
            }

            const callbackResult = await callbackConfig.callback(tokenValidation.data, tokenValidation.customData);

            if (callbackResult?.error) {
                res.status(500).send("SERVER ERROR: Unable to obtain resource!");
                res.end();
                return;
            }

            return respondWithBuffer(res, callbackResult.base64File, callbackResult.mimeType, viewMode);
        }
        
        return nextFunc();
    }

    const parameters = {
        request,
        response,
        next
    }

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'resourceAccessMiddleware', functionSource);

    if (result?.error) {
        return respondWithError(response, result.errorCode);
    }

    return;
}

export { resourceAccessMiddleware }