const Passkeys = {
    "PASSKEY-SIGN-IN-DISABLED": {
        status: 400,
        context: "Passkey authentication is disabled for this account",
        errorCode: "PASSKEY-SIGN-IN-DISABLED",
        fault: "CLIENT",
        solutions: ["Use another authentication method"]
    },
    "PASSKEY-REG-INVALID-EMAIL": {
        status: 400,
        context: "The email provided for passkey registration is not valid",
        errorCode: "PASSKEY-REG-INVALID-EMAIL",
        fault: "CLIENT",
        solutions: ["Check if the email provided is in the proper format, e.g. (example@provider.com)"]
    },
    "PASSKEY-ACC-NO-EXIST": {
        status: 400,
        context: "There is no account associated with the provided email for passkey authentication",
        errorCode: "PASSKEY-ACC-NO-EXIST",
        fault: "CLIENT",
        solutions: ["Create an account first or use a different authentication method"]
    },
    "PASSKEY-REGISTRATION-ACTIVE-PASSKEY-DETECTED": {
        status: 400,
        context: "An active passkey registration is already in progress",
        errorCode: "PASSKEY-REGISTRATION-ACTIVE-PASSKEY-DETECTED",
        fault: "CLIENT",
        solutions: ["Delete your old passkey to add a new one"]
    },
    "PASSKEY-AUTH-INVALID-EMAIL": {
        status: 400,
        context: "The email provided for passkey authentication is not valid",
        errorCode: "PASSKEY-AUTH-INVALID-EMAIL",
        fault: "CLIENT",
        solutions: ["Check if the email provided is in the proper format, e.g. (example@provider.com)"]
    },
    "PASSKEY-REGISTRATION-EXPIRED": {
        status: 401,
        context: "The passkey registration session has expired",
        errorCode: "PASSKEY-REGISTRATION-EXPIRED",
        fault: "CLIENT",
        solutions: ["Start a new passkey registration process"]
    },
    "PASSKEY-REGISTRATION-EMAIL-MISMATCH": {
        status: 401,
        context: "The email provided does not match the registration session",
        errorCode: "PASSKEY-REGISTRATION-EMAIL-MISMATCH",
        fault: "CLIENT",
        solutions: ["Use the same email address that was used to start the registration"]
    },
    "PASSKEY-REGISTRATION-FAILED": {
        status: 500,
        context: "Passkey registration failed due to an unknown error",
        errorCode: "PASSKEY-REGISTRATION-FAILED",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "PASSKEY-AUTH-EXPIRED": {
        status: 401,
        context: "The passkey authentication session has expired",
        errorCode: "PASSKEY-AUTH-EXPIRED",
        fault: "CLIENT",
        solutions: ["Start a new passkey authentication process"]
    },
    "PASSKEY-AUTH-EMAIL-MISMATCH": {
        status: 401,
        context: "The email provided does not match the authentication session",
        errorCode: "PASSKEY-AUTH-EMAIL-MISMATCH",
        fault: "CLIENT",
        solutions: ["Use the same email address that was used to start the authentication"]
    },
    "PASSKEY-AUTH-FAILED": {
        status: 500,
        context: "Passkey authentication failed due to an unknown error",
        errorCode: "PASSKEY-AUTH-FAILED",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "PASSKEY-UNABLE-TO-AUTHENTICATE": {
        status: 500,
        context: "Unable to complete passkey authentication due to server error",
        errorCode: "PASSKEY-UNABLE-TO-AUTHENTICATE",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "PASSKEY-AUTH-NO-ACTIVE-PASSKEY": {
        status: 400,
        context: "No active passkey found for authentication",
        errorCode: "PASSKEY-AUTH-NO-ACTIVE-PASSKEY",
        fault: "CLIENT",
        solutions: ["Register a passkey first or use another authentication method"]
    }
};

export { Passkeys };
