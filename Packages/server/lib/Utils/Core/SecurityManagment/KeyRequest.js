import { respondWithSuccess, respondWithError } from '../../../Server/Response/response.js';
import { hashString } from '../../CryptoFunctions.js';
import { generateKeyPairDedicated } from '../../dedicatedCrypto.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { getIp } from '../../Ip.js';
import { generateRequestId } from '../../valueGenerator.js';

const routeHandlerKeyRequest = async (request , response) => {
    const keyPair = await generateKeyPairDedicated(2048);

    const publicKey = keyPair.publicKey;
    const privateKey = keyPair.privateKey;

    const requestId = generateRequestId("ENCRYPTION-KEY");

    const data = {
        requestId: requestId,
        publicKey: publicKey,
        privateKey: privateKey,
        ip: getIp(request),
        fingerprint: await hashString(request.headers["orion-fingerprint"]),
    }

    const storage = await globalAccessPoint.db().addData("encryptionRequests", requestId, data);

    if (storage.error) {
        return respondWithError(response, storage.errorCode);
    }

    return respondWithSuccess(response, 200, { requestId: requestId, publicKey: publicKey });
}

export {
    routeHandlerKeyRequest,
};;