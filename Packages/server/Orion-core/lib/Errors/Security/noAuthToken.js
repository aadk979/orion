const NoAuthToken = {
    'NO-AUTH-TOKEN::INVALID::A::p': {
        status: 401,
        context: 'The no-auth token is invalid',
        errorCode: 'NO-AUTH-TOKEN::INVALID::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'NO-AUTH-TOKEN::EXPIRED::A::p': {
        status: 401,
        context: 'The no-auth token has expired',
        errorCode: 'NO-AUTH-TOKEN::EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'NO-AUTH-TOKEN::UNAUTHORIZED::A::p': {
        status: 401,
        context: 'The no-auth token is invalid',
        errorCode: 'NO-AUTH-TOKEN::UNAUTHORIZED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'NO-AUTH-TOKEN::NOT-FOUND::A::p': {
        status: 401,
        context: 'The no-auth token was not found',
        errorCode: 'NO-AUTH-TOKEN::NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'NO-AUTH-TOKEN::SYSTEM-DISABLED::A::i': {
        status: 503,
        context: 'The no-auth token system has been disabled',
        errorCode: 'NO-AUTH-TOKEN::SYSTEM-DISABLED::A::i',
        fault: 'NEITHER',
        solutions: ['NONE']
    }
};

export { NoAuthToken };
