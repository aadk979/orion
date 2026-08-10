const RefreshTokens = {
    'TOKEN-REFRESH::PROOF-REQUIRED::A::p': {
        status: 401,
        context: 'This session is bound to a device key and requires a proof-of-possession header',
        errorCode: 'TOKEN-REFRESH::PROOF-REQUIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Send a valid DPoP proof with the request', 'Sign in again if the device key was lost']
    },
    // See TOKEN-ACCESS::SESSION-INVALIDATED — same watermark, refresh side.
    'TOKEN-REFRESH::SESSION-INVALIDATED::A::p': {
        status: 401,
        context: 'This session was ended by a security change on the account (password, role, or status)',
        errorCode: 'TOKEN-REFRESH::SESSION-INVALIDATED::A::p',
        fault: 'CLIENT',
        solutions: ['Sign in again'],
        logout: true
    },
    // A refresh token that was already rotated away has been presented again.
    // Treated as compromise: the whole session family is revoked, not just this
    // token, because we cannot tell the legitimate holder from the replayer.
    // A retired token presented within the rotation grace window — a client
    // retrying a rotation whose response it never received, or two requests
    // racing the same rotation. Deliberately NOT a logout and deliberately not
    // charged as reuse: the successor tokens already exist, so the caller only
    // needs to retry and pick them up.
    'TOKEN-REFRESH::ROTATION-IN-PROGRESS::A::p': {
        status: 409,
        context: 'This session was refreshed a moment ago; retry the request',
        errorCode: 'TOKEN-REFRESH::ROTATION-IN-PROGRESS::A::p',
        fault: 'CLIENT',
        solutions: ['Retry the request'],
        refresh: false
    },
    'TOKEN-REFRESH::REUSE-DETECTED::A::p': {
        status: 401,
        context: 'A refresh token that had already been rotated was presented again — the session family has been revoked',
        errorCode: 'TOKEN-REFRESH::REUSE-DETECTED::A::p',
        fault: 'CLIENT',
        solutions: ['Sign in again'],
        logout: true
    },
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
