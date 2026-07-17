const ResourceTokens = {
    'TOKEN-RESOURCE::EXPIRED::A::p': {
        status: 401,
        context: 'The provided resource token has expired',
        errorCode: 'TOKEN-RESOURCE::EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::VALIDATION-FAILED::A::p': {
        status: 401,
        context: 'The provided resource token validation failed',
        errorCode: 'TOKEN-RESOURCE::VALIDATION-FAILED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::INVALID::A::p': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'TOKEN-RESOURCE::INVALID::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::NOT-AUTHORIZED::A::p': {
        status: 403,
        context: 'The resource token does not authorize access to the requested resource',
        errorCode: 'TOKEN-RESOURCE::NOT-AUTHORIZED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::INVALID-CALLBACKS-ARRAY::A::p': {
        status: 400,
        context: 'The accessible callbacks array provided is invalid',
        errorCode: 'TOKEN-RESOURCE::INVALID-CALLBACKS-ARRAY::A::p',
        fault: 'CLIENT',
        solutions: ['Provide a valid accessible callbacks array']
    },
    'TOKEN-RESOURCE::INVALID-VIEW-TYPE::A::p': {
        status: 400,
        context: 'The view type provided is invalid',
        errorCode: 'TOKEN-RESOURCE::INVALID-VIEW-TYPE::A::p',
        fault: 'CLIENT',
        solutions: ['Provide a valid view type']
    },
    'TOKEN-RESOURCE::VIEW-TYPE-NOT-ACCEPTABLE::A::p': {
        status: 400,
        context: 'The view type provided is not acceptable',
        errorCode: 'TOKEN-RESOURCE::VIEW-TYPE-NOT-ACCEPTABLE::A::p',
        fault: 'CLIENT',
        solutions: ['Use an acceptable view type']
    },
    'TOKEN-RESOURCE::MAX-RETRIEVALS-TOO-HIGH::A::p': {
        status: 400,
        context: 'The maximum retrievals value provided is too high',
        errorCode: 'TOKEN-RESOURCE::MAX-RETRIEVALS-TOO-HIGH::A::p',
        fault: 'CLIENT',
        solutions: ['Provide a lower maximum retrievals value']
    },
    'TOKEN-RESOURCE::GENERATION-FAILED::A::i': {
        status: 500,
        context: 'An unknown error has occurred during the resource token generation process',
        errorCode: 'TOKEN-RESOURCE::GENERATION-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'TOKEN-RESOURCE::MISSING::A::p': {
        status: 401,
        context: 'The resource token is missing',
        errorCode: 'TOKEN-RESOURCE::MISSING::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::KEY-NOT-FOUND::A::i': {
        status: 401,
        context: 'The resource token key could not be found',
        errorCode: 'TOKEN-RESOURCE::KEY-NOT-FOUND::A::i',
        fault: 'NEITHER',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::INVALID-AUD::A::p': {
        status: 401,
        context: 'The provided resource token has an invalid audience',
        errorCode: 'TOKEN-RESOURCE::INVALID-AUD::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::ISS-NOT-ALLOWED::A::p': {
        status: 401,
        context: 'The provided resource token issuer is not allowed',
        errorCode: 'TOKEN-RESOURCE::ISS-NOT-ALLOWED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::IP-NOT-IN-RANGE::A::p': {
        status: 401,
        context: 'The provided resource token is invalid for the current IP address',
        errorCode: 'TOKEN-RESOURCE::IP-NOT-IN-RANGE::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::TOKEN-ID-NOT-FOUND::A::p': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'TOKEN-RESOURCE::TOKEN-ID-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::TOKEN-TYPE-MISMATCH::A::p': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'TOKEN-RESOURCE::TOKEN-TYPE-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::MAX-RETRIEVALS-HIT::A::p': {
        status: 401,
        context: 'The maximum number of resource retrievals has been reached',
        errorCode: 'TOKEN-RESOURCE::MAX-RETRIEVALS-HIT::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::VALIDATION-FAILED::B::p': {
        status: 401,
        context: 'The provided resource token is invalid',
        errorCode: 'TOKEN-RESOURCE::VALIDATION-FAILED::B::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-RESOURCE::ACCESS-TYPE-MISMATCH::A::p': {
        status: 403,
        context: 'The resource token access type does not match the requested access mode or the registered callback',
        errorCode: 'TOKEN-RESOURCE::ACCESS-TYPE-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Request the resource with the access type the token was minted for']
    }
};

export { ResourceTokens };
