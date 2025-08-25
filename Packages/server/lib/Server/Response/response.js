const { internalErrors } = require("../../Errors/internal-errors");
const { logger } = require("../../Utils/logger");

const respondWithError = (response , errorCode) => {
    
    if(!internalErrors[errorCode]){
        logger.warn(`Unrecognised error code: ${errorCode}`)
    }

    response.header({ "orion-response-status": internalErrors[errorCode]?.customStatus || internalErrors[errorCode]?.status });

    const error = internalErrors[errorCode] || internalErrors["UNKNOWN-ERROR"];
    response.status(error.status).json( { error: true , errorData: { ...error } } );
    response.end();
    return;
}

const respondWithSuccess = (response , status = 200 , data, customStatus) => {

    response.header({ "orion-response-status": customStatus || status });

    response.status(status).json( { error: false , data: data } );
    response.end();
    return;
}

module.exports = { respondWithError , respondWithSuccess }