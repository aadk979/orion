import { decrypt, verifySignature } from '../../utils/crypto.js';
import { getCurrentUnixTime } from '../../utils/Date&Time.js';
import { logger } from '../../utils/logger.js';
import { clearAllData } from '../../utils/lokidb.js';
import { deleteFromCaller } from '../../utils/fileHandler.js';
import { createReplayGuard } from '../../utils/replayGuard.js';
import { PERSISTANT_WORKER_CONFIG_FILE, R_SYNC_LOCAL_DB_NAME } from '../../r_sync.meta.js';

/** Max age (seconds) for an inbound orchestrator→worker event before it is rejected as stale. */
const INBOUND_EVENT_LEEWAY_SEC = 60;

/**
 * Replay guard for inbound events, keyed by the event id (which lives inside the
 * signed + encrypted payload, so it cannot be forged or swapped). Retention is
 * kept above the staleness window so a replayed event is caught either as a
 * duplicate (still fresh) or rejected as stale (too old).
 */
const inboundEventGuard = createReplayGuard({ retentionSec: 120 });

// In-memory storage for worker's tunnel state
let workerTunnelState = {
    orchestratorId: null,
    sharedKey: null,
    orchestratorSignaturePublicKey: null,
    mySignatureKeyPair: null,
    eventHandlers: []
};

/**
 * Self-heal hook. An orchestrator whose signing key changed (restored from a
 * wiped config, deliberately rotated, restarted on an older build) leaves this
 * worker holding a stale public key, and every inbound event fails signature
 * verification forever — the tunnel is only ever rebuilt by the worker, so
 * without this the box needs a manual restart to recover. Installed by
 * startWorker(); absent for embedded callers that never registered.
 */
let reregisterHandler = null;
let lastReregisterAt = 0;

/** Floor between re-registration attempts, so a burst of bad events triggers one handshake. */
const REREGISTER_COOLDOWN_SEC = 30;

const setReregisterHandler = handler => {
    reregisterHandler = typeof handler === 'function' ? handler : null;
};

/**
 * Fire-and-forget re-registration. Never awaited by a request handler: the
 * orchestrator is waiting on this response, and the handshake it needs to make
 * is a separate inbound call.
 */
const triggerReregistration = reason => {
    if (!reregisterHandler) return;

    const now = getCurrentUnixTime();
    if (now - lastReregisterAt < REREGISTER_COOLDOWN_SEC) return;
    lastReregisterAt = now;

    logger.warn(`Tunnel looks stale (${reason}) — re-registering with orchestrator...`);
    Promise.resolve()
        .then(() => reregisterHandler(reason))
        .then(() => logger.info('Re-registration complete — tunnel keys refreshed'))
        .catch(err => logger.error(`Re-registration failed: ${err.message}`));
};

/**
 * Handle system:flush event - clears all data and exits
 */
const handleFlushEvent = async event => {
    logger.warn('FLUSH: Received flush command from orchestrator');
    logger.info(`FLUSH: Reason: ${event.data?.reason || 'No reason provided'}`);

    try {
        // Clear database
        logger.info('FLUSH: Clearing database...');
        await clearAllData();

        // Delete config files
        logger.info('FLUSH: Deleting config files...');
        await deleteFromCaller(PERSISTANT_WORKER_CONFIG_FILE);
        await deleteFromCaller(R_SYNC_LOCAL_DB_NAME);

        // Clear in-memory state
        workerTunnelState = {
            orchestratorId: null,
            sharedKey: null,
            orchestratorSignaturePublicKey: null,
            mySignatureKeyPair: null,
            eventHandlers: []
        };

        logger.warn('FLUSH: Worker flush complete, exiting process...');

        // Exit after a short delay
        setTimeout(() => {
            logger.info('FLUSH: Process exit');
            process.exit(0);
        }, 500);
    } catch (err) {
        logger.error(`FLUSH: Failed to flush worker: ${err.message}`);
    }
};

/**
 * POST /r_sync/api/v1/event
 * Receive encrypted events from orchestrator
 */
