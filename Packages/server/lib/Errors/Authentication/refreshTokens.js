const RefreshTokens = {
    "UNABLE-TO-GENERATE-REFRESH-TOKEN": {
        status: 500,
        context: "An unknown error has occurred during the token generation process",
        errorCode: "UNABLE-TO-GENERATE-REFRESH-TOKEN",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "UNABLE-TO-VALIDATE-REFRESH-TOKEN": {
        status: 401,
        customStatus: 600,
        context: "The provided refresh token is invalid",
        errorCode: "UNABLE-TO-VALIDATE-REFRESH-TOKEN",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "REFRESH-TOKEN-EXPIRED": {
        status: 401,
        customStatus: 601,
        context: "The provided refresh token has expired",
        errorCode: "REFRESH-TOKEN-EXPIRED",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE": {
        status: 401,
        context: "The provided refresh token is invalid for the current IP address",
        errorCode: "INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH": {
        status: 401,
        context: "The provided refresh token is invalid for the current device",
        errorCode: "INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND": {
        status: 401,
        context: "The provided refresh token is invalid",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH": {
        status: 401,
        context: "The provided refresh token is invalid",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-CHALLENGE-MISMATCH": {
        status: 401,
        context: "The provided refresh token is invalid",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-CHALLENGE-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-INVALID-AUD": {
        status: 401,
        context: "The provided refresh token has an invalid audience",
        errorCode: "INVALID-REFRESH-TOKEN-INVALID-AUD",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-ISS-NOT-ALLOWED": {
        status: 401,
        context: "The provided refresh token issuer is not allowed",
        errorCode: "INVALID-REFRESH-TOKEN-ISS-NOT-ALLOWED",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1": {
        status: 401,
        context: "The provided refresh token device fingerprint type 1 does not match",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2": {
        status: 401,
        context: "The provided refresh token device fingerprint type 2 does not match",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2",
        fault: "CLIENT",
        solutions: ["NONE"],
        logout: true
    },
    "REFRESH-TOKEN-KEY-NOT-FOUND": {
        status: 401,
        context: "The refresh token key could not be found",
        errorCode: "REFRESH-TOKEN-KEY-NOT-FOUND",
        fault: "NEITHER",
        solutions: ["NONE"],
        logout: true
    }
};

export { RefreshTokens };
