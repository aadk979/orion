const DeviceAuthorization = {
    "DEVICE-UNRECOGNIZED": {
        status: 401,
        context: "The device is not recognised and requires authorisation",
        errorCode: "DEVICE-UNRECOGNIZED",
        fault: "CLIENT",
        solutions: ["Complete device authorisation process"]
    },
    "UNABLE-TO-SEND-DEVICE-AUTHORIZATION-EMAIL": {
        status: 500,
        context: "Unable to send device authorisation email due to server error",
        errorCode: "UNABLE-TO-SEND-DEVICE-AUTHORIZATION-EMAIL",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "DEVICE-AUTHORIZATION-AUTHORIZATION-REQUEST-EXPIRED": {
        status: 401,
        context: "The device authorisation request has expired",
        errorCode: "DEVICE-AUTHORIZATION-AUTHORIZATION-REQUEST-EXPIRED",
        fault: "CLIENT",
        solutions: ["Start a new device authorisation process"]
    },
    "DEVICE-AUTHORIZATION-USERAGENT-MISMATCH": {
        status: 401,
        context: "Device authorisation user agent does not match the original request",
        errorCode: "DEVICE-AUTHORIZATION-USERAGENT-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DEVICE-AUTHORIZATION-IP-MISMATCH": {
        status: 401,
        context: "Device authorisation IP address does not match the original request",
        errorCode: "DEVICE-AUTHORIZATION-IP-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DEVICE-AUTHORIZATION-FINGERPRINT-MISMATCH": {
        status: 401,
        context: "Device authorisation fingerprint does not match the original request",
        errorCode: "DEVICE-AUTHORIZATION-FINGERPRINT-MISMATCH",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DEVICE-AUTHORIZATION-INVALID-CODE": {
        status: 401,
        context: "The device authorisation code is invalid",
        errorCode: "DEVICE-AUTHORIZATION-INVALID-CODE",
        fault: "CLIENT",
        solutions: ["Use the correct authorisation code from your email"]
    },
    "DEVICE-MISSING-META-DATA": {
        status: 401,
        context: "The expected device metadata is missing",
        errorCode: "DEVICE-MISSING-META-DATA",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "DEVICE-AUTHORIZATION-MISSING-REQUEST-ID": {
        status: 400,
        context: "The expected device authorization request id is missing",
        errorCode: "DEVICE-AUTHORIZATION-MISSING-REQUEST-ID",
        fault: "CLIENT",
        solutions: ["NONE"]
    }
};

export { DeviceAuthorization };