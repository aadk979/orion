/**
 * Keyed digest for device fingerprints.
 *
 * Fingerprints were stored with bcrypt at cost 12. bcrypt exists to be slow so
 * that low-entropy secrets (passwords) resist offline guessing — a fingerprint
 * is 64 hex characters of high entropy, so there is nothing to guess, and the
 * slowness bought no security while costing ~100ms of CPU on every authenticated
 * request at tiers 3 and 4.
 *
 * HMAC-SHA256 under a server-held key gives what is actually wanted: the stored
 * value is useless to anyone who reads the database (they cannot correlate it
 * back to a device without the key), verification is constant-time, and the cost
 * is nanoseconds.
 *
 * Values are prefixed `hmac$` so pre-existing bcrypt rows are still recognised
 * and verified with bcrypt — no migration, no invalidated sessions. New writes
 * always use HMAC; old rows age out naturally with their tokens and devices.
 */
import crypto from 'crypto';
import { verifyHash } from './CryptoFunctions.js';
import { globalAccessPoint } from './GlobalAccessPoint.js';
import { logger } from './logger.js';

const HMAC_PREFIX = 'hmac$';

/**
 * Server key for fingerprint digests.
 *
 * Boot REQUIRES `tokens.fingerprintDigestKey` at security tier 3 and above —
 * the tiers that actually consult the digest — so the fallback below is only
 * reachable at tiers 1 and 2, where nothing reads it, or in tests. See
 * handleTokenSecretsSetup in Server/onStartConfigurations.js.
 *
 * The fallback is kept rather than made fatal here because this module is also
 * loaded by tooling and tests that never boot a server. What it must not do is
 * silently become the production path, which is what the boot check prevents:
 * a per-process key makes every fingerprint check fail after a restart and on
 * every node that did not mint the token, and at tier 4 that is enough to push
 * the whole deployment into step-up.
 */
let cachedKey = null;

const getKey = () => {
    if (cachedKey) return cachedKey;

    const configured = globalAccessPoint.getValue('fingerprintDigestKey');

    if (configured) {
        cachedKey = Buffer.from(configured, 'utf8');
        return cachedKey;
    }

    cachedKey = crypto.randomBytes(32);
    logger.warn(
        'Fingerprint digest key not configured (tokens.fingerprintDigestKey) — using a per-process key. ' +
            'Fingerprint risk signals will not survive a restart or match across cluster nodes.'
    );
    return cachedKey;
};

/**
 * @param {string} fingerprint
 * @returns {string} `hmac$<hex>`
 */
const digestFingerprint = fingerprint => {
    const value = typeof fingerprint === 'string' ? fingerprint : '';
    return HMAC_PREFIX + crypto.createHmac('sha256', getKey()).update(value).digest('hex');
};

/**
 * Verifies a fingerprint against a stored digest, transparently handling rows
 * written before the HMAC switch.
 *
 * @param {string} fingerprint
 * @param {string} stored
 * @returns {Promise<boolean>}
 */
const verifyFingerprint = async (fingerprint, stored) => {
    if (!stored) return false;

    // Legacy bcrypt row — verify the old way.
    if (!stored.startsWith(HMAC_PREFIX)) {
        return verifyHash(typeof fingerprint === 'string' ? fingerprint : '', stored);
    }

    const expected = Buffer.from(stored, 'utf8');
    const actual = Buffer.from(digestFingerprint(fingerprint), 'utf8');

    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

/** Test seam — drops the memoized key. */
const _resetKeyForTests = () => {
    cachedKey = null;
};

export { digestFingerprint, verifyFingerprint, HMAC_PREFIX, _resetKeyForTests };
