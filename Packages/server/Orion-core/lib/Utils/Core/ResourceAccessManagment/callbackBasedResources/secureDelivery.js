import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { respondWithFile, respondWithBuffer } from '../dirBasedResources/fileResponse.js';
import { respondWithResourceUrl } from '../s3BasedResources/urlResponse.js';
import { respondWithError } from '../../../../Server/Response/response.js';

const normalizeAccessType = value => (typeof value === 'string' ? value.toUpperCase().trim() : 'NONE');

// Post-token-validation half of the secure resource flow: allowlist -> callback config
// lookup -> access-type binding -> callback invocation -> delivery (buffer or S3 URL).
const deliverSecureResource = async (response, { filePath, viewMode, requestedAccessType, tokenData, customData }) => {
    if (!tokenData.accessibleCallbacks.includes(filePath)) {
        return response
            .status(403)
            .json({ status: 'error', code: 'TOKEN-RESOURCE::NOT-AUTHORIZED::A::p', message: 'Access denied. You are not authorized to view this resource.' });
    }

    const callbacks = globalAccessPoint.resourceAccessSystem_Config();

    const callbackConfig = callbacks.find(val => val.callbackPath === filePath);

    if (!callbackConfig) {
        return await respondWithFile(response, false, null, true);
    }

    // The requested mode, the token's minted viewType and the registered callback's
    // accessType must all agree — a SECURE-0 token must not unlock an S3-0 callback.
    const requestedType = normalizeAccessType(requestedAccessType);
    if (requestedType !== normalizeAccessType(tokenData.viewType) || normalizeAccessType(callbackConfig.accessType) !== requestedType) {
        return response
            .status(403)
            .json({ status: 'error', code: 'TOKEN-RESOURCE::ACCESS-TYPE-MISMATCH::A::p', message: 'Access denied. The resource token does not match the requested access mode.' });
    }

    const callbackResult = await callbackConfig.callback(tokenData, customData);

    if (requestedType === 'S3-0') {
        if (callbackResult?.error) {
            return respondWithError(response, 'RAS-S3::CALLBACK-FAILED::A::i');
        }

        const sent = respondWithResourceUrl(response, callbackResult);

        if (sent.error) {
            return respondWithError(response, sent.errorCode);
        }

        return;
    }

    if (callbackResult?.error) {
        response.status(500).send('SERVER ERROR: Unable to obtain resource!');
        response.end();
        return;
    }

    return await respondWithBuffer(response, callbackResult.base64File, callbackResult.mimeType, viewMode);
};

export { deliverSecureResource };
