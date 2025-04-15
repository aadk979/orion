const { respondWithError } = require("../Response/response");

const expectedHeaderKeys = [
    'accept',
    'host',
    'user-agent',
    'accept-encoding',
    'accept-language',
    'referer',
    'x-request-id',
    'x-real-ip',
    'x-forwarded-port',
    'x-forwarded-scheme',
    'x-original-uri',
    'x-scheme',
    'sec-fetch-site',
    'priority',
    'sec-fetch-mode',
    'sec-fetch-dest',
    'x-original-proto',
    'x-forwarded-proto',
    'x-forwarded-host',
    'x-forwarded-for',
    'proxy-connection'
];

const orionHeaders = [
    "orion-fingerprint",
    "orion-user-agent",
]

class headerParser {
    constructor(systemConfig) {
        if (!systemConfig) {
            throw new Error("System config is required for server startup");
        }

        headerParser.systemConfig = systemConfig;
    }

    verifyHeader(request, response, next) {
        if (request.get("x-orion-cross-origin") === "TRUE") {
            const userHeaders = headerParser.systemConfig.api.customHeaders.map(value => value.toLowerCase());
            const requestHeaders = Object.keys(request.headers).map(value => value.toLowerCase());
            const allHeaders = [...userHeaders, ...orionHeaders];

            const missingHeaders = allHeaders.filter(header => !requestHeaders.includes(header));
            if (missingHeaders.length > 0) {
                return respondWithError(response, "HEADERS-INVALID");
            }

            return next();
        }

        if (request.get("x-original-uri") === "/") {
            const userHeaders = headerParser.systemConfig.api.customHeaders.map(value => value.toLowerCase());
            const requestHeaders = Object.keys(request.headers).map(value => value.toLowerCase());
            const allHeaders = [...userHeaders, ...expectedHeaderKeys, ...orionHeaders];

            const missingHeaders = allHeaders.filter(header => !requestHeaders.includes(header));
            if (missingHeaders.length > 0) {
                return respondWithError(response, "HEADERS-INVALID");
            }

            const extraHeaders = requestHeaders.filter(header => !allHeaders.includes(header));
            if (extraHeaders.length > 0) {
                return respondWithError(response, "HEADERS-INVALID");
            }

            next();
        }

        const userHeaders = headerParser.systemConfig.api.customHeaders.map(value => value.toLowerCase());
        const requestHeaders = Object.keys(request.headers).map(value => value.toLowerCase());
        const allHeaders = [...userHeaders, ...expectedHeaderKeys, ...orionHeaders];
    
        const missingHeaders = allHeaders.filter(header => !requestHeaders.includes(header));
        if (missingHeaders.length > 1) {
            return respondWithError(response , "HEADERS-INVALID");
        }
    
        const extraHeaders = requestHeaders.filter(header => !allHeaders.includes(header));
        if (extraHeaders.length > 1) {
            return respondWithError(response , "HEADERS-INVALID");
        }

        next();
    }

    parseHeader(request, response, next) {
        request.userHeaders = {};
        request.orionHeaders = {};
        request.expectedHeaders = {};

        const lowerUserHeaders = headerParser.systemConfig.api.customHeaders.map(h => h.toLowerCase());
        const lowerOrionHeaders = orionHeaders.map(h => h.toLowerCase());
        const lowerExpectedHeaders = expectedHeaderKeys.map(h => h.toLowerCase());

        for (const [originalKey, value] of Object.entries(request.headers)) {
            const lowerKey = originalKey.toLowerCase();

            if (lowerUserHeaders.includes(lowerKey)) {
                request.userHeaders[originalKey] = value;
            } else if (lowerOrionHeaders.includes(lowerKey)) {
                request.orionHeaders[originalKey] = value;
            } else if (lowerExpectedHeaders.includes(lowerKey)) {
                request.expectedHeaders[originalKey] = value;
            }
        }

        next();
    }
}

module.exports = { headerParser }