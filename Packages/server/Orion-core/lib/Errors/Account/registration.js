const AccountRegistration = {
    'ACCOUNT-REG::INVALID-EMAIL::A::p': {
        status: 400,
        context: 'The email provided is not valid',
        errorCode: 'ACCOUNT-REG::INVALID-EMAIL::A::p',
        fault: 'CLIENT',
        solutions: ['Check if the email provided is in the proper format, e.g. (example@provider.com)']
    },
    'ACCOUNT-REG::PASSWORD-WEAK::A::p': {
        status: 400,
        context: 'The provided password was deemed to be insecure',
        errorCode: 'ACCOUNT-REG::PASSWORD-WEAK::A::p',
        fault: 'CLIENT',
        solutions: ["Try adding numbers or characters to increase your password's security"]
    },
    'ACCOUNT-REG::ACCOUNT-EXISTS::A::p': {
        status: 400,
        context: 'There is already an account registered under the provided email',
        errorCode: 'ACCOUNT-REG::ACCOUNT-EXISTS::A::p',
        fault: 'CLIENT',
        solutions: ['Try logging into the account, and if you have forgotten your password, visit the password reset page']
    },
    'ACCOUNT-REG::CREATE-FAILED::A::i': {
        status: 500,
        context: 'An unknown error has occurred during the registration process',
        errorCode: 'ACCOUNT-REG::CREATE-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'ACCOUNT-REG::EMAIL-PASSWORD-DISABLED::A::p': {
        status: 400,
        context: 'Email and password registration is disabled',
        errorCode: 'ACCOUNT-REG::EMAIL-PASSWORD-DISABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Use an alternative registration method such as OAuth']
    },
    'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p': {
        status: 403,
        context: 'The email domain is not allowed',
        errorCode: 'ACCOUNT-REG::DOMAIN-NOT-ALLOWED::A::p',
        fault: 'CLIENT',
        solutions: ['Use an email from an allowed domain or contact support for domain whitelist']
    }
};

export { AccountRegistration };
