const TokenRevocation = {
    'TOKEN-REVOCATION::STATELESS-TIER::A::p': {
        status: 400,
        context: 'Token revocation is unavailable at security tier 1 — stateless tokens cannot be revoked before their natural expiry',
        errorCode: 'TOKEN-REVOCATION::STATELESS-TIER::A::p',
        fault: 'CLIENT',
        solutions: ['Run the server at security tier 2 or higher to enable token revocation and session management']
    },
    'TOKEN-REVOCATION::INVALID-TARGET::A::p': {
        status: 400,
        context: 'No valid revocation target was provided (a tokenId, link code, or uid is required)',
        errorCode: 'TOKEN-REVOCATION::INVALID-TARGET::A::p',
        fault: 'CLIENT',
        solutions: ['Provide exactly one revocation target: a tokenId, an access-token link code, or a uid']
    },
    'TOKEN-REVOCATION::NOT-FOUND::A::p': {
        status: 404,
        context: 'The revocation target did not match any active token owned by this user',
        errorCode: 'TOKEN-REVOCATION::NOT-FOUND::A::p',
        fault: 'CLIENT',
        solutions: ['Refresh the session list — the token may already be revoked or expired']
    },
    'TOKEN-REVOCATION::FAILED::A::i': {
        status: 500,
        context: 'An unknown error occurred while revoking tokens',
        errorCode: 'TOKEN-REVOCATION::FAILED::A::i',
        fault: 'SERVER',
        solutions: ['Try again in 10 minutes and contact support if the issue persists']
    }
};

export { TokenRevocation };
