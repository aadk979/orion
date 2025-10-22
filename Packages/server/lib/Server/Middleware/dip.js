// DIP (Data Integrity Protocol) middleware.
// The DIP middleware is a key component of data validation and tamper proofing in the Orion system.
// Removing it or modifying it without a deep understanding of its purpose and functionality can lead to data integrity issues and security vulnerabilities.

// DO NOT TOUCH THIS FILE UNLESS YOU ARE SURE OF WHAT YOU ARE DOING.

import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { tryCatch } from '../../Utils/TryCatch.js';
import { respondWithError } from '../../Server/Response/response.js';
import { isIpInRange, getIp } from '../../Utils/Ip.js';
import { generateHmac } from '../../Utils/CryptoFunctions.js';

const NAME_SPACE = globalAccessPoint.nameSpace();

const nonDipRequiredRoutes = [
  `/${NAME_SPACE}/api/v1/action/generate-no-auth-token-transaction`,
  `/${NAME_SPACE}/api/v1/action/generate-no-auth-token`,
  `/${NAME_SPACE}/api/v1/request/have-no-auth-token`,
  `/${NAME_SPACE}/api/v1/action/configure-dip`,
  `/${NAME_SPACE}/api/v1/request/encryption-request-key`,
];

const dipMiddleware = async (request, response, next) => {
  const Function = async (parameters) => {
    if (nonDipRequiredRoutes.includes(parameters.request.path)) {
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

    const ip = getIp(parameters.request);

    if (dipStateHeader === "DEFAULT NONE" || dipStateHeader === "NO DATA") {
      const body = parameters.request.body;

      // Check if the body is empty or not and reject if data is present
      // If DIP state is not given the default assumption is that the body should be empty
      // If DIP state is NO-DATA then the body should also be empty

      if (body && Object.keys(body).length > 0) {
        return respondWithError(
          parameters.response,
          "DIP-STATE-BODY-DATA-PRESENT"
        );
      }

      return parameters.next();
    }

    if (dipIdHeader === "DEFAULT NONE") {
      return respondWithError(
        parameters.response,
        "DIP-STATE-ID-HEADER-MISSING"
      );
    }

    const dipStorage = await globalAccessPoint.db().getData("dip", dipIdHeader);

    if (dipStorage.data === undefined) {
      return respondWithError(parameters.response, "DIP-TIMEDOUT-OR-ID-HEADER-INVALID");
    }

    if (!(await isIpInRange(ip, dipStorage.data.ip))) {
      return respondWithError(parameters.response, "DIP-STATE-IP-MISMATCH");
    }

    if (!dipSignatureHeader || dipSignatureHeader === "DEFAULT NONE") {
      return respondWithError(
        parameters.response,
        "DIP-STATE-SIGNATURE-HEADER-MISSING"
      );
    }

    const payload = parameters.request.body;

    // Check if the payload is empty or not and reject if data is not present as at this point we have estableshed that the payload should not be empty

    if (!payload || Object.keys(payload).length <= 0) {
      return respondWithError(
        parameters.response,
        "DIP-STATE-BODY-DATA-NOT-PRESENT"
      );
    }

    if (dipSaltHeader === "DEFAULT NONE") {
        return respondWithError(parameters.response, "DIP-STATE-MISSING-SALT");
    }

    if (dipTimestampHeader === "DEFAULT NONE") {
        return respondWithError(parameters.response, "DIP-STATE-MISSING-TIMESTAMP");
    }

    const stringPayload = JSON.stringify(payload);

    const hmac = await generateHmac(stringPayload + dipSaltHeader + dipTimestampHeader + userAgent + deviceFingerprint, dipStorage.data.signatureKey);

    if (hmac !== dipSignatureHeader) {
      return respondWithError(
        parameters.response,
        "DIP-STATE-SIGNATURE-MISMATCH"
      );
    }

    return parameters.next();
  };

  const parameters = {
    request: request,
    response: response,
    next: next,
  };

  const result = await tryCatch(Function, true, parameters);
  return;
};

export { dipMiddleware };;
