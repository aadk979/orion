import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';
import { respondWithError } from '../Response/response.js';
import { logger } from '../../Utils/logger.js';

class originVerifier {
  static systemConfig;

  constructor(systemConfig) {
    if (!systemConfig) {
      throw new Error("System config is required for server startup");
    }

    originVerifier.systemConfig = systemConfig;
  }

  verifyOrigin(request, response, next) {
    try {
      if (request.method === "OPTIONS") {
        return response.sendStatus(204); // No Content, stop here
      }

      const clientOrigin = request.headers.origin || request.headers.referer || `${request.protocol}://${request.get('host')}`;

      // To be updated in prod to only allow HTTPS (Remove && false flag to activate)
      if (
        originVerifier.systemConfig.client.enforceHTTPS &&
        clientOrigin &&
        clientOrigin.split("://")[0] !== "https"
      ) {
        return respondWithError(response, "INVALID-PROTOCOL");
      }

      if (!clientOrigin) {
        return respondWithError(response, "UNKNOWN-ORIGIN");
      }

      if (
        globalAccessPoint.getValue("allowedClientUrls").some((url) =>
          clientOrigin.endsWith(url)
        )
      ) {
        return next();
      }

      return respondWithError(response, "UNKNOWN-ORIGIN");
    } catch (e) {
      logger.error("Origin verification error:", e);
      return respondWithError(response, "INTERNAL-SERVER-ERROR");
    }
  }

  corsVerifier(origin, callback) {
    if (!origin) {
      return callback(null, false); // Block silently, no server crash
    }

    // Enforce HTTPS if enabled
    if (
      originVerifier.systemConfig.client.enforceHTTPS &&
      origin.split("://")[0] !== "https"
    ) {
      return callback(null, false);
    }

    // Check allowed URLs
    if (
      globalAccessPoint.getValue("allowedClientUrls").some((url) =>
        origin.endsWith(url)
      )
    ) {
      return callback(null, true);
    }

    // Default: Block
    return callback(null, false);
  }
}

export { originVerifier };