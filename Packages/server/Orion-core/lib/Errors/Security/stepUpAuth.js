const StepUpAuth = {
    'STEP-UP::REQUIRED::A::p': {
        status: 401,
        customStatus: 601,
        context: 'Step-up authentication is required to complete this request',
        errorCode: 'STEP-UP::REQUIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Complete the step-up authentication flow to re-verify your identity'],
        flow: 'FLOW-STEP-UP-AUTH'
    },
    'STEP-UP::SESSION-EXPIRED::A::p': {
        status: 401,
        context: 'The step-up authentication session has expired',
        errorCode: 'STEP-UP::SESSION-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Restart the step-up authentication flow']
    },
    'STEP-UP::MISSING-CONTEXT::A::p': {
        status: 401,
        context: 'The step-up authentication context is missing',
        errorCode: 'STEP-UP::MISSING-CONTEXT::A::p',
        fault: 'CLIENT',
        solutions: ['The step-up flow was not properly initiated']
    },
    'STEP-UP::INVALID-CODE::A::p': {
        status: 401,
        context: 'The step-up authentication code is invalid',
        errorCode: 'STEP-UP::INVALID-CODE::A::p',
        fault: 'CLIENT',
        solutions: ['Enter the correct code from your email or authenticator app']
    },
    'STEP-UP::USERAGENT-MISMATCH::A::p': {
        status: 401,
        context: 'The step-up authentication browser does not match the original request',
        errorCode: 'STEP-UP::USERAGENT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication from the same browser']
    },
    'STEP-UP::IP-MISMATCH::A::p': {
        status: 401,
        context: 'The step-up authentication IP address is too different from the original request',
        errorCode: 'STEP-UP::IP-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication from the same network']
    },
    'STEP-UP::SECRET-MISMATCH::A::p': {
        status: 401,
        context: 'The step-up authentication flow secret does not match',
        errorCode: 'STEP-UP::SECRET-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Restart the step-up authentication flow']
    },
    'STEP-UP::TOKEN-INVALID::A::p': {
        status: 401,
        context: 'The step-up authentication token is invalid',
        errorCode: 'STEP-UP::TOKEN-INVALID::A::p',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication again']
    },
    'STEP-UP::TOKEN-EXPIRED::A::p': {
        status: 401,
        context: 'The step-up authentication token has expired',
        errorCode: 'STEP-UP::TOKEN-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Complete step-up authentication again']
    },
    'STEP-UP::UNABLE-TO-SEND-EMAIL::A::i': {
        status: 500,
        context: 'Unable to send step-up authentication email',
        errorCode: 'STEP-UP::UNABLE-TO-SEND-EMAIL::A::i',
        fault: 'SERVER',
        solutions: ['Try again in a moment or use a different verification method']
    },
    'STEP-UP::INVALID-TOTP::A::p': {
        status: 401,
        context: 'The TOTP code provided for step-up authentication is invalid',
        errorCode: 'STEP-UP::INVALID-TOTP::A::p',
        fault: 'CLIENT',
        solutions: ['Check the code in your authenticator app and try again']
    }
};

export { StepUpAuth };
