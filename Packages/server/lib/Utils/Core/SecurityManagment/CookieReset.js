// This route handles recovery from inconsistent or corrupted authentication states.
// Use case: if a user manually deletes one or more critical cookies (e.g., SID, ACCESS_TOKEN)
// while other valid cookies remain, they can end up "locked out" — unable to authenticate
// or restore the missing cookie since all API routes block them.
//
// Calling this route clears all cookies (including auth-related ones), forcing the user
// into a clean reauthentication flow. This provides a self-service way to recover without
// waiting for cookies to naturally expire.

const { respondWithSuccess } = require("../../../Server/Response/response");

const routeHandlerResetCookies = async (request, response) => {
    const cookies = request.cookies;
    
    if (cookies && Object.keys(cookies).length > 0) {
        Object.keys(cookies).forEach(cookieName => {
            response.cookie(cookieName, "", { httpOnly: true, secure: true, sameSite: "None", maxAge: 0, path: "/" });
            response.cookie(cookieName, "", { httpOnly: true, secure: true, sameSite: "None", maxAge: 0, path: "/api" });
        });
    }
    
    const commonCookieNames = ["ACCESS_TOKEN", "REFRESH_TOKEN", "SID", "SID_HMAC", "NO_AUTH_TOKEN"];
    
    commonCookieNames.forEach(cookieName => {
        response.cookie(cookieName, "", { httpOnly: true, secure: true, sameSite: "None", maxAge: 0, path: "/" });
    });
    
    return respondWithSuccess(response, 200, { cookiesReset: true });
}

module.exports = { routeHandlerResetCookies }