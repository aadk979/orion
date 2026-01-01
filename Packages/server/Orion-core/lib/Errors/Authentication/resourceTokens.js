const ResourceTokens = {
    'RESOURCE-TOKEN-EXPIRED': {
        status: 401,
        context: 'The provided resource token has expired',
        errorCode: 'RESOURCE-TOKEN-EXPIRED',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'RESOURCE-TOKEN-VALIDATION-FAILED': {
        status: 401,
        context: 'The provided resource token validation failed',
        errorCode: 'RESOURCE-TOKEN-VALIDATION-FAILED',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'RESOURCE-TOKEN-INVALID': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'RESOURCE-TOKEN-INVALID',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'RESOURCE-TOKEN-NOT-AUTHORIZED': {
        status: 403,
        context: 'The resource token does not authorize access to the requested resource',
        errorCode: 'RESOURCE-TOKEN-NOT-AUTHORIZED',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'RESOURCE-TOKENS-INVALID-ACCESSIBLE-CALLBACKS-ARRAY': {
        status: 400,
        context: 'The accessible callbacks array provided is invalid',
        errorCode: 'RESOURCE-TOKENS-INVALID-ACCESSIBLE-CALLBACKS-ARRAY',
        fault: 'CLIENT',
        solutions: ['Provide a valid accessible callbacks array']
    },
    'RESOURCE-TOKENS-INVALID-VIEW-TYPE': {
        status: 400,
        context: 'The view type provided is invalid',
        errorCode: 'RESOURCE-TOKENS-INVALID-VIEW-TYPE',
        fault: 'CLIENT',
        solutions: ['Provide a valid view type']
    },
    'RESOURCE-TOKENS-VIEW-TYPE-NOT-ACCEPTABLE': {
        status: 400,
        context: 'The view type provided is not acceptable',
        errorCode: 'RESOURCE-TOKENS-VIEW-TYPE-NOT-ACCEPTABLE',
        fault: 'CLIENT',
        solutions: ['Use an acceptable view type']
    },
    'RESOURCE-TOKENS-MAX-RETRIEVALS-TOO-HIGH': {
        status: 400,
        context: 'The maximum retrievals value provided is too high',
        errorCode: 'RESOURCE-TOKENS-MAX-RETRIEVALS-TOO-HIGH',
        fault: 'CLIENT',
        solutions: ['Provide a lower maximum retrievals value']
    },
    'UNABLE-TO-GENERATE-RESOURCE-TOKEN': {
        status: 500,
        context: 'An unknown error has occurred during the resource token generation process',
        errorCode: 'UNABLE-TO-GENERATE-RESOURCE-TOKEN',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'MISSING-RESOURCE-TOKEN': {
        status: 401,
        context: 'The resource token is missing',
        errorCode: 'MISSING-RESOURCE-TOKEN',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'RESOURCE-TOKEN-KEY-NOT-FOUND': {
        status: 401,
        context: 'The resource token key could not be found',
        errorCode: 'RESOURCE-TOKEN-KEY-NOT-FOUND',
        fault: 'NEITHER',
        solutions: ['NONE']
    },
    'INVALID-RESOURCE-TOKEN-INVALID-AUD': {
        status: 401,
        context: 'The provided resource token has an invalid audience',
        errorCode: 'INVALID-RESOURCE-TOKEN-INVALID-AUD',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'INVALID-RESOURCE-TOKEN-ISS-NOT-ALLOWED': {
        status: 401,
        context: 'The provided resource token issuer is not allowed',
        errorCode: 'INVALID-RESOURCE-TOKEN-ISS-NOT-ALLOWED',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'INVALID-RESOURCE-TOKEN-IP-NOT-IN-RANGE': {
        status: 401,
        context: 'The provided resource token is invalid for the current IP address',
        errorCode: 'INVALID-RESOURCE-TOKEN-IP-NOT-IN-RANGE',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'INVALID-RESOURCE-TOKEN-TOKEN-ID-NOT-FOUND': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'INVALID-RESOURCE-TOKEN-TOKEN-ID-NOT-FOUND',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'INVALID-RESOURCE-TOKEN-TOKEN-TYPE-MISMATCH': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'INVALID-RESOURCE-TOKEN-TOKEN-TYPE-MISMATCH',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'MAX-RESOURCE-RETRIEVALS-HIT': {
        status: 401,
        context: 'The maximum number of resource retrievals has been reached',
        errorCode: 'MAX-RESOURCE-RETRIEVALS-HIT',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'UNABLE-TO-VALIDATE-RESOURCE-TOKEN': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'UNABLE-TO-VALIDATE-RESOURCE-TOKEN',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'PATH-TRAVERSAL-ATTEMPT': {
        status: 403,
        context: 'A path traversal attempt was detected',
        errorCode: 'PATH-TRAVERSAL-ATTEMPT',
        fault: 'CLIENT',
        solutions: ['NONE']
    }
};

export { ResourceTokens };
