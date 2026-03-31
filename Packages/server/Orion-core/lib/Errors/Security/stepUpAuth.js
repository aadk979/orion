const StepUpAuth = {
    'STEP-UP-AUTH-SESSION-EXPIRED': {
        status: 401,
        context: 'The step-up authentication session has expired',
        errorCode: 'STEP-UP-AUTH-SESSION-EXPIRED',
        fault: 'CLIENT',
        solutions: ['Restart the step-up authentication flow']
    },
    'STEP-UP-AUTH-MISSING-CONTEXT': {
        status: 401,
        context: 'The step-up authentication context is missing',
        errorCode: 'STEP-UP-AUTH-MISSING-CONTEXT',
        fault: 'CLIENT',
        solutions: ['The step-up flow was not properly initiated']
    },
    'STEP-UP-AUTH-INVALID-CODE': {
        status: 401,
        context: 'The step-up authentication code is invalid',
        errorCode: 'STEP-UP-AUTH-INVALID-CODE',
        fault: 'CLIENT',
        solutions: ['Enter the correct code from your email or authenticator app']
    },
    'STEP-UP-AUTH-USERAGENT-MISMATCH': {
        status: 401,
        context: 'The step-up authentication browser does not match the original request',
        errorCode: 'STEP-UP-AUTH-USERAGENT-MISMATCH',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication from the same browser']
    },
    'STEP-UP-AUTH-IP-MISMATCH': {
        status: 401,
        context: 'The step-up authentication IP address is too different from the original request',
        errorCode: 'STEP-UP-AUTH-IP-MISMATCH',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication from the same network']
    },
    'STEP-UP-AUTH-SECRET-MISMATCH': {
        status: 401,
        context: 'The step-up authentication flow secret does not match',
        errorCode: 'STEP-UP-AUTH-SECRET-MISMATCH',
        fault: 'CLIENT',
        solutions: ['Restart the step-up authentication flow']
    },
    'STEP-UP-AUTH-TOKEN-INVALID': {
        status: 401,
        context: 'The step-up authentication token is invalid',
        errorCode: 'STEP-UP-AUTH-TOKEN-INVALID',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication again']
    },
    'STEP-UP-AUTH-TOKEN-EXPIRED': {
        status: 401,
        context: 'The step-up authentication token has expired',
        errorCode: 'STEP-UP-AUTH-TOKEN-EXPIRED',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication again']
    },
    'STEP-UP-AUTH-UNABLE-TO-SEND-EMAIL': {
        status: 500,
        context: 'Unable to send step-up authentication email',
        errorCode: 'STEP-UP-AUTH-UNABLE-TO-SEND-EMAIL',
        fault: 'SERVER',
        solutions: ['Try again in a moment or use a different verification method']
    },
    'STEP-UP-AUTH-INVALID-TOTP': {
        status: 401,
        context: 'The TOTP code provided for step-up authentication is invalid',
        errorCode: 'STEP-UP-AUTH-INVALID-TOTP',
        fault: 'CLIENT',
        solutions: ['Check the code in your authenticator app and try again']
    }
};

export { StepUpAuth };
