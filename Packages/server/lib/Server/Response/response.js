const { internalErrors } = require("../../Errors/internal-errors")

const respondWithError = (response , errorCode) => {
    const error = internalErrors[errorCode] || internalErrors["UNKNOWN-ERROR"];
    response.status(error.status).json( { error: true , errorData: { ...error } } );
    response.end();
    return;
}

const respondWithSuccess = (response , status = 200 , data) => {
    response.status(status).json( { error: false , data: data } );
    response.end();
    return;
}

module.exports = { respondWithError , respondWithSuccess }