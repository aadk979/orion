const OAuth = {
    'OAUTH::UNSUPPORTED-PROVIDER::A::p': {
        status: 400,
        context: 'The OAuth provider specified is not supported',
        errorCode: 'OAUTH::UNSUPPORTED-PROVIDER::A::p',
        fault: 'CLIENT',
        solutions: ['Use a supported OAuth provider']
    },
    'OAUTH::REDIRECT-URL-GENERATION-FAILED::A::i': {
        status: 500,
        context: 'Unable to generate OAuth redirect URL due to server error',
        errorCode: 'OAUTH::REDIRECT-URL-GENERATION-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'OAUTH::FINGERPRINT-MISMATCH::A::p': {
        status: 401,
        context: 'OAuth request device fingerprint does not match the original request',
        errorCode: 'OAUTH::FINGERPRINT-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'OAUTH::IP-MISMATCH::A::p': {
        status: 401,
        context: 'OAuth request IP address does not match the original request',
        errorCode: 'OAUTH::IP-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'OAUTH::INVALID-STATE-CHALLENGE::A::p': {
        status: 401,
        context: 'OAuth state challenge is invalid or has been tampered with',
        errorCode: 'OAUTH::INVALID-STATE-CHALLENGE::A::p',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'OAUTH::EMAIL-NOT-VERIFIED::A::p': {
        status: 400,
        context: 'OAuth provider email is not verified',
        errorCode: 'OAUTH::EMAIL-NOT-VERIFIED::A::p',
        fault: 'CLIENT',
        solutions: ['Verify your email with the OAuth provider before attempting to sign in']
    },
    'OAUTH::PROVIDER-NOT-INITIALIZED::A::i': {
        status: 500,
        context: 'Requested OAuth provider is not initialized on the server',
        errorCode: 'OAUTH::PROVIDER-NOT-INITIALIZED::A::i',
        fault: 'SERVER',
        solutions: ['Enable and configure the provider in server settings']
    },
    'OAUTH::INVALID-PROVIDER-CONFIG::A::i': {
        status: 500,
        context: 'OAuth provider configuration is incomplete or invalid',
        errorCode: 'OAUTH::INVALID-PROVIDER-CONFIG::A::i',
        fault: 'SERVER',
        solutions: ['Set clientId, clientSecret, and redirectUri correctly']
    },
    'OAUTH::TOKEN-EXCHANGE-FAILED::A::i': {
        status: 502,
        context: 'Failed to exchange authorization code for access token',
        errorCode: 'OAUTH::TOKEN-EXCHANGE-FAILED::A::i',
        fault: 'PROVIDER',
        solutions: ['Retry later; verify code, redirectUri, and client credentials']
    },
    'OAUTH::ID-TOKEN-VERIFICATION-FAILED::A::i': {
        status: 502,
        context: 'Failed to verify the identity token returned by the OAuth provider',
        errorCode: 'OAUTH::ID-TOKEN-VERIFICATION-FAILED::A::i',
        fault: 'PROVIDER',
        solutions: ['Retry the sign-in; verify provider clientId, issuer, and JWKS configuration']
    },
    'OAUTH::USERINFO-FETCH-FAILED::A::i': {
        status: 502,
        context: 'Failed to fetch user info from OAuth provider',
        errorCode: 'OAUTH::USERINFO-FETCH-FAILED::A::i',
        fault: 'PROVIDER',
        solutions: ['Retry later; ensure access token has required scopes']
    },
    'OAUTH::REQUEST-ERROR::A::p': {
        status: 400,
        context: 'An error occurred with OAuth requests',
        errorCode: 'OAUTH::REQUEST-ERROR::A::p',
        fault: 'CLIENT',
        solutions: ['Verify your OAuth request and try again']
    },
    'OAUTH::GENERIC-ERROR::A::p': {
        status: 400,
        context: 'An OAuth error has occurred',
        errorCode: 'OAUTH::GENERIC-ERROR::A::p',
        fault: 'CLIENT',
        solutions: ['Verify your OAuth request and try again']
    },
    'OAUTH::REQUEST-EXPIRED::A::p': {
        status: 401,
        context: 'The OAuth request is invalid or has expired',
        errorCode: 'OAUTH::REQUEST-EXPIRED::A::p',
        fault: 'CLIENT',
        solutions: ['Start a new OAuth request']
    },
    'OAUTH::CALLBACK-PROCESSING-FAILED::A::i': {
        status: 500,
        context: 'Failed to process OAuth callback',
        errorCode: 'OAUTH::CALLBACK-PROCESSING-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'OAUTH::ACCOUNT-DISABLED::A::p': {
        status: 403,
        context: 'OAuth account is disabled',
        errorCode: 'OAUTH::ACCOUNT-DISABLED::A::p',
        fault: 'CLIENT',
        solutions: ['Contact support to enable your account']
    },
    'OAUTH::FLOW-SECRET-MISMATCH::A::p': {
        status: 401,
        context: 'The OAuth flow secret does not match the original request',
        errorCode: 'OAUTH::FLOW-SECRET-MISMATCH::A::p',
        fault: 'CLIENT',
        solutions: ['Restart the OAuth sign-in process']
    },
    'OAUTH::ACCOUNT-NOT-FOUND::A::p': {
        status: 404,
        context: 'There is no account associated with the provided email',
        errorCode: 'OAUTH::ACCOUNT-NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['Ensure the email is correct or create a new account']
    },
    'OAUTH::CREATE-ACCOUNT-FAILED::A::i': {
        status: 500,
        context: 'An unknown error has occurred while creating the account during OAuth sign-up',
        errorCode: 'OAUTH::CREATE-ACCOUNT-FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    }
};

export { OAuth };
