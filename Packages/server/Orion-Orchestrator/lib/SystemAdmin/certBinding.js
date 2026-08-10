/**
 * Certificate-bound admin sessions — RFC 8705 §3.
 *
 * WHY THE ADMIN PLANE AND NOT THE WORKER PLANE
 *
 * RFC 8705 binds a BEARER TOKEN to the client certificate that presented it.
 * That is only meaningful where a bearer token exists. R_sync workers have
 * none — they sign every request with their own key (RFC 9421), so there is no
 * portable credential to steal and nothing for a certificate to bind.
 *
 * The admin plane is the opposite case. `resolveSession` accepts an opaque
 * bearer token from `Authorization: Bearer`, and orionctl writes that token to
 * a config file on disk so it survives between invocations. That file is a
 * durable, portable, system-admin-grade credential: copied into a backup or
 * read by anything running as that user, it works from anywhere in the world.
 *
 * Binding it to the mTLS client certificate removes exactly that property. The
 * token still authenticates the session, but presenting it now also requires
 * completing a TLS handshake with the private key the certificate attests to —
 * a key that stays on the operator's machine. A stolen config file becomes
 * inert, which is the same outcome DPoP produces on the user-facing plane.
 *
 * THE THUMBPRINT
 *
 * `x5t#S256` is the base64url-encoded SHA-256 of the DER-encoded certificate
 * (RFC 8705 §3.1). It covers the whole certificate, so a client cannot keep the
 * same key and re-issue itself a certificate with different attributes and
 * still match — which is what makes it usable with self-signed client certs,
 * not just a managed PKI.
 */
import crypto from 'crypto';

/**
 * Computes the RFC 8705 `x5t#S256` confirmation value for a DER certificate.
 *
 * @param {Buffer} der raw DER bytes
 * @returns {string} base64url SHA-256
 */
const thumbprintFromDer = der => crypto.createHash('sha256').update(der).digest('base64url');

/**
 * Extracts the confirmation thumbprint from a Node TLS socket.
 *
 * Returns null when the connection is not mutually authenticated — either
 * plain HTTP, or TLS where the client presented no certificate. Callers decide
 * what that means; this function does not guess, because "no certificate" and
 * "certificate that fails to match" need different responses.
 *
 * @param {import('net').Socket} socket
 * @returns {string|null}
 */
const thumbprintFromSocket = socket => {
    if (!socket || typeof socket.getPeerCertificate !== 'function') return null;

    // `raw` is the DER encoding. Without it there is no certificate to hash —
    // getPeerCertificate() returns an empty object when the peer sent none.
    const cert = socket.getPeerCertificate(false);

    if (!cert || !cert.raw || cert.raw.length === 0) return null;

    return thumbprintFromDer(cert.raw);
};

/**
 * Constant-time comparison of two thumbprints.
 *
 * A thumbprint is not secret, so this is belt-and-braces rather than strictly
 * required — but it is a comparison on an authentication path, and making it
 * timing-safe costs nothing and removes the need for anyone to reason about
 * whether it matters here.
 */
const thumbprintsMatch = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string') return false;

    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');

    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Decides whether a request may use a session, given the certificate it
 * presented and the one the session was bound to.
 *
 * @param {object} params
 * @param {boolean} params.bindingRequired  mTLS binding enabled for this deployment
 * @param {string|null} params.sessionThumbprint  what the session was bound to
 * @param {string|null} params.presentedThumbprint  what this connection presented
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
const evaluateCertBinding = ({ bindingRequired, sessionThumbprint, presentedThumbprint }) => {
    if (!bindingRequired) return { ok: true };

    // A session minted before binding was switched on. Honouring it would leave
    // every pre-cutover token working as a plain bearer credential — the exact
    // hole the feature exists to close — so it is refused and the operator
    // signs in again, acquiring a bound session.
    if (!sessionThumbprint) {
        return { ok: false, reason: 'SESSION_NOT_BOUND' };
    }

    if (!presentedThumbprint) {
        return { ok: false, reason: 'NO_CLIENT_CERTIFICATE' };
    }

    if (!thumbprintsMatch(sessionThumbprint, presentedThumbprint)) {
        return { ok: false, reason: 'CERTIFICATE_MISMATCH' };
    }

    return { ok: true };
};

export { thumbprintFromDer, thumbprintFromSocket, thumbprintsMatch, evaluateCertBinding };
