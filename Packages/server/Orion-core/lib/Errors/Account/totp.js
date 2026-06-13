const TOTP = {
    'TOTP-INVALID-TOKEN': {
        status: 401,
        context: 'The TOTP code provided is invalid',
        errorCode: 'TOTP-INVALID-TOKEN',
        fault: 'CLIENT',
        solutions: ['Check the code in your authenticator app and try again']
    },
    'TOTP-NO-PENDING-SECRET': {
        status: 400,
        context: 'No pending TOTP secret found for verification',
        errorCode: 'TOTP-NO-PENDING-SECRET',
        fault: 'CLIENT',
        solutions: ['Generate a new TOTP secret first before verifying']
    },
    'TOTP-NOT-ENABLED': {
        status: 400,
        context: 'TOTP is not enabled on this account',
        errorCode: 'TOTP-NOT-ENABLED',
        fault: 'CLIENT',
        solutions: ['Set up TOTP first before attempting this action']
    },
    'TOTP-ALREADY-ENABLED': {
        status: 400,
        context: 'TOTP is already enabled on this account',
        errorCode: 'TOTP-ALREADY-ENABLED',
        fault: 'CLIENT',
        solutions: ['Remove the existing TOTP setup before creating a new one']
    },
    'TOTP-SYSTEM-DISABLED': {
        status: 400,
        context: 'TOTP has been disabled by the system',
        errorCode: 'TOTP-SYSTEM-DISABLED',
        fault: 'SERVER',
        solutions: ['NONE']
    }
};

export { TOTP };
