const DeviceAuthorization = {
    'DEVICE-AUTH::UNRECOGNIZED::A::p': {
        status: 401,
        context: 'The device is not recognised and requires authorisation',
        errorCode: 'DEVICE-AUTH::UNRECOGNIZED::A::p',
        fault: 'CLIENT',
        solutions: ['Complete device authorisation process']
    },
    'DEVICE-AUTH::EMAIL-SEND-FAILED::A::i': {
        status: 500,
        context: 'Unable to send device authorisation email due to server error',
        errorCode: 'DEVICE-AUTH::EMAIL-SEND-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'DEVICE-AUTH::REQUEST-EXPIRED::A::p': {
        status: 401,
        context: 'The device authorisation request has expired',
        errorCode: 'DEVICE-AUTH::REQUEST-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new device authorisation process']
    },
    'DEVICE-AUTH::USERAGENT-MISMATCH::A::p': {
        status: 401,
        context: 'Device authorisation user agent does not match the original request',
        errorCode: 'DEVICE-AUTH::USERAGENT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'DEVICE-AUTH::IP-MISMATCH::A::p': {
        status: 401,
        context: 'Device authorisation IP address does not match the original request',
        errorCode: 'DEVICE-AUTH::IP-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'DEVICE-AUTH::FINGERPRINT-MISMATCH::A::p': {
        status: 401,
        context: 'Device authorisation fingerprint does not match the original request',
        errorCode: 'DEVICE-AUTH::FINGERPRINT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'DEVICE-AUTH::INVALID-CODE::A::p': {
        status: 401,
        context: 'The device authorisation code is invalid',
        errorCode: 'DEVICE-AUTH::INVALID-CODE::A::p',
        fault: 'CLIENT',
        solutions: ['Use the correct authorisation code from your email']
    },
    'DEVICE-AUTH::MISSING-METADATA::A::p': {
        status: 401,
        context: 'The expected device metadata is missing',
        errorCode: 'DEVICE-AUTH::MISSING-METADATA::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'DEVICE-AUTH::MISSING-REQUEST-ID::A::p': {
        status: 400,
        context: 'The expected device authorization request id is missing',
        errorCode: 'DEVICE-AUTH::MISSING-REQUEST-ID::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p': {
        status: 400,
        context: 'The expected device authorization email offset is missing',
        errorCode: 'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'DEVICE-AUTH::INVALID-TOTP::A::p': {
        status: 401,
        context: 'The TOTP code provided for device authorization is invalid',
        errorCode: 'DEVICE-AUTH::INVALID-TOTP::A::p',
        fault: 'CLIENT',
        solutions: ['Check the code in your authenticator app and try again']
    },
    'DEVICE-AUTH::AUTHORIZATION-STARTED::A::p': {
        status: 401,
        customStatus: 600,
        context: 'Device authorization is required for this account',
        errorCode: 'DEVICE-AUTH::AUTHORIZATION-STARTED::A::p',
        fault: 'CLIENT',
        solutions: ['Complete the device authorization flow'],
        flow: 'FLOW-DEVICE-AUTHORIZATION'
    },
    'DEVICE-AUTH::ACCOUNT-DISABLED::A::p': {
        status: 403,
        context: 'This account has been disabled',
        errorCode: 'DEVICE-AUTH::ACCOUNT-DISABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Contact support to re-enable your account']
    },
    'DEVICE-AUTH::FLOW-SECRET-MISMATCH::A::p': {
        status: 401,
        context: 'The device authorization flow secret does not match the original request',
        errorCode: 'DEVICE-AUTH::FLOW-SECRET-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Restart the device authorization process']
    }
};

export { DeviceAuthorization };
