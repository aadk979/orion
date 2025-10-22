import { internalErrors } from '../../Errors/internal-errors.js';
import { logger } from '../../Utils/logger.js';

const respondWithError = (response , errorCode) => {
    
    if(!internalErrors[errorCode]){
        logger.warn(`Unrecognised error code: ${errorCode}`)
    }

    response.header({ "orion-response-status": internalErrors[errorCode]?.customStatus || internalErrors[errorCode]?.status });

    response.setHeader("Access-Control-Expose-Headers", "Orion-Flow-Activation, orion-flow-activation");

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

export { respondWithError , respondWithSuccess };;