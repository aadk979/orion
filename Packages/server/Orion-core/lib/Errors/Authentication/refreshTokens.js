const RefreshTokens = {
    'TOKEN-REFRESH::GENERATION-FAILED::A::i': {
        status: 500,
        context: 'An unknown error has occurred during the token generation process',
        errorCode: 'TOKEN-REFRESH::GENERATION-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'TOKEN-REFRESH::VALIDATION-FAILED::A::p': {
        status: 401,
        customStatus: 600,
        context: 'The provided refresh token is invalid',
        errorCode: 'TOKEN-REFRESH::VALIDATION-FAILED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::EXPIRED::A::p': {
        status: 401,
        customStatus: 601,
        context: 'The provided refresh token has expired',
        errorCode: 'TOKEN-REFRESH::EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::IP-NOT-IN-RANGE::A::p': {
        status: 401,
        context: 'The provided refresh token is invalid for the current IP address',
        errorCode: 'TOKEN-REFRESH::IP-NOT-IN-RANGE::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::FINGERPRINT-MISMATCH::A::p': {
        status: 401,
        context: 'The provided refresh token is invalid for the current device',
        errorCode: 'TOKEN-REFRESH::FINGERPRINT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::TOKEN-ID-NOT-FOUND::A::p': {
        status: 401,
        context: 'The provided refresh token is invalid',
        errorCode: 'TOKEN-REFRESH::TOKEN-ID-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::TOKEN-TYPE-MISMATCH::A::p': {
        status: 401,
        context: 'The provided refresh token is invalid',
        errorCode: 'TOKEN-REFRESH::TOKEN-TYPE-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::CHALLENGE-MISMATCH::A::p': {
        status: 401,
        context: 'The provided refresh token is invalid',
        errorCode: 'TOKEN-REFRESH::CHALLENGE-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::INVALID-AUD::A::p': {
        status: 401,
        context: 'The provided refresh token has an invalid audience',
        errorCode: 'TOKEN-REFRESH::INVALID-AUD::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::ISS-NOT-ALLOWED::A::p': {
        status: 401,
        context: 'The provided refresh token issuer is not allowed',
        errorCode: 'TOKEN-REFRESH::ISS-NOT-ALLOWED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::FINGERPRINT-MISMATCH::B::p': {
        status: 401,
        context: 'The provided refresh token device fingerprint type 1 does not match',
        errorCode: 'TOKEN-REFRESH::FINGERPRINT-MISMATCH::B::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::FINGERPRINT-MISMATCH::C::p': {
        status: 401,
        context: 'The provided refresh token device fingerprint type 2 does not match',
        errorCode: 'TOKEN-REFRESH::FINGERPRINT-MISMATCH::C::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::KEY-NOT-FOUND::A::i': {
        status: 401,
        context: 'The refresh token key could not be found',
        errorCode: 'TOKEN-REFRESH::KEY-NOT-FOUND::A::i',
        fault: 'NEITHER',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-REFRESH::TIER-CONFLICT::A::i': {
        status: 401,
        context: 'The refresh token security tier does not match the configured tier',
        errorCode: 'TOKEN-REFRESH::TIER-CONFLICT::A::i',
        fault: 'NEITHER',
        solutions: ['NONE'],
        logout: true
    }
};

export { RefreshTokens };