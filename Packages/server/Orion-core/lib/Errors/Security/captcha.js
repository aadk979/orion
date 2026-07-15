const Captcha = {
    'CAPTCHA::INVALID-RESPONSE::A::p': {
        status: 400,
        context: 'The captcha response is invalid',
        errorCode: 'CAPTCHA::INVALID-RESPONSE::A::p',
        fault: 'CLIENT',
        solutions: ['Complete the captcha challenge correctly']
    },
    'CAPTCHA::INVALID-TRANSACTION-ID::A::p': {
        status: 400,
        context: 'The captcha transaction ID is invalid',
        errorCode: 'CAPTCHA::INVALID-TRANSACTION-ID::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new captcha transaction']
    },
    'CAPTCHA::SYSTEM-VERSION-ERROR::A::i': {
        status: 500,
        context: 'Captcha system version mismatch error',
        errorCode: 'CAPTCHA::SYSTEM-VERSION-ERROR::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'CAPTCHA::TRANSACTION-IP-MISMATCH::A::p': {
        status: 401,
        context: 'Captcha transaction IP address does not match the original request',
        errorCode: 'CAPTCHA::TRANSACTION-IP-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'CAPTCHA::TRANSACTION-FINGERPRINT-MISMATCH::A::p': {
        status: 401,
        context: 'Captcha transaction fingerprint does not match the original request',
        errorCode: 'CAPTCHA::TRANSACTION-FINGERPRINT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'CAPTCHA::TRANSACTION-USERAGENT-MISMATCH::A::p': {
        status: 401,
        context: 'Captcha transaction user agent does not match the original request',
        errorCode: 'CAPTCHA::TRANSACTION-USERAGENT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'CAPTCHA::INVALID-CODE::A::p': {
        status: 400,
        context: 'The captcha code is invalid',
        errorCode: 'CAPTCHA::INVALID-CODE::A::p',
        fault: 'CLIENT',
        solutions: ['Enter the correct captcha code']
    },
    'CAPTCHA::TRANSACTION-EXPIRED::A::p': {
        status: 401,
        context: 'The captcha transaction has expired',
        errorCode: 'CAPTCHA::TRANSACTION-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new captcha transaction']
    }
};

export { Captcha };
