const AccountSignIn = {
    "ACC-SIGN-IN-INVALID-EMAIL": {
        status: 400,
        context: "The email provided is not valid",
        errorCode: "ACC-SIGN-IN-INVALID-EMAIL",
        fault: "CLIENT",
        solutions: ["Check if the email provided is in the proper format, e.g. (example@provider.com)"]
    },
    "ACC-SIGN-IN-ACC-NO-EXISTS": {
        status: 404,
        context: "There is no user associated with the provided email",
        errorCode: "ACC-SIGN-IN-ACC-NO-EXISTS",
        fault: "CLIENT",
        solutions: ["Ensure the email is correct or create a new account"]
    },
    "ACC-SIGN-IN-INVALID-PASSWORD": {
        status: 401,
        context: "The provided password is incorrect for the specified email",
        errorCode: "ACC-SIGN-IN-INVALID-PASSWORD",
        fault: "CLIENT",
        solutions: ["Ensure the password is correct or reset it"]
    },
    "ACC-SIGN-IN-EMAIL-PASSWORD-DISABLED": {
        status: 400,
        context: "Email and password sign-in is disabled for this account",
        errorCode: "ACC-SIGN-IN-EMAIL-PASSWORD-DISABLED",
        fault: "CLIENT",
        solutions: ["Use an alternative sign-in method such as OAuth or passkeys"]
    },
    "ACC-SIGN-IN-NO-PASSWORD-SETUP": {
        status: 400,
        context: "No password has been set up for this account",
        errorCode: "ACC-SIGN-IN-NO-PASSWORD-SETUP",
        fault: "CLIENT",
        solutions: ["Set up a password first or use an alternative sign-in method"]
    },
    "ACC-SIGN-IN-ACC-DISABLED": {
        status: 403,
        context: "The provided users account has been disabled by an admin",
        errorCode: "ACC-SIGN-IN-ACC-DISABLED",
        fault: "CLIENT",
        solutions: ["Contact support"]
    },
};

export { AccountSignIn };
