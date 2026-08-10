/**
 * Security Middleware
 *
 * Provides middleware for:
 * - Validating worker signatures (authentication)
 * - Verifying Proof of Possession for registration
 * - Restricting sensitive endpoints to localhost
 */

import { verifySignature, sha256Hash } from '../../utils/crypto.js';
import { getWorkerById } from '../../utils/lokidb.js';
import { logger } from '../../utils/logger.js';
import { getCurrentUnixTime } from '../../utils/Date&Time.js';
import { auditLogger } from '../../utils/AuditLogSystem.js';
import { globalAccessPoint } from '../../utils/globalAccessPoint.js';
import { createReplayGuard } from '../../utils/replayGuard.js';
import { buildRequestSignaturePayload } from '../../utils/requestSignature.js';
import { verifyRequest } from '../../utils/httpSignature.js';

/** Max clock skew for signed worker requests (worker-event, heartbeat), in seconds */
const AUTH_TIMESTAMP_LEEWAY_SEC = 30;
/** Registration PoP requests may arrive slightly delayed; allow a wider window */
const REGISTRATION_TIMESTAMP_LEEWAY_SEC = 120;
/** How long to retain a nonce after first use (seconds) */
const NONCE_RETENTION_SEC = 90;

/**
 * @param {number} timestampSec
 * @param {number} nowSec
 * @param {number} leewaySec
 */
function isTimestampWithinLeeway(timestampSec, nowSec, leewaySec) {
    if (!Number.isFinite(timestampSec) || timestampSec <= 0) return false;
    return Math.abs(nowSec - timestampSec) <= leewaySec;
}

/**
 * Middleware to restrict access to localhost only
 */
const restrictToLocalhost = (req, res, next) => {
    const remoteIp = req.socket.remoteAddress;
    const isLocal = remoteIp === '::1' || remoteIp === '127.0.0.1' || remoteIp === '::ffff:127.0.0.1';

    if (!isLocal) {
        const msg = `Blocked external access to ${req.path} from ${remoteIp}`;
        logger.warn(msg);
        auditLogger.record({
            actorId: remoteIp,
            actionType: 'SECURITY_VIOLATION',
            resource: req.path,
            outcome: 'DENIED',
            severity: 'CRITICAL',
            metadata: {
                violationType: 'LOCALHOST_RESTRICTION',
                method: req.method,
                query: req.query,
                userAgent: req.headers['user-agent'],
                msg: msg
            }
        });
        return res.status(403).json({
            error: true,
            errorCode: 'FORBIDDEN',
            message: 'Access restricted to localhost'
        });
    }
    next();
};

/**
 * Middleware to enforce ETS lockdown
 *
 * When the ErrorTrackerSystem trips a critical threshold it writes
 * ETS_LOCKDOWN = true into the GlobalAccessPoint.  This middleware reads that
 * flag and refuses all incoming M2M requests with a 503 until an admin lifts
 * the lockdown via DELETE /r_sync/api/v1/ets/lockdown.
 *
 * Apply this to worker-facing routes only (discover-me, heartbeat,
 * worker-event).  Admin/ETS routes intentionally skip it so operators can
 * always reach the diagnostics and lift endpoints.
 */
const enforceETSLockdown = (req, res, next) => {
    let isLockedDown = false;

    try {
        isLockedDown = globalAccessPoint.getValue('ETS_LOCKDOWN') === true;
    } catch {
        // ETS_LOCKDOWN key not yet initialised — treat as not locked
    }

    if (isLockedDown) {
        const msg = `ETS LOCKDOWN: Blocked incoming M2M request to ${req.path} from ${req.ip}`;
        logger.warn(msg);
        auditLogger.record({
            actorId: req.ip,
            actionType: 'ETS_LOCKDOWN_BLOCK',
            resource: req.path,
            outcome: 'DENIED',
            severity: 'CRITICAL',
            metadata: {
                violationType: 'ETS_LOCKDOWN',
                method: req.method,
                userAgent: req.headers['user-agent'],
                msg
            }
        });
        return res.status(503).json({
            error: true,
            errorCode: 'ETS_LOCKDOWN',
            message: 'System is in lockdown due to critical error thresholds. Contact an admin to lift the lockdown via DELETE /r_sync/api/v1/ets/lockdown.'
        });
    }

    next();
};

