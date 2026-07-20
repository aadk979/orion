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

export { decodeKeyId, signWithKeyPair, verifyWithKeyPair };
