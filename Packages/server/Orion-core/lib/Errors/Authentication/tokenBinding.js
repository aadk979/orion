/**
 * Proof-of-possession binding (RFC 9449) failures raised at ISSUANCE.
 *
 * Validation-time proof failures keep their per-token-kind codes
 * (TOKEN-ACCESS::PROOF-REQUIRED, TOKEN-REFRESH::PROOF-REQUIRED) — those tell a
 * client "re-sign this request". The codes here are different in kind: they
 * mean the sign-in itself could not establish a binding, so there is no session
 * to re-sign for. Credentials were accepted; the device key was not.
 */
const TokenBinding = {
    // The deployment issues key-bound tokens and this sign-in arrived without a
    // DPoP header at all. Almost always a client that has not enabled its own
    // binding support — the two settings have to agree.
    'TOKEN-BINDING::PROOF-REQUIRED::A::p': {
        status: 400,
        context: 'This server issues device-bound sessions and the sign-in request carried no proof-of-possession header',
        errorCode: 'TOKEN-BINDING::PROOF-REQUIRED::A::p',
        fault: 'CLIENT',
        solutions: [
            'Enable DPoP in the client SDK so it sends a proof with every request',
            'Confirm the client and server agree on the tokens.binding setting'
        ]
    },
    // A proof was sent and did not verify: bad signature, stale or future-dated
    // `iat`, a replayed `jti`, or an `htm`/`htu` that does not describe this
    // request. Deliberately does not distinguish between them to the client.
    'TOKEN-BINDING::PROOF-INVALID::A::p': {
        status: 400,
        context: 'The proof-of-possession sent with this sign-in could not be verified',
        errorCode: 'TOKEN-BINDING::PROOF-INVALID::A::p',
        fault: 'CLIENT',
        solutions: [
            'Check the client clock — proofs are only accepted within a 60 second window',
            'Ensure each proof carries a fresh jti and is not reused across requests',
            'Ensure the proof htu matches the request URI exactly, without query string'
        ]
    },
    // A token with no cnf.jkt was presented to a deployment that requires
    // binding — i.e. a session minted before binding was switched on. Treated
    // as a logout so the client tears down and signs in again, acquiring a
    // bound session; accepting it would let anyone downgrade to bearer.
    'TOKEN-BINDING::UNBOUND-SESSION::A::p': {
        status: 401,
        context: 'This session predates device binding and can no longer be used',
        errorCode: 'TOKEN-BINDING::UNBOUND-SESSION::A::p',
        fault: 'CLIENT',
        solutions: ['Sign in again to obtain a device-bound session']
    }
};

export { TokenBinding };
