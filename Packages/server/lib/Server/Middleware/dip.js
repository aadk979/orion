/**
 * Data Integrity Protocol (DIP) Middleware
 * 
 * The DIP middleware is a key component of data validation and tamper-proofing
 * in the Orion system. It ensures data integrity and prevents unauthorised
 * modifications.
 * 
 * WARNING: Removing or modifying this middleware without a thorough understanding
 * of its purpose and functionality can lead to data integrity issues and security
 * vulnerabilities.
 * 
 * DO NOT MODIFY THIS FILE UNLESS YOU ARE CERTAIN OF WHAT YOU ARE DOING.
 */

import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { tryCatch } from '../../Utils/TryCatch.js';
import { respondWithError } from '../../Server/Response/response.js';
import { fileURLToPath } from 'url';
import { generateHmac } from '../../Utils/CryptoFunctions.js';
import { slugParser } from '../../Utils/Parsers.js';
import { getCurrentUnixTime } from '../../Utils/Date&Time.js';

const NAME_SPACE = globalAccessPoint.nameSpace();

const nonDipRequiredRoutes = [
  `/${NAME_SPACE}/api/v1/action/generate-no-auth-token-transaction`,
  `/${NAME_SPACE}/api/v1/action/generate-no-auth-token`,
  `/${NAME_SPACE}/api/v1/request/have-no-auth-token`,
  `/${NAME_SPACE}/api/v1/action/configure-dip`,
  `/${NAME_SPACE}/api/v1/request/encryption-request-key`,
];

const setDipFailureHeader = (response) => {
  response.set("orion-dip-failure", "true");
}

const dipMiddleware = async (request, response, next) => {
  const Function = async (parameters) => {
    if (nonDipRequiredRoutes.includes(slugParser(parameters.request.path))) {
      return parameters.next();
    }

    const dipEnabled = globalAccessPoint.getValue("dip");

    if (!dipEnabled) {
        return parameters.next();
    }

    const headers = parameters.request.headers;
    const dipStateHeader = headers["orion-dip-state"] || "DEFAULT NONE";
    const dipIdHeader = headers["orion-dip-id"] || "DEFAULT NONE";
    const dipSignatureHeader = headers["orion-dip-signature"] || "DEFAULT NONE";
    const dipSaltHeader = headers["orion-dip-salt"] || "DEFAULT NONE";
    const dipTimestampHeader = headers["orion-dip-timestamp"] || "DEFAULT NONE";
    const userAgent = headers["orion-user-agent"];
    const deviceFingerprint = headers["orion-fingerprint"]

    if (dipStateHeader === "DEFAULT NONE" || dipStateHeader === "NO DATA") {
      const body = parameters.request.body;

      // Check if the body is empty or not and reject if data is present
      // If DIP state is not given the default assumption is that the body should be empty
      // If DIP state is NO-DATA then the body should also be empty

      if (body && Object.keys(body).length > 0) {
        return respondWithError(parameters.response, "DIP-STATE-BODY-DATA-PRESENT");
      }

      return parameters.next();
    }

    if (dipIdHeader === "DEFAULT NONE") {
      return respondWithError(
        parameters.response,
        "DIP-STATE-ID-HEADER-MISSING"
      );
    }


    // Grabbing the value for the config group (first part of the id)
    const dipStorage = await globalAccessPoint.getValue("ephemeralDB").getData(dipIdHeader.split(":*:")[0] || "DEFAULT")

    // Checking if the fgroup exists in the db
    if (dipStorage.exist === false) {
      setDipFailureHeader(parameters.response);
      return respondWithError(parameters.response, "DIP-TIMEDOUT-OR-ID-HEADER-INVALID");
    }

    // Grabbing the specific config according to the id
    const config = dipStorage.data.find(config => config.dipId === dipIdHeader);

    // Checking if the specific config exists in the array
    if (!config) {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-TIMEDOUT-OR-ID-HEADER-INVALID");
    }

    if (!dipSignatureHeader || dipSignatureHeader === "DEFAULT NONE") {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-STATE-SIGNATURE-HEADER-MISSING");
    }

    const payload = parameters.request.body;

    // Check if the payload is empty or not and reject if data is not present as at this point we have estableshed that the payload should not be empty
    if (!payload || Object.keys(payload).length <= 0) {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-STATE-BODY-DATA-NOT-PRESENT");
    }

    if (dipSaltHeader === "DEFAULT NONE") {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-STATE-MISSING-SALT");
    }

    if (dipTimestampHeader === "DEFAULT NONE") {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-STATE-MISSING-TIMESTAMP-TYPE-1");
    }

    const currentUnix = getCurrentUnixTime();

    const check = (currentUnix - Number(dipTimestampHeader.split("Unix:")[1] || 0));

    if (check === currentUnix) {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-STATE-MISSING-TIMESTAMP-TYPE-2");
    }
    
    if (check >= 30) {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-STATE-WINDOWN-EXPIRED")
    }

    const stringPayload = JSON.stringify(payload);

    const hmac = await generateHmac(stringPayload + dipSaltHeader + dipTimestampHeader + userAgent + deviceFingerprint, config.signatureKey);

    if (hmac !== dipSignatureHeader) {
      setDipFailureHeader(parameters.response)
      return respondWithError(parameters.response, "DIP-STATE-SIGNATURE-MISMATCH");
    }

    return parameters.next();
  };

  const parameters = {
    request: request,
    response: response,
    next: next,
  };

  const functionSource = fileURLToPath(import.meta.url);
  const result = await tryCatch(Function, true, parameters, 'dipMiddleware', functionSource);
  
  if (result?.error) {
    setDipFailureHeader(parameters.response)
    return respondWithError(response, result.errorCode);
  }

  return;
};

export { dipMiddleware };