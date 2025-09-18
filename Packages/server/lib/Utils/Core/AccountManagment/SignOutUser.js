const { respondWithSuccess, respondWithError } = require("../../../Server/Response/response");

const routeHandlerSignOutUser = async (request, response) => {
    if (request.user) {
        response.cookie("ACCESS_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

        response.cookie("REFRESH_TOKEN", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

        response.cookie("SID", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

        response.cookie("SID_HMAC", "" , { httpOnly: true , secure: true , sameSite: "None" , maxAge: 0 });

        return respondWithSuccess(response, 200, { signedOut: true });
    }

    return;
}

module.exports = { routeHandlerSignOutUser }