const General = {
    'GENERAL::INVALID-PROTOCOL::A::p': {
        status: 400,
        context: 'The client is not using the HTTPS protocol',
        errorCode: 'GENERAL::INVALID-PROTOCOL::A::p',
        fault: 'CLIENT',
        solutions: ['Switch to the HTTPS protocol']
    },
    'GENERAL::UNKNOWN-ORIGIN::A::p': {
        status: 401,
        context: 'The client is sending the request from an unknown origin',
        errorCode: 'GENERAL::UNKNOWN-ORIGIN::A::p',
        fault: 'CLIENT',
        solutions: ['Send requests from a known origin or modify the config file to allow the new origin']
    },
    'GENERAL::UNKNOWN-ERROR::A::i': {
        status: 500,
        context: 'An unknown error has occurred, please try again',
        errorCode: 'GENERAL::UNKNOWN-ERROR::A::i',
        fault: 'SERVER',
        solutions: ['Perform the request again after 5 minutes and contact support if the issue persists']
    },
    'GENERAL::HEADERS-INVALID::A::p': {
        status: 400,
        context: 'The client has sent invalid headers',
        errorCode: 'GENERAL::HEADERS-INVALID::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'GENERAL::UNKNOWN-API-ROUTE::A::p': {
        status: 404,
        context: 'The requested API does not exist',
        errorCode: 'GENERAL::UNKNOWN-API-ROUTE::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'GENERAL::SERVER-LOCKDOWN::A::i': {
        status: 503,
        context: 'The server is currently in lockdown and not accepting requests',
        errorCode: 'GENERAL::SERVER-LOCKDOWN::A::i',
        fault: 'SERVER',
        solutions: ['NONE']
    },
    'GENERAL::SERVER-INITIALIZING::A::i': {
        status: 503,
        context: 'The server is currently initializing. Please try again shortly',
        errorCode: 'GENERAL::SERVER-INITIALIZING::A::i',
        fault: 'SERVER',
        solutions: ['NONE']
    },
    'GENERAL::MISSING-FINGERPRINT::A::p': {
        status: 400,
        context: 'The request is missing a valid device fingerprint',
        errorCode: 'GENERAL::MISSING-FINGERPRINT::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure the orion-fingerprint header is present and contains a valid 64-character fingerprint']
    },
    'GENERAL::INVALID-FINGERPRINT::A::p': {
        status: 400,
        context: 'The provided device fingerprint is malformed',
        errorCode: 'GENERAL::INVALID-FINGERPRINT::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure the orion-fingerprint header contains a valid 64-character fingerprint']
    },
    'GENERAL::MISSING-USER-AGENT::A::p': {
        status: 400,
        context: 'The request is missing a User-Agent header',
        errorCode: 'GENERAL::MISSING-USER-AGENT::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure a valid User-Agent header is included with every request']
    },
    'GENERAL::UNRESOLVABLE-CLIENT-IP::A::p': {
        status: 400,
        context: 'The client IP address could not be determined',
        errorCode: 'GENERAL::UNRESOLVABLE-CLIENT-IP::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure the request includes a valid X-Forwarded-For or remote address']
    },
    'GENERAL::RATE-LIMIT-EXCEEDED::A::p': {
        status: 429,
        context: 'You have sent too many requests in a given amount of time',
        errorCode: 'GENERAL::RATE-LIMIT-EXCEEDED::A::p',
        fault: 'CLIENT',
        solutions: ['Wait for the rate limit to reset before making further requests']
    },
    'GENERAL::PATH-TRAVERSAL::A::p': {
        status: 403,
        context: 'A path traversal attempt was detected',
        errorCode: 'GENERAL::PATH-TRAVERSAL::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    }
};

export { General };
