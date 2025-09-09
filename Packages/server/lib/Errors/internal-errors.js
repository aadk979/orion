const internalErrors = {
    "INVALID-PROTOCOL": {
        status: 400,
        context: "The client is not using the HTTPS protocol",
        errorCode: "INVALID-PROTOCOL",
        fault: "CLIENT",
        solutions: [
            "Switch to the HTTPS protocol"
        ]
    },
    "UNKNOWN-ORIGIN": {
        status: 401,
        context: "The client is sending the request from an unknown origin",
        errorCode: "UNKNOWN-ORIGIN",
        fault: "CLIENT",
        solutions: [
            "Send requests from a known origin or modify the config file to allow the new origin"
        ]
    },
    "UNKNOWN-ERROR": {
        status: 500,
        context: "An unknown error has occurred, please try again",
        errorCode: "UNKNOWN-ERROR",
        fault: "SERVER",
        solutions: [
            "Perform the request again after 5 minutes and contact support if the issue persists"
        ]
    },
    "HEADERS-INVALID": {
        status: 400,
        context: "The client has sent invalid headers",
        errorCode: "HEADERS-INVALID",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ]
    },
    "ACC-REG-INVALID-EMAIL": {
        status: 400,
        context: "The email provided is not valid",
        errorCode: "ACC-REG-INVALID-EMAIL",
        fault: "CLIENT",
        solutions: [
            "Check if the email provided is in the proper format, e.g. (example@provider.com)"
        ]
    },
    "ACC-REG-PASSWORD-WEAK": {
        status: 400,
        context: "The provided password was deemed to be insecure",
        errorCode: "ACC-REG-PASSWORD-WEAK",
        fault: "CLIENT",
        solutions: [
            "Try adding numbers or characters to increase your password's security"
        ]
    },
    "ACC-REG-ACC-EXISTS": {
        status: 400,
        context: "There is already an account registered under the provided email",
        errorCode: "ACC-REG-ACC-EXISTS",
        fault: "CLIENT",
        solutions: [
            "Try logging into the account, and if you have forgotten your password, contact support"
        ]
    },
    "ACC-REG-UNABLE-TO-CREATE-ACC": {
        status: 500,
        context: "An unknown error has occurred during the registration process",
        errorCode: "ACC-REG-UNABLE-TO-CREATE-ACC",
        fault: "SERVER",
        solutions: [
            "Try again in 10 minutes and contact support if the issue persists"
        ]
    },
    "DV-INVALID-DATA": {
        status: 400,
        context: "The provided data is not valid for this endpoint",
        errorCode: "DV-INVALID-DATA",
        fault: "CLIENT",
        solutions: [
            "Ensure all incoming data is in the expected and proper format"
        ]
    },
    "ACC-SIGN-IN-INVALID-EMAIL": {
        status: 400,
        context: "The email provided is not valid",
        errorCode: "ACC-SIGN-IN-INVALID-EMAIL",
        fault: "CLIENT",
        solutions: [
            "Check if the email provided is in the proper format, e.g. (example@provider.com)"
        ]
    },
    "ACC-SIGN-IN-ACC-NO-EXISTS": {
        status: 400,
        context: "There is no user associated with the provided email",
        errorCode: "ACC-SIGN-IN-ACC-NO-EXISTS",
        fault: "CLIENT",
        solutions: [
            "Ensure the email is correct or create a new account"
        ]
    },
    "ACC-SIGN-IN-INVALID-PASSWORD": {
        status: 401,
        context: "The provided password is incorrec for the specified email",
        errorCode: "ACC-SIGN-IN-INVALID-PASSWORD",
        fault: "CLIENT",
        solutions: [
            "Ensure the password is correct or reset it"
        ]
    },
    "UNABLE-TO-GENERATE-REFRESH-TOKEN": {
        status: 500,
        context: "An unknown error has occurred during the token generation process",
        errorCode: "UNABLE-TO-GENERATE-REFRESH-TOKEN",
        fault: "SERVER",
        solutions: [
            "Try again in 10 minutes and contact support if the issue persists"
        ]
    },
    "UNABLE-TO-VALIDATE-REFRESH-TOKEN": {
        status: 401,
        customStatus: 600,
        context: "The provided refresh token is invalid",
        errorCode: "UNABLE-TO-VALIDATE-REFRESH-TOKEN",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "REFRESH-TOKEN-EXPIRED": {
        status: 401,
        customStatus: 601,
        context: "The provided refresh token has expired",
        errorCode: "REFRESH-TOKEN-EXPIRED",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "UNABLE-TO-GENERATE-ACCESS-TOKEN": {
        status: 500,
        context: "An unknown error has occurred during the token generation process",
        errorCode: "UNABLE-TO-GENERATE-ACCESS-TOKEN",
        fault: "SERVER",
        solutions: [
            "Try again in 10 minutes and contact support if the issue persists"
        ]
    },
    "UNABLE-TO-VALIDATE-ACCESS-TOKEN": {
        status: 401,
        customStatus: 602,
        context: "The provided access token is invalid",
        errorCode: "UNABLE-TO-VALIDATE-ACCESS-TOKEN",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "ACCESS-TOKEN-EXPIRED": {
        status: 401,
        customStatus: 603,
        context: "The provided access token has expired",
        errorCode: "ACCESS-TOKEN-EXPIRED",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        refresh: true
    },
    "INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE": {
        status: 401,
        context: "The provided access token is invalid for the current IP address",
        errorCode: "INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-COOKIE-KEY-MISMATCH": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-COOKIE-KEY-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-COOKIE-CHALLENGE-MISMATCH": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-COOKIE-CHALLENGE-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-COOKIE-DEVICE-FINGERPRINT-MISMATCH": {
        status: 401,
        context: "The provided access token is invalid for the current device",
        errorCode: "INVALID-ACCESS-TOKEN-COOKIE-DEVICE-FINGERPRINT-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-ID-NOT-FOUND": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-ID-NOT-FOUND",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-TYPE-MISMATCH": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-TYPE-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-ACCESS-TOKEN-TOKEN-CHALLENGE-MISMATCH": {
        status: 401,
        context: "The provided access token is invalid",
        errorCode: "INVALID-ACCESS-TOKEN-TOKEN-CHALLENGE-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE": {
        status: 401,
        context: "The provided refresh token is invalid for the current IP address",
        errorCode: "INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH": {
        status: 401,
        context: "The provided refresh token is invalid for the current device",
        errorCode: "INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND": {
        status: 401,
        context: "The provided refresh token is invalid",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH": {
        status: 401,
        context: "The provided refresh token is invalid",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "INVALID-REFRESH-TOKEN-TOKEN-CHALLENGE-MISMATCH": {
        status: 401,
        context: "The provided refresh token is invalid",
        errorCode: "INVALID-REFRESH-TOKEN-TOKEN-CHALLENGE-MISMATCH",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ],
        logout: true
    },
    "MISSING-AUTHENTICATION-TOKEN": {
        status: 401,
        context: "The token specified for the token type is missing",
        errorCode: "MISSING-AUTHENTICATION-TOKEN",
        fault: "CLIENT",
        solutions: [
            "NONE"
        ]
    }
}

module.exports = { internalErrors }