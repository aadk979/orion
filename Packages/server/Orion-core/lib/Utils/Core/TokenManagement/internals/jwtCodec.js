/**
 * Minimal JWT helpers bound to TokenSecretsManager key pair objects
 * (fields: `_nodePrivateKey` / `_nodePublicKey`, `keyPairId`,
 * `generationConfig.algorithm`).
 *
 * Verification returns structured results instead of throwing so callers can
 * map outcomes onto their own error codes.
 */
import jwt from 'jsonwebtoken';

/** kid from a token's header, or null when the token is malformed/unsigned. */
function decodeKeyId(token) {
    return jwt.decode(token, { complete: true })?.header?.kid || null;
}

function signWithKeyPair(secret, payload, expiresIn) {
    return jwt.sign(payload, secret._nodePrivateKey, {
        expiresIn,
        algorithm: secret.generationConfig.algorithm,
        keyid: secret.keyPairId
    });
}

/** @returns {{valid: true, payload: object} | {valid: false, expired: boolean}} */
function verifyWithKeyPair(token, secret) {
    try {
        const payload = jwt.verify(token, secret._nodePublicKey, {
            algorithms: [secret.generationConfig.algorithm]
        });
        return { valid: true, payload };
    } catch (e) {
        return { valid: false, expired: e.message === 'jwt expired' };
    }
}

/**
 * Reads the stateful tokenId out of a token WITHOUT verifying its signature.
 *
 * Only for reuse detection, where the row a valid token would point at has
 * already been deleted, so there is nothing left to verify against. The value is
 * used purely as a lookup key into the consumed-token set — a forged token
 * yields an id that is not in that set and is simply not found. Never use this
 * for anything that grants access.
 *
 * @returns {string|null} the short-form tokenId (td.ti), or null
 */
function decodeTokenIdWithoutVerification(token) {
    try {
        const payload = jwt.decode(token);
        // Short field map: tokenData -> td, tokenId -> ti
        return payload?.td?.ti || payload?.tokenData?.tokenId || null;
    } catch {
        return null;
    }
}

export { decodeKeyId, signWithKeyPair, verifyWithKeyPair, decodeTokenIdWithoutVerification };
