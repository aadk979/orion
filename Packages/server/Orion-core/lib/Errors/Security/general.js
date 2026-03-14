const General = {
    'INVALID-PROTOCOL': {
        status: 400,
        context: 'The client is not using the HTTPS protocol',
        errorCode: 'INVALID-PROTOCOL',
        fault: 'CLIENT',
        solutions: ['Switch to the HTTPS protocol']
    },
    'UNKNOWN-ORIGIN': {
        status: 401,
        context: 'The client is sending the request from an unknown origin',
        errorCode: 'UNKNOWN-ORIGIN',
        fault: 'CLIENT',
        solutions: ['Send requests from a known origin or modify the config file to allow the new origin']
    },
    'UNKNOWN-ERROR': {
        status: 500,
        context: 'An unknown error has occurred, please try again',
        errorCode: 'UNKNOWN-ERROR',
        fault: 'SERVER',
        solutions: ['Perform the request again after 5 minutes and contact support if the issue persists']
    },
    'HEADERS-INVALID': {
        status: 400,
        context: 'The client has sent invalid headers',
        errorCode: 'HEADERS-INVALID',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'MISSING-AUTHENTICATION-TOKEN': {
        status: 401,
        context: 'The token specified for the token type is missing',
        errorCode: 'MISSING-AUTHENTICATION-TOKEN',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'MISSING-SESSION-ID-OR-SESSION-HMAC': {
        status: 401,
        context: 'Either the session ID or the session HMAC is missing',
        errorCode: 'MISSING-SESSION-ID-OR-SESSION-HMAC',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'UNKNOWN-API-ROUTE': {
        status: 404,
        context: 'The requested API does not exist',
        errorCode: 'UNKNOWN-API-ROUTE',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'SERVER-LOCKDOWN': {
        status: 503,
        context: 'The server is currently in lockdown and not accepting requests',
        errorCode: 'SERVER-LOCKDOWN',
        fault: 'SERVER',
        solutions: ['NONE']
    },
    'SERVER-INITIALIZING': {
        status: 503,
        context: 'The server is currently initializing. Please try again shortly',
        errorCode: 'SERVER-INITIALIZING',
        fault: 'SERVER',
        solutions: ['NONE']
    },
    'MISSING-REQUEST-FINGERPRINT': {
        status: 400,
        context: 'The request is missing a valid device fingerprint',
        errorCode: 'MISSING-REQUEST-FINGERPRINT',
        fault: 'CLIENT',
        solutions: ['Ensure the orion-fingerprint header is present and contains a valid 64-character fingerprint']
    },
    'INVALID-REQUEST-FINGERPRINT': {
        status: 400,
        context: 'The provided device fingerprint is malformed',
        errorCode: 'INVALID-REQUEST-FINGERPRINT',
        fault: 'CLIENT',
        solutions: ['Ensure the orion-fingerprint header contains a valid 64-character fingerprint']
    },
    'MISSING-USER-AGENT': {
        status: 400,
        context: 'The request is missing a User-Agent header',
        errorCode: 'MISSING-USER-AGENT',
        fault: 'CLIENT',
        solutions: ['Ensure a valid User-Agent header is included with every request']
    },
    'UNRESOLVABLE-CLIENT-IP': {
        status: 400,
        context: 'The client IP address could not be determined',
        errorCode: 'UNRESOLVABLE-CLIENT-IP',
        fault: 'CLIENT',
        solutions: ['Ensure the request includes a valid X-Forwarded-For or remote address']
    }
};

export { General };