const handleEvent = async (req, res) => {
    try {
        const { payload, signature, timestamp } = req.body;
        const orchestratorId = req.headers['x-r_sync-orchestrator-id'];

        if (!payload || !signature) {
            return res.status(400).json({
                error: true,
                errorCode: 'INVALID_EVENT',
                message: 'payload and signature are required'
            });
        }

        // Verify and decrypt the message
        if (!workerTunnelState.sharedKey) {
            // Orchestrator believes we are registered; we disagree. Rebuild the
            // tunnel rather than sitting at 503 until someone notices.
            triggerReregistration('missing-shared-key');
            return res.status(503).json({
                error: true,
                errorCode: 'NOT_REGISTERED',
                message: 'Worker is not registered with orchestrator'
            });
        }

        // Verify signature
        const isValid = verifySignature(payload, signature, workerTunnelState.orchestratorSignaturePublicKey);

        if (!isValid) {
            logger.error('Invalid event signature received');
            // Most likely our stored orchestrator public key is stale rather than
            // the event being forged — a forger cannot produce a valid signature
            // either way, and re-registration only ever replaces our own key
            // material via the normal authenticated handshake.
            triggerReregistration('invalid-signature');
            return res.status(401).json({
                error: true,
                errorCode: 'INVALID_SIGNATURE',
                message: 'Event signature verification failed'
            });
        }

        // Decrypt the event
        const decrypted = decrypt(payload, workerTunnelState.sharedKey);
        let event;
        try {
            event = JSON.parse(decrypted);
        } catch {
            event = { data: decrypted };
        }

        // Replay protection. The event id and timestamp live inside the signed,
        // encrypted payload, so a network attacker cannot forge or alter them.
        // Reject stale events outright, and treat any already-seen id as an
        // idempotent duplicate (a legitimate delivery retry) — acknowledge it
        // WITHOUT re-invoking handlers, so a replayed side effect (e.g. a
        // captured system:flush) can never fire twice.
        const eventTs = Number(event.timestamp);
        const now = getCurrentUnixTime();
        if (!Number.isFinite(eventTs) || Math.abs(now - eventTs) > INBOUND_EVENT_LEEWAY_SEC) {
            logger.warn(`Rejected stale/invalid-timestamp event "${event.name || 'unknown'}" (ts=${event.timestamp})`);
            return res.status(401).json({
                error: true,
                errorCode: 'STALE_EVENT',
                message: 'Event timestamp is missing or outside the accepted window'
            });
        }

        if (!event.id || inboundEventGuard.has(event.id)) {
            logger.warn(`Duplicate/replayed event ignored: ${event.name || 'unknown'} (${event.id || 'no-id'})`);
            return res.status(200).json({
                acknowledged: true,
                eventId: event.id,
                duplicate: true,
                timestamp: getCurrentUnixTime()
            });
        }
        inboundEventGuard.record(event.id);

        logger.info(`Received event: ${event.name || 'unknown'}`);

        // Check for system:flush event (built-in handler)
        if (event.name === 'system:flush') {
            // Send response first, then flush
            res.status(200).json({
                acknowledged: true,
                eventId: event.id,
                timestamp: getCurrentUnixTime(),
                flushing: true
            });

            // Handle flush asynchronously
            handleFlushEvent(event);
            return;
        }

        // Invoke registered event handlers for other events
        for (const handler of workerTunnelState.eventHandlers) {
            try {
                await handler(event);
            } catch (err) {
                logger.error(`Event handler error: ${err.message}`);
            }
        }

        return res.status(200).json({
            acknowledged: true,
            eventId: event.id,
            timestamp: getCurrentUnixTime()
        });
    } catch (err) {
        logger.error(`Event handling failed: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'EVENT_HANDLING_FAILED',
            message: err.message
        });
    }
};

/**
 * GET /r_sync/api/v1/status
 * Worker status endpoint
 */
const getWorkerStatus = async (req, res) => {
    try {
        return res.status(200).json({
            status: 'running',
            role: 'WORKER',
            registered: workerTunnelState.sharedKey !== null,
            orchestratorId: workerTunnelState.orchestratorId,
            timestamp: getCurrentUnixTime()
        });
    } catch (err) {
        return res.status(500).json({
            error: true,
            errorCode: 'STATUS_FAILED',
            message: err.message
        });
    }
};

/**
 * Register an event handler
 */
const registerEventHandler = handler => {
    if (typeof handler === 'function') {
        workerTunnelState.eventHandlers.push(handler);
    }
};

/**
 * Set tunnel state after registration
 */
const setTunnelState = state => {
    workerTunnelState = { ...workerTunnelState, ...state };
};

/**
 * Get current tunnel state
 */
const getTunnelState = () => workerTunnelState;

export { handleEvent, getWorkerStatus, registerEventHandler, setTunnelState, getTunnelState, setReregisterHandler };
