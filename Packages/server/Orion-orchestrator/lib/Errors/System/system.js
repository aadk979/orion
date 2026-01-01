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
    }
};

export { System };
