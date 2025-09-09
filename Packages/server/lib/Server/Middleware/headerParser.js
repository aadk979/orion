const { respondWithError } = require("../Response/response");

const orionHeaders = [
    "orion-fingerprint",
    "orion-user-agent",
    "orion-dip-state",
    "orion-dip-id",
    "orion-dip-signature",
    "orion-dip-salt",
    "orion-dip-timestamp",
    "orion-encryption-status",
    "orion-encryption-request-id",
    "orion-api-system-version"
];

class headerParser {
    constructor(systemConfig) {
        if (!systemConfig) {
            throw new Error("System config is required for server startup");
        }

        headerParser.systemConfig = systemConfig;
    }

    verifyHeader(request, response, next) {
        const userHeaders = headerParser.systemConfig.api.customHeaders.map(h => h.toLowerCase());
        const requiredHeaders = [...userHeaders, ...orionHeaders];

        const missingOrInvalidHeaders = requiredHeaders.filter(header => {
            const value = request.get(header);
            return typeof value !== "string" || value.trim() === "";
        });

        if (missingOrInvalidHeaders.length > 0) {
            return respondWithError(response, "HEADERS-INVALID");
        }

        next();
    }

    parseHeader(request, response, next) {
        request.userHeaders = {};
        request.orionHeaders = {};

        const userHeadersSet = new Set(headerParser.systemConfig.api.customHeaders.map(h => h.toLowerCase()));
        const orionHeadersSet = new Set(orionHeaders.map(h => h.toLowerCase()));

        for (const [key, value] of Object.entries(request.headers)) {
            const lowerKey = key.toLowerCase();

            if (userHeadersSet.has(lowerKey)) {
                request.userHeaders[key] = value;
            } else if (orionHeadersSet.has(lowerKey)) {
                request.orionHeaders[key] = value;
            }
        }

        next();
    }
}

module.exports = { headerParser };