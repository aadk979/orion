const AccessTokens = {
    // Signature and expiry were fine, but the account's sessions_valid_from
    // watermark moved past this token's iat — a password change, role change,
    // disable or explicit revocation happened after it was issued. logout so the
    // client tears down instead of retrying a token that can never work again.
    'TOKEN-ACCESS::SESSION-INVALIDATED::A::p': {
        status: 401,
        customStatus: 602,
        context: 'This session was ended by a security change on the account (password, role, or status)',
        errorCode: 'TOKEN-ACCESS::SESSION-INVALIDATED::A::p',
        fault: 'CLIENT',
        solutions: ['Sign in again'],
        logout: true
    },
    'TOKEN-ACCESS::GENERATION-FAILED::A::i': {
        status: 500,
        context: 'An unknown error has occurred during the token generation process',
        errorCode: 'TOKEN-ACCESS::GENERATION-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'TOKEN-ACCESS::VALIDATION-FAILED::A::p': {
        status: 401,
        customStatus: 602,
        context: 'The provided access token is invalid',
        errorCode: 'TOKEN-ACCESS::VALIDATION-FAILED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::EXPIRED::A::p': {
        status: 401,
        customStatus: 603,
        context: 'The provided access token has expired',
        errorCode: 'TOKEN-ACCESS::EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TOKEN-ACCESS::IP-NOT-IN-RANGE::A::p': {
        status: 401,
        context: 'The provided access token is invalid for the current IP address',
        errorCode: 'TOKEN-ACCESS::IP-NOT-IN-RANGE::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::TOKEN-ID-NOT-FOUND::A::p': {
        status: 401,
        context: 'The provided access token is invalid',
        errorCode: 'TOKEN-ACCESS::TOKEN-ID-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::TOKEN-TYPE-MISMATCH::A::p': {
        status: 401,
        context: 'The provided access token is invalid',
        errorCode: 'TOKEN-ACCESS::TOKEN-TYPE-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::CHALLENGE-MISMATCH::A::p': {
        status: 401,
        context: 'The provided access token is invalid',
        errorCode: 'TOKEN-ACCESS::CHALLENGE-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::INVALID-AUD::A::p': {
        status: 401,
        context: 'The provided access token has an invalid audience',
        errorCode: 'TOKEN-ACCESS::INVALID-AUD::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::ISS-NOT-ALLOWED::A::p': {
        status: 401,
        context: 'The provided access token issuer is not allowed',
        errorCode: 'TOKEN-ACCESS::ISS-NOT-ALLOWED::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::FINGERPRINT-MISMATCH::A::p': {
        status: 401,
        context: 'The provided access token device fingerprint type 1 does not match',
        errorCode: 'TOKEN-ACCESS::FINGERPRINT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::FINGERPRINT-MISMATCH::B::p': {
        status: 401,
        context: 'The provided access token device fingerprint type 2 does not match',
        errorCode: 'TOKEN-ACCESS::FINGERPRINT-MISMATCH::B::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::KEY-NOT-FOUND::A::i': {
        status: 401,
        context: 'The access token key could not be found',
        errorCode: 'TOKEN-ACCESS::KEY-NOT-FOUND::A::i',
        fault: 'NEITHER',
        solutions: ['NONE'],
        logout: true
    },
    'TOKEN-ACCESS::TIER-CONFLICT::A::i': {
        status: 401,
        context: 'The access token key could not be found',
        errorCode: 'TOKEN-ACCESS::TIER-CONFLICT::A::i',
        fault: 'NEITHER',
        solutions: ['NONE'],
        logout: true
    }
};

export { AccessTokens };
