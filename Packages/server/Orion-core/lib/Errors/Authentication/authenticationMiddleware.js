const AuthenticationMiddleware = {
    'AUTH::MISSING-SESSION-CREDENTIALS::A::p': {
        status: 401,
        context: 'Either the session ID or session HMAC is missing',
        errorCode: 'AUTH::MISSING-SESSION-CREDENTIALS::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'AUTH::INVALID-SESSION::A::p': {
        status: 401,
        context: 'The session ID or session HMAC is invalid or has been tampered with',
        errorCode: 'AUTH::INVALID-SESSION::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'AUTH::INVALID-TOKEN-TYPE::A::p': {
        status: 401,
        context: 'The provided token type is not supported',
        errorCode: 'AUTH::INVALID-TOKEN-TYPE::A::p',
        fault: 'CLIENT',
        solutions: ['Use an appropriate and supported token type for this request']
    },
    'AUTH::MISSING-TOKEN::A::p': {
        status: 401,
        context: 'No authentication token was found',
        errorCode: 'AUTH::MISSING-TOKEN::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'AUTH::REFRESH-LIMIT-HIT::A::p': {
        status: 401,
        context: 'The provided refresh token has reached its maximum limit of allowed refreshes',
        errorCode: 'AUTH::REFRESH-LIMIT-HIT::A::p',
        fault: 'CLIENT',
        solutions: ['NONE'],
        logout: true
    },
    'AUTH::INSUFFICIENT-PRIVILEGE::A::p': {
        status: 401,
        context: 'The provided token is insufficient as this is a protected route',
        errorCode: 'AUTH::INSUFFICIENT-PRIVILEGE::A::p',
        fault: 'CLIENT',
        solutions: ['Use a token with more privileges']
    },
    'AUTH::BEARER-MISMATCH::A::p': {
        status: 401,
        context: 'The requested route cannot be accessed with this token type',
        errorCode: 'AUTH::BEARER-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Use an appropriate and supported token type for this request']
    }
};

export { AuthenticationMiddleware };
