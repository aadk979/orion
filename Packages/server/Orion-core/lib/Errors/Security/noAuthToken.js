const NoAuthToken = {
    'INVALID-NO-AUTH-TOKEN': {
        status: 401,
        context: 'The no-auth token is invalid',
        errorCode: 'INVALID-NO-AUTH-TOKEN',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'EXPIRED-NO-AUTH-TOKEN': {
        status: 401,
        context: 'The no-auth token has expired',
        errorCode: 'EXPIRED-NO-AUTH-TOKEN',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'NO-AUTH-TOKEN-UNAUTHORIZED': {
        status: 401,
        context: 'The no-auth token is invalid',
        errorCode: 'NO-AUTH-TOKEN-UNAUTHORIZED',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'NO-AUTH-TOKEN-NOT-FOUND': {
        status: 401,
        context: 'The no-auth token was not found',
        errorCode: 'NO-AUTH-TOKEN-NOT-FOUND',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'NO-AUTH-TOKEN-DISABLED': {
        status: 503,
        context: 'The no-auth token system has been disabled',
        errorCode: 'NO-AUTH-TOKEN-DISABLED',
        fault: 'NEITHER',
        solutions: ['NONE']
    }
};

export { NoAuthToken };
