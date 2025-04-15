const { respondWithError } = require("../Response/response");

class originVerifier {
    static systemConfig;

    constructor (systemConfig) {
        if(!systemConfig){
            throw new Error("System config is required for server startup");
        }

        originVerifier.systemConfig = systemConfig;
    }

    verifyOrigin(request , response , next) {
        const client = request.get("x-forwarded-host");

        if(request.get("x-original-proto") !== "https"){
            return respondWithError(response , "INVALID-PROTOCAL");
        }

        if(originVerifier.systemConfig.client.allowAll){
            return next();
        }

        if(originVerifier.systemConfig.client.urls.includes(client) ||(originVerifier.systemConfig.client.urls.includes("https://" + client))){
            return next();
        }

        return respondWithError(response , "UNKNOWN-ORIGIN");
    }
}

module.exports = { originVerifier }