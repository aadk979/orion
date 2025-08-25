const { respondWithSuccess, respondWithError } = require("../../../Server/Response/response");
const { hashString } = require("../../CryptoFunctions");
const { generateKeyPairDedicated } = require("../../dedicatedCrypto");
const { globalAccessPoint } = require("../../GlobalAccessPoint");
const { getIp } = require("../../Ip");
const { generateRequestId } = require("../../valueGenerator");

const routeHandlerKeyRequest = async (request , response) => {
    const keyPair = await generateKeyPairDedicated(4096);

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

module.exports = {
    routeHandlerKeyRequest,
}