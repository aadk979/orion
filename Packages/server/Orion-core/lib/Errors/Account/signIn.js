const AccountSignIn = {
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
        solutions: ['Ensure the email is correct or create a new account']
    },
    'ACCOUNT-SIGNIN::INVALID-PASSWORD::A::p': {
        status: 401,
        context: 'The provided password is incorrect for the specified email',
        errorCode: 'ACCOUNT-SIGNIN::INVALID-PASSWORD::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure the password is correct or reset it']
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
        solutions: ['Set up a password first or use an alternative sign-in method']
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