/**
 * Middleware to enforce M2M-only access.
 *
 * NOTE: This is best-effort defense-in-depth only — a User-Agent denylist is
 * trivially bypassed and must NOT be relied on as an access control. The actual
 * security guarantees come from the cryptographic layers downstream:
 * validateRegistrationSignature (PoP), validateWorkerSignature (signed +
 * replay-protected requests), and restrictToLocalhost (admin endpoints).
 */
const restrictToM2M = (req, res, next) => {
    const userAgent = req.headers['user-agent'] || '';

    // Block common browser user agents
    if (userAgent.includes('Mozilla') || userAgent.includes('Chrome') || userAgent.includes('Safari') || userAgent.includes('Edge')) {
        const msg = `Blocked browser access from ${req.ip} (UA: ${userAgent})`;
        logger.warn(msg);
        auditLogger.record({
            actorId: req.ip,
            actionType: 'SECURITY_VIOLATION',
            resource: req.path,
            outcome: 'DENIED',
            severity: 'CRITICAL',
            metadata: {
                violationType: 'BROWSER_RESTRICTION',
                method: req.method,
                userAgent: userAgent,
                headers: {
                    host: req.headers['host'],
                    accept: req.headers['accept']
                },
                msg: msg
            }
        });
        return res.status(403).send('ACCESS DENIED: M2M Communication Only');
    }

    // Require R-Sync specific headers for critical endpoints
    // (Optional: enforce x-r_sync-version or similar if we added it to clients)

    next();
};

/**
 * Middleware to validate Worker Signature
 * Expects headers:
 * - x-r_sync-worker-id
 * - x-r_sync-signature
 * - x-r_sync-timestamp
 */
// Basic in-memory nonce cache
// In production, use Redis or a proper sliding window implementation
const nonceCache = new Map();

// Clean up old nonces every minute
const nonceCleanupTimer = setInterval(() => {
    const now = getCurrentUnixTime();
    for (const [nonce, expiry] of nonceCache.entries()) {
        if (now > expiry) {
            nonceCache.delete(nonce);
        }
    }
}, 60000);
if (typeof nonceCleanupTimer.unref === 'function') {
    nonceCleanupTimer.unref();
}

/**
 * Middleware to validate Worker Signature
 * Expects headers:
 * - x-r_sync-worker-id
 * - x-r_sync-signature
 * - x-r_sync-timestamp
 * - x-r_sync-nonce (New)
 */
/**
 * RFC 9421 verification path.
 *
 * Tried FIRST, because it is the scheme every current worker signs with. A
 * request carrying `Signature-Input` is verified here and never falls through
 * to the legacy branch — so a peer that speaks the standard cannot be talked
 * into the proprietary format by omitting a header.
 *
 * @returns {null} when this request is not RFC 9421 signed, so the caller can
 *   decide whether the legacy path is still permitted.
 */
const tryRfc9421 = async (req, res) => {
    if (!req.headers['signature-input'] || !req.headers['signature']) return null;

    const workerId = req.headers['x-r_sync-worker-id'];

    if (!workerId) {
        return res.status(401).json({ error: true, errorCode: 'MISSING_AUTH_HEADERS', message: 'Missing x-r_sync-worker-id' });
    }

    const worker = await getWorkerById(workerId);

    if (!worker) {
        return res.status(404).json({ error: true, errorCode: 'WORKER_NOT_FOUND', message: 'Worker not found' });
    }

    if (!worker.signaturePublicKey) {
        return res.status(403).json({ error: true, errorCode: 'NO_PUBLIC_KEY', message: 'Worker has no registered signature key' });
    }

    // Reconstruct the absolute target URI the worker signed. `@target-uri`
    // binds host and port as well as path, so a signature captured against one
    // orchestrator cannot be replayed at another.
    const forwardedProto = req.headers['x-forwarded-proto'];
    const scheme = (typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : null) || req.protocol || 'http';
    const targetUri = `${scheme}://${req.headers.host}${req.originalUrl}`;

    const result = verifyRequest({
        method: req.method,
        url: targetUri,
        headers: req.headers,
        body: req.body,
        publicJwk: worker.signaturePublicKey,
        maxAgeSeconds: AUTH_TIMESTAMP_LEEWAY_SEC
    });

    if (!result.valid) {
        logger.warn(`RFC 9421 signature rejected for worker ${workerId}: ${result.reason}`);
        auditLogger.record({
            actorId: workerId,
            actionType: 'SECURITY_VIOLATION',
            resource: req.path,
            outcome: 'DENIED',
            severity: 'HIGH',
            metadata: { violationType: 'HTTP_SIGNATURE_INVALID', reason: result.reason, method: req.method }
        });

        return res.status(401).json({ error: true, errorCode: 'INVALID_SIGNATURE', message: 'Signature verification failed' });
    }

    // Nonce recorded only after the signature verifies, so a bogus request
    // cannot pre-burn a nonce the worker's legitimate retry would reuse.
    const nonce = result.params.nonce;

    if (nonceCache.has(nonce)) {
        logger.warn(`Replay detected! Nonce reused: ${nonce} from worker ${workerId}`);
        return res.status(401).json({ error: true, errorCode: 'REPLAY_DETECTED', message: 'Request replay detected' });
    }

    nonceCache.set(nonce, getCurrentUnixTime() + NONCE_RETENTION_SEC);

    return 'verified';
};

