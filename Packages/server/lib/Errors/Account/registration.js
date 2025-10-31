const AccountRegistration = {
    "ACC-REG-INVALID-EMAIL": {
        status: 400,
        context: "The email provided is not valid",
        errorCode: "ACC-REG-INVALID-EMAIL",
        fault: "CLIENT",
        solutions: ["Check if the email provided is in the proper format, e.g. (example@provider.com)"]
    },
    "ACC-REG-PASSWORD-WEAK": {
        status: 400,
        context: "The provided password was deemed to be insecure",
        errorCode: "ACC-REG-PASSWORD-WEAK",
        fault: "CLIENT",
        solutions: ["Try adding numbers or characters to increase your password's security"]
    },
    "ACC-REG-ACC-EXISTS": {
        status: 400,
        context: "There is already an account registered under the provided email",
        errorCode: "ACC-REG-ACC-EXISTS",
        fault: "CLIENT",
        solutions: ["Try logging into the account, and if you have forgotten your password, visit the password reset page"]
    },
    "ACC-REG-UNABLE-TO-CREATE-ACC": {
        status: 500,
        context: "An unknown error has occurred during the registration process",
        errorCode: "ACC-REG-UNABLE-TO-CREATE-ACC",
        fault: "SERVER",
        solutions: ["Try again in 10 minutes and contact support if the issue persists"]
    },
    "ACC-REG-EMAIL-PASSWORD-DISABLED": {
        status: 400,
        context: "Email and password registration is disabled",
        errorCode: "ACC-REG-EMAIL-PASSWORD-DISABLED",
        fault: "CLIENT",
        solutions: ["Use an alternative registration method such as OAuth"]
    },
    "EMAIL-DOMAIN-NOT-ALLOWED": {
        status: 403,
        context: "The email domain is not allowed",
        errorCode: "EMAIL-DOMAIN-NOT-ALLOWED",
        fault: "CLIENT",
        solutions: ["Use an email from an allowed domain or contact support for domain whitelist"]
    }
};

export { AccountRegistration };
