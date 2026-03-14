const TwoFARemoval = {
    '2FA-REMOVAL-METHOD-NOT-ENABLED': {
        status: 400,
        context: 'The specified 2FA method is not enabled on this account',
        errorCode: '2FA-REMOVAL-METHOD-NOT-ENABLED',
        fault: 'CLIENT',
        solutions: ['Verify the 2FA method you are trying to remove is enabled']
    },
    '2FA-REMOVAL-INVALID-METHOD': {
        status: 400,
        context: 'Invalid 2FA method specified for removal',
        errorCode: '2FA-REMOVAL-INVALID-METHOD',
        fault: 'CLIENT',
        solutions: ['Specify a valid method: totp or passkey']
    },
    '2FA-REMOVAL-REQUEST-EXPIRED': {
        status: 401,
        context: 'The 2FA removal request has expired',
        errorCode: '2FA-REMOVAL-REQUEST-EXPIRED',
        fault: 'CLIENT',
        solutions: ['Start a new 2FA removal request']
    },
    '2FA-REMOVAL-INVALID-CODE': {
        status: 401,
        context: 'The verification code provided is invalid',
        errorCode: '2FA-REMOVAL-INVALID-CODE',
        fault: 'CLIENT',
        solutions: ['Use the correct code from your email']
    },
    '2FA-REMOVAL-USERAGENT-MISMATCH': {
        status: 401,
        context: 'The user agent does not match the original removal request',
        errorCode: '2FA-REMOVAL-USERAGENT-MISMATCH',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    '2FA-REMOVAL-IP-MISMATCH': {
        status: 401,
        context: 'The IP address does not match the original removal request',
        errorCode: '2FA-REMOVAL-IP-MISMATCH',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    '2FA-REMOVAL-FINGERPRINT-MISMATCH': {
        status: 401,
        context: 'The device fingerprint does not match the original removal request',
        errorCode: '2FA-REMOVAL-FINGERPRINT-MISMATCH',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    '2FA-REMOVAL-UNABLE-TO-SEND-EMAIL': {
        status: 500,
        context: 'Unable to send 2FA removal verification email',
        errorCode: '2FA-REMOVAL-UNABLE-TO-SEND-EMAIL',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    '2FA-REMOVAL-MISSING-REQUEST-ID': {
        status: 400,
        context: 'The expected 2FA removal request ID is missing',
        errorCode: '2FA-REMOVAL-MISSING-REQUEST-ID',
        fault: 'CLIENT',
        solutions: ['Start a new 2FA removal request']
    }
};

export { TwoFARemoval };
