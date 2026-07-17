import { fileURLToPath } from 'url';
import { respondWithFile } from '../../Utils/Core/ResourceAccessManagment/dirBasedResources/fileResponse.js';
import { fileExists, getSafePath } from '../../Utils/Core/ResourceAccessManagment/dirBasedResources/utils.js';
import { deliverSecureResource } from '../../Utils/Core/ResourceAccessManagment/callbackBasedResources/secureDelivery.js';
import { validateResourceToken } from '../../Utils/Core/TokenManagement/ResourceTokens.js';
import { getIp } from '../../Utils/Ip.js';
import { tryCatch } from '../../Utils/TryCatch.js';
import { respondWithError } from '../Response/response.js';

const resourceAccessMiddleware = async (request, response, next) => {
    const Function = async parameters => {
        const req = parameters.request;
        const res = parameters.response;
        const nextFunc = parameters.next;

        const pathParam = req.path;
        const accessType = req.query['accessType'] || 'public';

        if (!pathParam.split('/').includes('resource-access-oras')) {
            return nextFunc();
        }

        const viewMode = req.query['view'] !== 'false';
        const queryPath = req.query['path'];

        if (accessType.toLowerCase().trim() === 'public') {
            const filePath = queryPath || 'default_orion.txt';
            const safePath = getSafePath(filePath);

            if (safePath?.error) {
                return res.status(403).send('Access denied: Invalid path.');
            }

            const existCheck = fileExists(safePath);

            return await respondWithFile(res, existCheck, safePath, viewMode);
        }

        const normalizedAccessType = accessType.toLowerCase().trim();

        if (normalizedAccessType === 'secure-0' || normalizedAccessType === 's3-0') {
            const filePath = queryPath || 'NONE';
            const token = req.query['token'] || 'NONE';
            const ip = getIp(req);
            const clientUrl = req.headers.origin || req.headers.referer || `${req.protocol}://${req.get('host')}`;

            const tokenValidation = await validateResourceToken(token, undefined, ip, clientUrl);

            if (tokenValidation?.errorCode === 'TOKEN-RESOURCE::EXPIRED::A::p') {
                return res.status(401).json({ status: 'error', code: 'TOKEN-RESOURCE::EXPIRED::A::p', message: 'Access denied. The resource token has expired.' });
            }

            if (tokenValidation.error) {
                return res
                    .status(401)
                    .json({
                        status: 'error',
                        code: tokenValidation.errorCode || 'TOKEN-RESOURCE::VALIDATION-FAILED::A::p',
                        message: 'Access denied. Unable to validate the resource token.'
                    });
            }

            if (!tokenValidation.valid) {
                return res
                    .status(401)
                    .json({ status: 'error', code: 'TOKEN-RESOURCE::INVALID::A::p', message: 'Access denied. The provided resource token is invalid.' });
            }

            return await deliverSecureResource(res, {
                filePath,
                viewMode,
                requestedAccessType: normalizedAccessType,
                tokenData: tokenValidation.data,
                customData: tokenValidation.customData
            });
        }

        return nextFunc();
    };

    const parameters = {
        request,
        response,
        next
    };

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'resourceAccessMiddleware', functionSource);

    if (result?.error) {
        return respondWithError(response, result.errorCode);
    }

    return;
};

export { resourceAccessMiddleware };
