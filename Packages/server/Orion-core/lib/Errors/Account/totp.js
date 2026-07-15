const TOTP = {
    'TOTP::INVALID-TOKEN::A::p': {
        status: 401,
        context: 'The TOTP code provided is invalid',
        errorCode: 'TOTP::INVALID-TOKEN::A::p',
        fault: 'CLIENT',
        solutions: ['Check the code in your authenticator app and try again']
    },
    'TOTP::NO-PENDING-SECRET::A::p': {
        status: 400,
        context: 'No pending TOTP secret found for verification',
        errorCode: 'TOTP::NO-PENDING-SECRET::A::p',
        fault: 'CLIENT',
        solutions: ['Generate a new TOTP secret first before verifying']
    },
    'TOTP::NOT-ENABLED::A::p': {
        status: 400,
        context: 'TOTP is not enabled on this account',
        errorCode: 'TOTP::NOT-ENABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Set up TOTP first before attempting this action']
    },
    'TOTP::ALREADY-ENABLED::A::p': {
        status: 400,
        context: 'TOTP is already enabled on this account',
        errorCode: 'TOTP::ALREADY-ENABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Remove the existing TOTP setup before creating a new one']
    },
    'TOTP::SYSTEM-DISABLED::A::i': {
        status: 400,
        context: 'TOTP has been disabled by the system',
        errorCode: 'TOTP::SYSTEM-DISABLED::A::i',
        fault: 'SERVER',
        solutions: ['NONE']
    }
};

export { TOTP };
