const System = {
    'TOKEN-SECRETS-AUTO-EXPORT': {
        status: 500,
        context: 'An error occurred during automatic token secrets export',
        errorCode: 'TOKEN-SECRETS-AUTO-EXPORT',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'INTERNAL-SERVER-ERROR': {
        status: 500,
        context: 'An internal server error has occurred',
        errorCode: 'INTERNAL-SERVER-ERROR',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'AUDIT-SYSTEM-NOT-INITIALIZED': {
        status: 500,
        context: 'The audit system has not been initialized',
        errorCode: 'AUDIT-SYSTEM-NOT-INITIALIZED',
        fault: 'SERVER',
        solutions: ['Contact support to initialize the audit system']
    },
    'AUDIT-INSERT-FAILED': {
        status: 500,
        context: 'Failed to insert audit record',
        errorCode: 'AUDIT-INSERT-FAILED',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'SERVER-UNHEALTHY': {
        status: 503,
        context: 'The server is currently in an unhealthy state and cannot process requests',
        errorCode: 'SERVER-UNHEALTHY',
        fault: 'SERVER',
        solutions: ['Try again in a few minutes and contact support if the issue persists']
    },
    'SERVER-OVERLOADED': {
        status: 503,
        context: 'The server is currently overloaded and cannot accept new requests',
        errorCode: 'SERVER-OVERLOADED',
        fault: 'SERVER',
        solutions: ['Try again shortly — the server is under high load']
    },
    'REQUEST-BLOCKED-ABUSE': {
        status: 403,
        context: 'This request has been blocked due to suspicious activity from your device or network',
        errorCode: 'REQUEST-BLOCKED-ABUSE',
        fault: 'CLIENT',
        solutions: ['Wait for the temporary block to expire and contact support if you believe this is a mistake']
    },
    'CIRCUIT-BREAKER-OPEN': {
        status: 503,
        context: 'A required service dependency is temporarily unavailable',
        errorCode: 'CIRCUIT-BREAKER-OPEN',
        fault: 'SERVER',
        solutions: ['Try again in a few minutes — the service is recovering from an error state']
    }
};

export { System };