const validateWorkerSignature = async (req, res, next) => {
    try {
        // Standard scheme first.
        const rfcResult = await tryRfc9421(req, res);

        if (rfcResult === 'verified') return next();
        if (rfcResult !== null) return rfcResult; // a response was already sent

        // No RFC 9421 headers. Only the transition window permits the legacy
        // format; once a fleet is upgraded this is switched off and an unsigned
        // or old-format request is simply refused.
        if (globalAccessPoint.getValue('R_SYNC_ACCEPT_LEGACY_SIGNATURES') !== true) {
            return res.status(401).json({
                error: true,
                errorCode: 'MISSING_AUTH_HEADERS',
                message: 'Request must carry RFC 9421 Signature-Input and Signature headers'
            });
        }

        const workerId = req.headers['x-r_sync-worker-id'];
        const signature = req.headers['x-r_sync-signature']; // Base64 signature
        const timestamp = parseInt(String(req.headers['x-r_sync-timestamp'] || ''), 10);
        const nonce = req.headers['x-r_sync-nonce'];

        if (!workerId || !signature || !Number.isFinite(timestamp) || timestamp <= 0 || !nonce) {
            return res.status(401).json({
                error: true,
                errorCode: 'MISSING_AUTH_HEADERS',
                message: 'Missing authentication headers (id, signature, timestamp, nonce)'
            });
        }

        const now = getCurrentUnixTime();
        if (!isTimestampWithinLeeway(timestamp, now, AUTH_TIMESTAMP_LEEWAY_SEC)) {
            return res.status(401).json({
                error: true,
                errorCode: 'INVALID_TIMESTAMP',
                message: 'Request timestamp out of sync'
            });
        }

        // Validate Nonce uniqueness (reject known replays early, but do not RECORD
        // the nonce until the signature has verified — otherwise an attacker could
        // pre-burn a nonce with a bogus request and make the worker's legitimate
        // retry bounce as a false replay).
        if (nonceCache.has(nonce)) {
            logger.warn(`Replay attack detected! Nonce reused: ${nonce} from worker ${workerId}`);
            return res.status(401).json({
                error: true,
                errorCode: 'REPLAY_DETECTED',
                message: 'Request replay detected'
            });
        }

        // Get Worker Public Key
        const worker = await getWorkerById(workerId);
        if (!worker) {
            return res.status(404).json({
                error: true,
                errorCode: 'WORKER_NOT_FOUND',
                message: 'Worker not found'
            });
        }

        if (!worker.signaturePublicKey) {
            return res.status(403).json({
                error: true,
                errorCode: 'NO_PUBLIC_KEY',
                message: 'Worker has no registered signature key'
            });
        }

        // Legacy proprietary canonical string. Accepted only while a fleet is
        // mid-upgrade — see the RFC 9421 branch in validateWorkerSignature.
        const signedPayload = buildRequestSignaturePayload({
            method: req.method,
            path: req.originalUrl.split('?')[0],
            body: req.body,
            workerId,
            timestamp,
            nonce
        });

        const isValid = verifySignature(signedPayload, signature, worker.signaturePublicKey);

        if (!isValid) {
            logger.warn(`Signature verification failed for worker ${workerId}`);
            return res.status(401).json({
                error: true,
                errorCode: 'INVALID_SIGNATURE',
                message: 'Signature verification failed'
            });
        }

        // Signature is valid — now it is safe to record the nonce as consumed.
        nonceCache.set(nonce, now + NONCE_RETENTION_SEC);

        next();
    } catch (err) {
        logger.error(`Auth middleware error: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'AUTH_ERROR',
            message: 'Authentication processing failed'
        });
    }
};

// Replay guard for registration requests. Registration signatures are valid
// for a wider window (REGISTRATION_TIMESTAMP_LEEWAY_SEC), so the nonce must be
// retained at least that long to block replays inside the window.
const registrationNonceGuard = createReplayGuard({
    retentionSec: REGISTRATION_TIMESTAMP_LEEWAY_SEC + 30
});

/**
 * Middleware to validate Proof of Possession for Registration.
 *
 * Verifies that the requester owns the private half of the PERSISTENT
 * identityPublicKey it presents. The signature is bound to:
 *   - a fresh nonce (replay defense)
 *   - the timestamp (freshness)
 *   - a digest of the encryption public key being offered (so a captured
 *     request cannot be replayed with swapped key material)
 *
 * Identity continuity across reconnects (i.e. proving this is the SAME worker
 * that registered before) is enforced in the controller by comparing this
 * identityPublicKey against the one stored for the worker id.
 */
const validateRegistrationSignature = (req, res, next) => {
    try {
        const { identityPublicKey, encryptionPublicKey } = req.body;
        const workerId = req.headers['x-r_sync-worker-id'] || ''; // Might be empty on first register
        const signature = req.headers['x-r_sync-signature'];
        const timestampRaw = req.headers['x-r_sync-timestamp'];
        const nonce = req.headers['x-r_sync-nonce'];

        if (!identityPublicKey || !signature || !nonce || timestampRaw === undefined || timestampRaw === '') {
            return res.status(400).json({
                error: true,
                errorCode: 'MISSING_REG_HEADERS',
                message: 'Missing registration headers (identityPublicKey, signature, timestamp, nonce)'
            });
        }

        const ts = parseInt(String(timestampRaw), 10);
        const now = getCurrentUnixTime();
        if (!isTimestampWithinLeeway(ts, now, REGISTRATION_TIMESTAMP_LEEWAY_SEC)) {
            return res.status(401).json({
                error: true,
                errorCode: 'INVALID_TIMESTAMP',
                message: 'Registration timestamp out of sync'
            });
        }

        if (registrationNonceGuard.has(nonce)) {
            logger.warn(`Registration replay detected: nonce reused (${nonce})`);
            return res.status(401).json({
                error: true,
                errorCode: 'REPLAY_DETECTED',
                message: 'Registration replay detected'
            });
        }

        const encKeyDigest = sha256Hash(JSON.stringify(encryptionPublicKey || []));
        const signedPayload = `${ts}:${workerId}:${nonce}:${encKeyDigest}`;

        const isValid = verifySignature(signedPayload, signature, identityPublicKey);

        if (!isValid) {
            return res.status(401).json({
                error: true,
                errorCode: 'INVALID_PoP_SIGNATURE',
                message: 'Proof of Possession failed: signature does not match provided identity key'
            });
        }

        // Only record the nonce after the signature verifies, so a bogus request
        // cannot burn a nonce the legitimate worker might reuse on retry.
        registrationNonceGuard.record(nonce);

        next();
    } catch (err) {
        logger.error(`Registration PoP error: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'AUTH_ERROR',
            message: 'Registration validation failed'
        });
    }
};

export {
    restrictToLocalhost,
    restrictToM2M,
    enforceETSLockdown,
    validateWorkerSignature,
    validateRegistrationSignature,
    AUTH_TIMESTAMP_LEEWAY_SEC,
    REGISTRATION_TIMESTAMP_LEEWAY_SEC,
    NONCE_RETENTION_SEC,
    isTimestampWithinLeeway
};
