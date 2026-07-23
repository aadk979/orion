const TwoFARemoval = {
    'TWO-FA::ATTEMPTS-EXCEEDED::A::p': {
        status: 429,
        context: 'Too many incorrect codes were submitted; the 2FA removal request has been cancelled',
        errorCode: 'TWO-FA::ATTEMPTS-EXCEEDED::A::p',
        fault: 'CLIENT',
        solutions: ['Start the 2FA removal again to receive a new code']
    },
    'TWO-FA::METHOD-NOT-ENABLED::A::p': {
        status: 400,
        context: 'The specified 2FA method is not enabled on this account',
        errorCode: 'TWO-FA::METHOD-NOT-ENABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Verify the 2FA method you are trying to remove is enabled']
    },
    'TWO-FA::INVALID-METHOD::A::p': {
        status: 400,
        context: 'Invalid 2FA method specified for removal',
        errorCode: 'TWO-FA::INVALID-METHOD::A::p',
        fault: 'CLIENT',
        solutions: ['Specify a valid method: totp or passkey']
    },
    'TWO-FA::REQUEST-EXPIRED::A::p': {
        status: 401,
        context: 'The 2FA removal request has expired',
        errorCode: 'TWO-FA::REQUEST-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new 2FA removal request']
    },
    'TWO-FA::INVALID-CODE::A::p': {
        status: 401,
        context: 'The verification code provided is invalid',
        errorCode: 'TWO-FA::INVALID-CODE::A::p',
        fault: 'CLIENT',
        solutions: ['Use the correct code from your email']
    },
    'TWO-FA::USERAGENT-MISMATCH::A::p': {
        status: 401,
        context: 'The user agent does not match the original removal request',
        errorCode: 'TWO-FA::USERAGENT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TWO-FA::IP-MISMATCH::A::p': {
        status: 401,
        context: 'The IP address does not match the original removal request',
        errorCode: 'TWO-FA::IP-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TWO-FA::FINGERPRINT-MISMATCH::A::p': {
        status: 401,
        context: 'The device fingerprint does not match the original removal request',
        errorCode: 'TWO-FA::FINGERPRINT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'TWO-FA::EMAIL-SEND-FAILED::A::i': {
        status: 500,
        context: 'Unable to send 2FA removal verification email',
        errorCode: 'TWO-FA::EMAIL-SEND-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'TWO-FA::MISSING-REQUEST-ID::A::p': {
        status: 400,
        context: 'The expected 2FA removal request ID is missing',
        errorCode: 'TWO-FA::MISSING-REQUEST-ID::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new 2FA removal request']
    }
};

export { TwoFARemoval };
