const OAuth = {
    'O-AUTH-UNSUPPORTED-PROVIDER': {
        status: 400,
        context: 'The OAuth provider specified is not supported',
        errorCode: 'O-AUTH-UNSUPPORTED-PROVIDER',
        fault: 'CLIENT',
        solutions: ['Use a supported OAuth provider']
    },
    'O-AUTH-UNABLE-TO-GENERATE-REDIRECT-URL': {
        status: 500,
        context: 'Unable to generate OAuth redirect URL due to server error',
        errorCode: 'O-AUTH-UNABLE-TO-GENERATE-REDIRECT-URL',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'O-AUTH-DEVICE-FINGERPRINT-MISMATCH': {
        status: 401,
        context: 'OAuth request device fingerprint does not match the original request',
        errorCode: 'O-AUTH-DEVICE-FINGERPRINT-MISMATCH',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'O-AUTH-IP-MISMATCH': {
        status: 401,
        context: 'OAuth request IP address does not match the original request',
        errorCode: 'O-AUTH-IP-MISMATCH',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'O-AUTH-INVALID-STATE-CHALLENGE': {
        status: 401,
        context: 'OAuth state challenge is invalid or has been tampered with',
        errorCode: 'O-AUTH-INVALID-STATE-CHALLENGE',
        fault: 'CLIENT',
        solutions: ['NONE']
    },
    'O-AUTH-EMAIL-NOT-VERIFIED': {
        status: 400,
        context: 'OAuth provider email is not verified',
        errorCode: 'O-AUTH-EMAIL-NOT-VERIFIED',
        fault: 'CLIENT',
        solutions: ['Verify your email with the OAuth provider before attempting to sign in']
    },
    'O-AUTH-PROVIDER-NOT-INITIALIZED': {
        status: 500,
        context: 'Requested OAuth provider is not initialized on the server',
        errorCode: 'O-AUTH-PROVIDER-NOT-INITIALIZED',
        fault: 'SERVER',
        solutions: ['Enable and configure the provider in server settings']
    },
    'O-AUTH-INVALID-PROVIDER-CONFIG': {
        status: 500,
        context: 'OAuth provider configuration is incomplete or invalid',
        errorCode: 'O-AUTH-INVALID-PROVIDER-CONFIG',
        fault: 'SERVER',
        solutions: ['Set clientId, clientSecret, and redirectUri correctly']
    },
    'O-AUTH-TOKEN-EXCHANGE-FAILED': {
        status: 502,
        context: 'Failed to exchange authorization code for access token',
        errorCode: 'O-AUTH-TOKEN-EXCHANGE-FAILED',
        fault: 'PROVIDER',
        solutions: ['Retry later; verify code, redirectUri, and client credentials']
    },
    'O-AUTH-USERINFO-FAILED': {
        status: 502,
        context: 'Failed to fetch user info from OAuth provider',
        errorCode: 'O-AUTH-USERINFO-FAILED',
        fault: 'PROVIDER',
        solutions: ['Retry later; ensure access token has required scopes']
    },
    'O-AUTH-REQUESTS': {
        status: 400,
        context: 'An error occurred with OAuth requests',
        errorCode: 'O-AUTH-REQUESTS',
        fault: 'CLIENT',
        solutions: ['Verify your OAuth request and try again']
    },
    'O-AUTH': {
        status: 400,
        context: 'An OAuth error has occurred',
        errorCode: 'O-AUTH',
        fault: 'CLIENT',
        solutions: ['Verify your OAuth request and try again']
    },
    'O-AUTH-REQUEST-INVALID-OR-EXPIRED': {
        status: 401,
        context: 'The OAuth request is invalid or has expired',
        errorCode: 'O-AUTH-REQUEST-INVALID-OR-EXPIRED',
        fault: 'CLIENT',
        solutions: ['Start a new OAuth request']
    },
    'O-AUTH-CALLBACK-PROCESSING-FAILED': {
        status: 500,
        context: 'Failed to process OAuth callback',
        errorCode: 'O-AUTH-CALLBACK-PROCESSING-FAILED',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    },
    'O-AUTH-ACC-DISABLED': {
        status: 403,
        context: 'OAuth account is disabled',
        errorCode: 'O-AUTH-ACC-DISABLED',
        fault: 'CLIENT',
        solutions: ['Contact support to enable your account']
    },
    'O-AUTH-FLOW-SECRET-MISMATCH': {
        status: 401,
        context: 'The OAuth flow secret does not match the original request',
        errorCode: 'O-AUTH-FLOW-SECRET-MISMATCH',
        fault: 'CLIENT',
        solutions: ['Restart the OAuth sign-in process']
    }
};

export { OAuth };
