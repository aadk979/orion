const AccountSignIn = {
    // Correct credentials presented while the account is under failure backoff.
    // Not a refusal — the client is told to run the step-up flow. This is what
    // keeps a failure counter from becoming a way to lock an owner out.
    'ACCOUNT-SIGNIN::STEP-UP-REQUIRED::A::p': {
        status: 401,
        context: 'Additional verification is required before this sign-in can complete',
        errorCode: 'ACCOUNT-SIGNIN::STEP-UP-REQUIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Complete the additional verification step'],
        flow: 'FLOW-STEP-UP-AUTH'
    },
    // The single outcome every failed sign-in reports to the client.
    //
    // "no such account", "this account has no password" and "wrong password" are
    // three different facts internally — and the audit trail still records which
    // one occurred — but returning them separately let anyone enumerate
    // registered addresses and, worse, identify which accounts are OAuth-only
    // (i.e. have no password to fall back on).
    'ACCOUNT-SIGNIN::INVALID-CREDENTIALS::A::p': {
        status: 401,
        context: 'The email or password is incorrect',
        errorCode: 'ACCOUNT-SIGNIN::INVALID-CREDENTIALS::A::p',
        fault: 'CLIENT',
        solutions: ['Check the email and password', 'Reset the password if it has been forgotten']
    },
    // Challenge ceiling reached — the reset request is destroyed, not merely
    // rejected, so a guessed code can never be retried against it.
    'ACC-PASSWORD-RESET-ATTEMPTS-EXCEEDED': {
        status: 429,
        context: 'Too many incorrect password reset codes were submitted; the reset request has been cancelled',
        errorCode: 'ACC-PASSWORD-RESET-ATTEMPTS-EXCEEDED',
        fault: 'CLIENT',
        solutions: ['Start a new password reset and use the most recent code']
    },
    'ACCOUNT-SIGNIN::INVALID-EMAIL::A::p': {
        status: 400,
        context: 'The email provided is not valid',
        errorCode: 'ACCOUNT-SIGNIN::INVALID-EMAIL::A::p',
        fault: 'CLIENT',
        solutions: ['Check if the email provided is in the proper format, e.g. (example@provider.com)']
    },
    'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p': {
        status: 404,
        context: 'There is no user associated with the provided email',
        errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure the email is correct or create a new account'],
        clientSafeErrorCode: 'ACCOUNT-SIGNIN::INVALID-CREDENTIALS::A::p'
    },
    'ACCOUNT-SIGNIN::INVALID-PASSWORD::A::p': {
        status: 401,
        context: 'The provided password is incorrect for the specified email',
        errorCode: 'ACCOUNT-SIGNIN::INVALID-PASSWORD::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure the password is correct or reset it'],
        clientSafeErrorCode: 'ACCOUNT-SIGNIN::INVALID-CREDENTIALS::A::p'
    },
    'ACCOUNT-SIGNIN::EMAIL-PASSWORD-DISABLED::A::p': {
        status: 400,
        context: 'Email and password sign-in is disabled for this account',
        errorCode: 'ACCOUNT-SIGNIN::EMAIL-PASSWORD-DISABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Use an alternative sign-in method such as OAuth or passkeys']
    },
    'ACCOUNT-SIGNIN::NO-PASSWORD-SETUP::A::p': {
        status: 400,
        context: 'No password has been set up for this account',
        errorCode: 'ACCOUNT-SIGNIN::NO-PASSWORD-SETUP::A::p',
        fault: 'CLIENT',
        solutions: ['Set up a password first or use an alternative sign-in method'],
        clientSafeErrorCode: 'ACCOUNT-SIGNIN::INVALID-CREDENTIALS::A::p'
    },
    'ACCOUNT-SIGNIN::ACCOUNT-DISABLED::A::p': {
        status: 403,
        context: 'The provided users account has been disabled by an admin',
        errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-DISABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Contact support']
    },
    'ACCOUNT-SIGNIN::PASSWORD-RESET-IP-MISMATCH::A::p': {
        status: 401,
        context: 'The password reset request IP address does not match',
        errorCode: 'ACCOUNT-SIGNIN::PASSWORD-RESET-IP-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Complete the password reset from the same network or request a new reset code']
    }
};

export { AccountSignIn };
