const Passkeys = {
    'PASSKEY::SIGN-IN-DISABLED::A::i': {
        status: 400,
        context: 'Passkey authentication is disabled for this account',
        errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i',
        fault: 'SERVER',
        solutions: ['Use another authentication method']
    },
    'PASSKEY::REGISTRATION-INVALID-EMAIL::A::p': {
        status: 400,
        context: 'The email provided for passkey registration is not valid',
        errorCode: 'PASSKEY::REGISTRATION-INVALID-EMAIL::A::p',
        fault: 'CLIENT',
        solutions: ['Check if the email provided is in the proper format, e.g. (example@provider.com)']
    },
    'PASSKEY::ACCOUNT-NOT-FOUND::A::p': {
        status: 400,
        context: 'There is no account associated with the provided email for passkey authentication',
        errorCode: 'PASSKEY::ACCOUNT-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['Create an account first or use a different authentication method']
    },
    'PASSKEY::REGISTRATION-ALREADY-ACTIVE::A::p': {
        status: 400,
        context: 'An active passkey registration is already in progress',
        errorCode: 'PASSKEY::REGISTRATION-ALREADY-ACTIVE::A::p',
        fault: 'CLIENT',
        solutions: ['Delete your old passkey to add a new one']
    },
    'PASSKEY::AUTH-INVALID-EMAIL::A::p': {
        status: 400,
        context: 'The email provided for passkey authentication is not valid',
        errorCode: 'PASSKEY::AUTH-INVALID-EMAIL::A::p',
        fault: 'CLIENT',
        solutions: ['Check if the email provided is in the proper format, e.g. (example@provider.com)']
    },
    'PASSKEY::REGISTRATION-EXPIRED::A::p': {
        status: 401,
        context: 'The passkey registration session has expired',
        errorCode: 'PASSKEY::REGISTRATION-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new passkey registration process']
    },
    'PASSKEY::REGISTRATION-EMAIL-MISMATCH::A::p': {
        status: 401,
        context: 'The email provided does not match the registration session',
        errorCode: 'PASSKEY::REGISTRATION-EMAIL-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Use the same email address that was used to start the registration']
    },
    'PASSKEY::REGISTRATION-FAILED::A::i': {
        status: 500,
        context: 'Passkey registration failed due to an unknown error',
        errorCode: 'PASSKEY::REGISTRATION-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'PASSKEY::AUTH-EXPIRED::A::p': {
        status: 401,
        context: 'The passkey authentication session has expired',
        errorCode: 'PASSKEY::AUTH-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new passkey authentication process']
    },
    'PASSKEY::AUTH-EMAIL-MISMATCH::A::p': {
        status: 401,
        context: 'The email provided does not match the authentication session',
        errorCode: 'PASSKEY::AUTH-EMAIL-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Use the same email address that was used to start the authentication']
    },
    'PASSKEY::AUTH-FAILED::A::i': {
        status: 500,
        context: 'Passkey authentication failed due to an unknown error',
        errorCode: 'PASSKEY::AUTH-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'PASSKEY::AUTH-UNAVAILABLE::A::i': {
        status: 500,
        context: 'Unable to complete passkey authentication due to server error',
        errorCode: 'PASSKEY::AUTH-UNAVAILABLE::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'PASSKEY::AUTH-NO-ACTIVE-PASSKEY::A::p': {
        status: 400,
        context: 'No active passkey found for authentication',
        errorCode: 'PASSKEY::AUTH-NO-ACTIVE-PASSKEY::A::p',
        fault: 'CLIENT',
        solutions: ['Register a passkey first or use another authentication method']
    },
    'PASSKEY::SIGN-IN-ACCOUNT-DISABLED::A::p': {
        status: 403,
        context: 'This account has been disabled',
        errorCode: 'PASSKEY::SIGN-IN-ACCOUNT-DISABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Contact support to reactivate your account']
    },
    'PASSKEY::SIGN-UP-DISABLED::A::p': {
        status: 400,
        context: 'Passkey sign up is disabled',
        errorCode: 'PASSKEY::SIGN-UP-DISABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Use another sign up method']
    },
    'PASSKEY::SIGN-UP-INVALID-EMAIL::A::p': {
        status: 400,
        context: 'The email provided for passkey sign up is not valid',
        errorCode: 'PASSKEY::SIGN-UP-INVALID-EMAIL::A::p',
        fault: 'CLIENT',
        solutions: ['Check if the email provided is in the proper format, e.g. (example@provider.com)']
    },
    'PASSKEY::SIGN-UP-ACCOUNT-EXISTS::A::p': {
        status: 400,
        context: 'An account with this email already exists',
        errorCode: 'PASSKEY::SIGN-UP-ACCOUNT-EXISTS::A::p',
        fault: 'CLIENT',
        solutions: ['Sign in instead, or use a different email address']
    },
    'PASSKEY::SIGN-UP-EXPIRED::A::p': {
        status: 401,
        context: 'The passkey sign up session has expired',
        errorCode: 'PASSKEY::SIGN-UP-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new passkey sign up process']
    },
    'PASSKEY::SIGN-UP-EMAIL-MISMATCH::A::p': {
        status: 401,
        context: 'The email provided does not match the sign up session',
        errorCode: 'PASSKEY::SIGN-UP-EMAIL-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Use the same email address that was used to start the sign up']
    },
    'PASSKEY::SIGN-UP-REGISTRATION-FAILED::A::i': {
        status: 500,
        context: 'Passkey registration verification failed during sign up',
        errorCode: 'PASSKEY::SIGN-UP-REGISTRATION-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'PASSKEY::SIGN-UP-CREATE-FAILED::A::i': {
        status: 500,
        context: 'Unable to create account during passkey sign up',
        errorCode: 'PASSKEY::SIGN-UP-CREATE-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    }
};

export { Passkeys };
