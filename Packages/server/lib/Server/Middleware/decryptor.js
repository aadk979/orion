import { decrypt, importKeyFromBase64 } from '../../Utils/CryptoFunctions.js';
import { decryptPrivate, deriveKey, deriveSharedSecret, importPublicKeyECC } from '../../Utils/dedicatedCrypto.js';
import { base64DecodeToUint8 } from '../../Utils/Encoders.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { tryCatch } from '../../Utils/TryCatch.js';
import { respondWithError } from '../Response/response.js';
import { fileURLToPath } from 'url';

const decryptionMiddleware = async (request , response, next) => {
    const Function = async (parameters) => {

        const encryptionStatus = parameters.request.headers["orion-encryption-status"] || "NONE";
        const encryptionAlg = parameters.request.headers["orion-encryption-alg"] || "NONE";

        if (encryptionStatus === "NONE") {
            return parameters.next();
        }

        if (encryptionStatus === "NOT-ENCRYPTED") {
            return parameters.next();
        }

        if (encryptionStatus !== "ENCRYPTED") {
            return respondWithError(parameters.response , "ENCRYPTION-STATUS-INVALID");
        }

        const encryptionRequestId = parameters.request.headers["orion-encryption-request-id"] || "NONE";

        if (encryptionRequestId === "NONE") {
            return respondWithError(parameters.response , "ENCRYPTION-REQUEST-ID-MISSING");
        }

        const encryptionRequest = await globalAccessPoint.getValue("ephemeralDB").getData(encryptionRequestId.split(":*:")[0]);

        if (encryptionRequest.data === undefined) {
            return respondWithError(parameters.response , "ENCRYPTION-REQUEST-ID-INVALID");
        }

        const encryptionConfig = encryptionRequest.data.find(val => val.encryptionId === encryptionRequestId);
    
        if (encryptionConfig === undefined) {
            return respondWithError(parameters.response , "ENCRYPTION-REQUEST-ID-INVALID");
        }

        const encryptedString = parameters.request.body.packet.encryptedString || "NONE";

        if (encryptedString === "NONE") {
            return respondWithError(parameters.response , "ENCRYPTED-STRING-MISSING");
        }

        const parsedString = JSON.parse(encryptedString);

        const encryptedClientPayload = parsedString.payload;

        const encryptedSecureTransportEncryptionKey = parsedString.encryptedSecureTransportEncryptionKey;

        if (encryptionAlg === "RSA") {

            const decryptedSecureTransportEncryptionKey = await decryptPrivate(encryptedSecureTransportEncryptionKey , encryptionConfig.privateKey);

            const decryptedClientPayload = decrypt(encryptedClientPayload, importKeyFromBase64(decryptedSecureTransportEncryptionKey));

            const decryptedDataJSON = JSON.parse(decryptedClientPayload);

            const data = { ...decryptedDataJSON , ...parameters.request.body.packet.nonEncryptedData };

            parameters.request.body.packet = data;

            return parameters.next();
        }

        if (encryptionAlg === "ECC") {
            
            const importedClientPublicKey = await importPublicKeyECC(base64DecodeToUint8(parsedString.eccSpecificData.clientPublicKey), `P-${encryptionConfig.size}`);

            const derivedKey = await deriveSharedSecret(encryptionConfig.privateKey, importedClientPublicKey);

            const transportKeyDecryptionKey = await deriveKey(derivedKey, new TextEncoder().encode(parsedString.eccSpecificData.salt), new TextEncoder().encode(parsedString.eccSpecificData.info));

            const decryptedTransportKey = decrypt(encryptedSecureTransportEncryptionKey, transportKeyDecryptionKey);

            const decryptedClientPayload = decrypt(encryptedClientPayload, importKeyFromBase64(decryptedTransportKey));

            const decryptedDataJSON = JSON.parse(decryptedClientPayload);

            const data = { ...decryptedDataJSON , ...parameters.request.body.packet.nonEncryptedData };

            parameters.request.body.packet = data;

            return parameters.next();
            
        }

        return respondWithError(parameters.response, "ENCRYPTION-ALG-UNKOWN");
    }

    const parameters = {
        request: request,
        response: response,
        next: next
    }

    const functionSource = fileURLToPath(import.meta.url);
    const result = await tryCatch(Function, true, parameters, 'decryptionMiddleware', functionSource);

    if (result?.error) {
        return respondWithError(response, result.errorCode);
    }

    return;
}

export { decryptionMiddleware };