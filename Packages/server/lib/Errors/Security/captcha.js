const Captcha = {
    "INVALID-CAPTCHA-RESPONSE": {
        status: 400,
        context: "The captcha response is invalid",
        errorCode: "INVALID-CAPTCHA-RESPONSE",
        fault: "CLIENT",
        solutions: ["Complete the captcha challenge correctly"]
    },
    "INVALID-CAPTCHA-TRANSACTION-ID": {
        status: 400,
        context: "The captcha transaction ID is invalid",
        errorCode: "INVALID-CAPTCHA-TRANSACTION-ID",
        fault: "CLIENT",
        solutions: ["Start a new captcha transaction"]
    },
    "CAPTCHA-SYSTEM-VERSION-ERROR": {
        status: 500,
        context: "Captcha system version mismatch error",
        errorCode: "CAPTCHA-SYSTEM-VERSION-ERROR",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "INVALID-CAPTCHA-TRANSACTION-IP": {
        status: 401,
        context: "Captcha transaction IP address does not match the original request",
        errorCode: "INVALID-CAPTCHA-TRANSACTION-IP",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "INVALID-CAPTCHA-TRANSACTION-FINGERPRINT": {
        status: 401,
        context: "Captcha transaction fingerprint does not match the original request",
        errorCode: "INVALID-CAPTCHA-TRANSACTION-FINGERPRINT",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "INVALID-CAPTCHA-TRANSACTION-USERAGENT": {
        status: 401,
        context: "Captcha transaction user agent does not match the original request",
        errorCode: "INVALID-CAPTCHA-TRANSACTION-USERAGENT",
        fault: "CLIENT",
        solutions: ["NONE"]
    },
    "INVALID-CAPTCHA-CODE": {
        status: 400,
        context: "The captcha code is invalid",
        errorCode: "INVALID-CAPTCHA-CODE",
        fault: "CLIENT",
        solutions: ["Enter the correct captcha code"]
    }
};

export { Captcha };