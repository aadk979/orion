const { decrypt, importKeyFromBase64 } = require("../../Utils/CryptoFunctions");
const { decryptPrivate } = require("../../Utils/dedicatedCrypto");
const { globalAccessPoint } = require("../../Utils/GlobalAccessPoint");
const { tryCatch } = require("../../Utils/TryCatch");
const { respondWithError } = require("../Response/response");

const decryptionMiddleware = async (request , response, next) => {
    const Function = async (parameters) => {
        const encryptionStatus = parameters.request.headers["orion-encryption-status"] || "NONE";

        if (encryptionStatus === "NONE") {
            return parameters.next();
        }

        if (encryptionStatus === "NOT-ENCRYPTED") {
            return parameters.next();
        }

        if (encryptionStatus === "ENCRYPTED") {
            const encryptionRequestId = parameters.request.headers["orion-encryption-request-id"] || "NONE";

            if (encryptionRequestId === "NONE") {
                return respondWithError(parameters.response , "ENCRYPTION-REQUEST-ID-MISSING");
            }

            const encryptionRequest = await globalAccessPoint.db().getData("encryptionRequests" , encryptionRequestId);

            if (encryptionRequest.data === undefined) {
                return respondWithError(parameters.response , "ENCRYPTION-REQUEST-ID-INVALID");
            }

            const encryptedString = parameters.request.body.packet.encryptedString || "NONE";

            if (encryptedString === "NONE") {
                return respondWithError(parameters.response , "ENCRYPTED-STRING-MISSING");
            }

            const parsedString = JSON.parse(encryptedString);

            const encryptedClientPayload = parsedString.payload;

            const encryptedSecureTransportEncryptionKey = parsedString.encryptedSecureTransportEncryptionKey;

            const decryptedSecureTransportEncryptionKey = await decryptPrivate(encryptedSecureTransportEncryptionKey , encryptionRequest.data.privateKey);

            const decryptedClientPayload = decrypt(encryptedClientPayload, importKeyFromBase64(decryptedSecureTransportEncryptionKey));

            const decryptedDataJSON = JSON.parse(decryptedClientPayload);

            const data = { ...decryptedDataJSON , ...parameters.request.body.packet.nonEncryptedData };

            parameters.request.body.packet = data;

            return parameters.next();
        }

        return respondWithError(parameters.response , "ENCRYPTION-STATUS-INVALID");
    }

    const parameters = {
        request: request,
        response: response,
        next: next
    }

    const result = await tryCatch(Function, true, parameters);

    return;
}

module.exports = { decryptionMiddleware };