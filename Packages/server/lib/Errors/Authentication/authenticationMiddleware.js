const AuthenticationMiddleware = {
    "MISSING-SESSION-ID-OR-SESSION-HMAC": {
        status: 401,
        context: "Either the session ID or session HMAC is missing",
        errorCode: "MISSING-SESSION-ID-OR-SESSION-HMAC",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-SESSION-ID": {
        status: 401,
        context: "The session ID or session HMAC is invalid or has been tampered with",
        errorCode: "INVALID-SESSION-ID",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-AUTHENTICATION-TOKEN-TYPE": {
        status: 401,
        context: "The provided token type is not supported",
        errorCode: "INVALID-AUTHENTICATION-TOKEN-TYPE",
        fault: "CLIENT",
        solutions: ["Use an appropriate and supported token type for this request"]
    },
    "MISSING-AUTHENTICATION-TOKEN": {
        status: 401,
        context: "No authentication token was found",
        errorCode: "MISSING-AUTHENTICATION-TOKEN",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "REFRESH-TOKEN-LIMIT-HIT": {
        status: 401,
        context: "The provided refresh token has reached its maximum limit of allowed refreshes",
        errorCode: "REFRESH-TOKEN-LIMIT-HIT",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "UNAUTHORIZED-TO-ACCESS-PROTECTED-ROUTE": {
        status: 401,
        context: "The provided token is insufficient as this is a protected route",
        errorCode: "UNAUTHORIZED-TO-ACCESS-PROTECTED-ROUTE",
        fault: "CLIENT",
        solutions: ["Use a token with more privileges"]
    },
    "INVALID-BEARER-FOR-CURRENT-ROUTE": {
        status: 401,
        context: "The requested route cannot be accessed with this token type",
        errorCode: "INVALID-BEARER-FOR-CURRENT-ROUTE",
        fault: "CLIENT",
        solutions: ["Use an appropriate and supported token type for this request"]
    }
};

export { AuthenticationMiddleware };
