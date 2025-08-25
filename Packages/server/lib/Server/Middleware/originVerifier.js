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
        try{
            const client = `${request.get('origin')}`;

            // To be updated in prod to only allow HTTPS
            if(request.protocol !== "https" && false){
                return respondWithError(response , "INVALID-PROTOCOL");
            }
    
            if(originVerifier.systemConfig.client.allowAll){
                return next();
            }
    
            if(originVerifier.systemConfig.client.urls.includes(client)){
                return next();
            }
    
            return respondWithError(response , "UNKNOWN-ORIGIN");  
        }
        catch(e){
            console.error(e)
        }
    }
}

module.exports = { originVerifier }