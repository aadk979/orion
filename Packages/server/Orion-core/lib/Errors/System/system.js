const System = {
    'SYSTEM::TOKEN-SECRETS-EXPORT-FAILED::A::i': {
        status: 500,
        context: 'An error occurred during automatic token secrets export',
        errorCode: 'SYSTEM::TOKEN-SECRETS-EXPORT-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'SYSTEM::INTERNAL-ERROR::A::i': {
        status: 500,
        context: 'An internal server error has occurred',
        errorCode: 'SYSTEM::INTERNAL-ERROR::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'SYSTEM::AUDIT-NOT-INITIALIZED::A::i': {
        status: 500,
        context: 'The audit system has not been initialized',
        errorCode: 'SYSTEM::AUDIT-NOT-INITIALIZED::A::i',
        fault: 'SERVER',
        solutions: ['Contact support to initialize the audit system']
    },
    'SYSTEM::AUDIT-INSERT-FAILED::A::i': {
        status: 500,
        context: 'Failed to insert audit record',
        errorCode: 'SYSTEM::AUDIT-INSERT-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'SYSTEM::UNHEALTHY::A::i': {
        status: 503,
        context: 'The server is currently in an unhealthy state and cannot process requests',
        errorCode: 'SYSTEM::UNHEALTHY::A::i',
        fault: 'SERVER',
        solutions: ['Try again in a few minutes and contact support if the issue persists']
    },
    'SYSTEM::OVERLOADED::A::i': {
        status: 503,
        context: 'The server is currently overloaded and cannot accept new requests',
        errorCode: 'SYSTEM::OVERLOADED::A::i',
        fault: 'SERVER',
        solutions: ['Try again shortly — the server is under high load']
    },
    'SYSTEM::REQUEST-BLOCKED-ABUSE::A::p': {
        status: 403,
        context: 'This request has been blocked due to suspicious activity from your device or network',
        errorCode: 'SYSTEM::REQUEST-BLOCKED-ABUSE::A::p',
        fault: 'CLIENT',
        solutions: ['Wait for the temporary block to expire and contact support if you believe this is a mistake']
    },
    'SYSTEM::CIRCUIT-BREAKER-OPEN::A::i': {
        status: 503,
        context: 'A required service dependency is temporarily unavailable',
        errorCode: 'SYSTEM::CIRCUIT-BREAKER-OPEN::A::i',
        fault: 'SERVER',
        solutions: ['Try again in a few minutes — the service is recovering from an error state']
    },
    'SYSTEM::MODULE-UNAVAILABLE::A::i': {
        status: 500,
        context: 'A required internal module is unavailable and the request cannot be processed',
        errorCode: 'SYSTEM::MODULE-UNAVAILABLE::A::i',
        fault: 'SERVER',
        solutions: ['Try again in a few minutes and contact support if the issue persists']
    },
    'SYSTEM::SIGNING-KEY-UNAVAILABLE::A::i': {
        status: 500,
        context: 'No signing key pair is currently available to sign this token',
        errorCode: 'SYSTEM::SIGNING-KEY-UNAVAILABLE::A::i',
        fault: 'SERVER',
        solutions: ['Try again in a few minutes and contact support if the issue persists']
    }
};

export { System };
