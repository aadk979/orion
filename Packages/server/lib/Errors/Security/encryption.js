const Encryption = {
    "ENCRYPTION-REQUEST-ID-MISSING": {
        status: 400,
        context: "The encryption request ID is missing",
        errorCode: "ENCRYPTION-REQUEST-ID-MISSING",
        fault: "CLIENT",
        solutions: ["Provide a valid encryption request ID"]
    },
    "ENCRYPTION-REQUEST-ID-INVALID": {
        status: 400,
        context: "The encryption request ID provided is invalid",
        errorCode: "ENCRYPTION-REQUEST-ID-INVALID",
        fault: "CLIENT",
        solutions: ["Provide a valid encryption request ID"]
    },
    "ENCRYPTED-STRING-MISSING": {
        status: 400,
        context: "The encrypted string is missing",
        errorCode: "ENCRYPTED-STRING-MISSING",
        fault: "CLIENT",
        solutions: ["Provide the encrypted string"]
    },
    "ENCRYPTION-STATUS-INVALID": {
        status: 400,
        context: "The encryption status provided is invalid",
        errorCode: "ENCRYPTION-STATUS-INVALID",
        fault: "CLIENT",
        solutions: ["Provide a valid encryption status"]
    },
    "ENCRYPTION-KEY": {
        status: 500,
        context: "An error occurred with the encryption key",
        errorCode: "ENCRYPTION-KEY",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    }
};

export { Encryption };

