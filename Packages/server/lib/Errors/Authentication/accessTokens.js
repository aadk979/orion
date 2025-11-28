const AccessTokens = {
    "UNABLE-TO-GENERATE-ACCESS-TOKEN": {
        status: 500,
        context: "An unknown error has occurred during the token generation process",
        errorCode: "UNABLE-TO-GENERATE-ACCESS-TOKEN",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "UNABLE-TO-VALIDATE-ACCESS-TOKEN": {
        status: 401,
        customStatus: 602,
        context: "The provided access token is invalid",
        errorCode: "UNABLE-TO-VALIDATE-ACCESS-TOKEN",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "ACCESS-TOKEN-EXPIRED": {
        status: 401,
        customStatus: 603,
        context: "The provided access token has expired",
        errorCode: "ACCESS-TOKEN-EXPIRED",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE": {
        status: 401,
        context: "The provided access token is invalid for the current IP address",
        errorCode: "INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-ID-NOT-FOUND": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-ID-NOT-FOUND",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-TYPE-MISMATCH": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-TYPE-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-CHALLENGE-MISMATCH": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-CHALLENGE-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-INVALID-AUD": {
        status: 401,
        context: "The provided access token has an invalid audience",
        errorCode: "INVALID-ACCESS-TOKEN-INVALID-AUD",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-ISS-NOT-ALLOWED": {
        status: 401,
        context: "The provided access token issuer is not allowed",
        errorCode: "INVALID-ACCESS-TOKEN-ISS-NOT-ALLOWED",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1": {
        status: 401,
        context: "The provided access token device fingerprint type 1 does not match",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2": {
        status: 401,
        context: "The provided access token device fingerprint type 2 does not match",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "ACCESS-TOKEN-KEY-NOT-FOUND": {
        status: 401,
        context: "The access token key could not be found",
        errorCode: "ACCESS-TOKEN-KEY-NOT-FOUND",
        fault: "NEITHER",
        solutions: ["NONE"],
        logout: true
    }
};

export { AccessTokens };