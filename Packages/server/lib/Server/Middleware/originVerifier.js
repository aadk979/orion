const { generateChallenge } = require("../../Utils/valueGenerator");
const { respondWithError } = require("../Response/response");

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

      const clientOrigin = request.get("origin");

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

      if (originVerifier.systemConfig.client.allowAll) {
        return next();
      }

      if (
        originVerifier.systemConfig.client.urls.some((url) =>
          clientOrigin.endsWith(url)
        )
      ) {
        return next();
      }

      return respondWithError(response, "UNKNOWN-ORIGIN");
    } catch (e) {
      console.error(e);
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

    // Allow all if configured
    if (originVerifier.systemConfig.client.allowAll) {
      return callback(null, true);
    }

    // Check allowed URLs
    if (
      originVerifier.systemConfig.client.urls.some((url) =>
        origin.endsWith(url)
      )
    ) {
      return callback(null, true);
    }

    // Default: Block
    return callback(null, false);
  }
}

module.exports = { originVerifier };
