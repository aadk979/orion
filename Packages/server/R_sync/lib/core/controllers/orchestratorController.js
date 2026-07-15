import { auditLogger } from '../../utils/AuditLogSystem.js';
import { getTunnelManager } from '../TunnelManager.js';
import {
    addWorker,
    getWorkerById,
    getAllWorkers,
    updateWorker,
    logEvent,
    clearAllData
} from '../../utils/lokidb.js';
import { deleteFromCaller } from '../../utils/fileHandler.js';
import { PERSISTANT_ORCHESTRATOR_CONFIG_FILE, R_SYNC_LOCAL_DB_NAME } from '../../r_sync.meta.js';
import { generateId } from '../../utils/valueGenerators.js';
import { getCurrentUnixTime } from '../../utils/Date&Time.js';
import { logger } from '../../utils/logger.js';
import { globalAccessPoint } from '../../utils/globalAccessPoint.js';

// In-memory storage for orchestrator-side event handlers (for worker → orchestrator events)
const orchestratorEventHandlers = [];

function normalizeIp(addr) {
    if (!addr || typeof addr !== 'string') return '';
    return addr.replace(/^::ffff:/, '');
}

/**
 * Compare two Ed25519 identity public keys (JWK form). The `x` field is the
 * actual public key material and uniquely identifies the key.
 */
function identityKeysMatch(a, b) {
    if (!a || !b) return false;
    return a.kty === b.kty && a.crv === b.crv && a.x === b.x;
}

/**
 * Prefer TCP peer address unless orchestrator config enables trusting x-r_sync-ip (NAT / multi-homed).
 */
function resolveWorkerIp(req) {
    const trust =
        globalAccessPoint.getValue('trustAdvertisedWorkerIp') === true;
    const advertised = (req.headers['x-r_sync-ip'] || '').trim();
    const peerRaw = req.socket?.remoteAddress || req.ip || '';
    const peer = normalizeIp(String(peerRaw)) || '127.0.0.1';
    if (trust && advertised) return advertised;
    return peer;
}

/**
 * POST /r_sync/api/v1/discover-me
 * Worker registration endpoint
 */
const registerWorker = async (req, res) => {
    try {
        const { signaturePublicKey, identityPublicKey, encryptionPublicKey, cluster, existingWorkerId } = req.body;
        const workerIp = resolveWorkerIp(req);
        const workerPort = req.headers['x-r_sync-port'] || 55322;
        const workerCluster = req.headers['x-r_sync-cluster'] || cluster;
        const headerWorkerId = req.headers['x-r_sync-worker-id'];
        const timestamp = req.headers['x-r_sync-timestamp'];

        auditLogger.record({
            actorId: workerIp,
            actionType: 'WORKER_REGISTER_REQUEST',
            resource: existingWorkerId || headerWorkerId || 'NEW_WORKER',
            outcome: 'PENDING',
            severity: 'INFO',
            metadata: {
                workerCluster: workerCluster,
                requestHeaders: {
                    'x-r_sync-ip': req.headers['x-r_sync-ip'],
                    'x-r_sync-port': req.headers['x-r_sync-port'],
                    'x-r_sync-cluster': req.headers['x-r_sync-cluster'],
                    'x-r_sync-version': req.headers['x-r_sync-version']
                },
                method: req.method,
                url: req.originalUrl
            }
        });

        // Validate cluster match
        const orchestratorCluster = globalAccessPoint.getValue('cluster');
        if (!workerCluster || workerCluster !== orchestratorCluster) {
            logger.error(`Cluster mismatch: worker="${workerCluster}" orchestrator="${orchestratorCluster}"`);
            return res.status(403).json({
                error: true,
                errorCode: 'CLUSTER_MISMATCH',
                message: `Cluster mismatch: worker cluster "${workerCluster}" does not match orchestrator cluster "${orchestratorCluster}"`
            });
        }

        // Validate required fields
        if (!signaturePublicKey || !encryptionPublicKey || !identityPublicKey) {
            return res.status(400).json({
                error: true,
                errorCode: 'MISSING_KEYS',
                message: 'signaturePublicKey, identityPublicKey and encryptionPublicKey are required'
            });
        }

        // Check if this is a reconnecting worker
        const reconnectWorkerId = existingWorkerId || headerWorkerId;
        let workerId;
        let isReconnect = false;

        if (reconnectWorkerId && reconnectWorkerId.trim() !== '') {
            // Verify worker exists in database
            const existingWorker = await getWorkerById(reconnectWorkerId);

            if (existingWorker) {
                // Reconnecting worker — the PoP middleware already proved the
                // caller owns the identity private key it presented. Now verify
                // that identity matches the one bound at first registration,
                // otherwise this is an attempted takeover of a known workerId.
                if (!identityKeysMatch(existingWorker.identityPublicKey, identityPublicKey)) {
                    logger.warn(`Reconnect rejected: identity key mismatch for worker ${reconnectWorkerId} from ${workerIp}`);
                    auditLogger.record({
                        actorId: workerIp,
                        actionType: 'WORKER_RECONNECT_REJECTED',
                        resource: reconnectWorkerId,
                        outcome: 'DENIED',
                        severity: 'CRITICAL',
                        metadata: {
                            violationType: 'IDENTITY_MISMATCH',
                            method: req.method,
                            url: req.originalUrl
                        }
                    });
                    return res.status(403).json({
                        error: true,
                        errorCode: 'IDENTITY_MISMATCH',
                        message: 'Reconnect denied: identity key does not match the registered worker'
                    });
                }

                // Reconnecting worker - reuse ID and update data
                workerId = reconnectWorkerId;
                isReconnect = true;

                await updateWorker(workerId, {
                    ip: workerIp,
                    port: parseInt(workerPort),
                    status: 'active',
                    signaturePublicKey: signaturePublicKey,
                    lastHeartbeat: getCurrentUnixTime(),
                    lastReconnect: getCurrentUnixTime()
                });

                logger.info(`Worker reconnecting: ${workerId} from ${workerIp}:${workerPort} (key rotation)`);
            } else {
                // Worker ID provided but not found - treat as new registration
                workerId = generateId('WORKER', 24);
                logger.warn(`Worker ${reconnectWorkerId} not found, issuing new ID: ${workerId}`);
            }
        } else {
            // New worker registration
            workerId = generateId('WORKER', 24);
        }

        // For new workers, store in database
        if (!isReconnect) {
            const workerData = {
                id: workerId,
                ip: workerIp,
                port: parseInt(workerPort),
                status: 'active',
                cluster: workerCluster,
                registeredAt: getCurrentUnixTime(),
                lastHeartbeat: getCurrentUnixTime(),
                signaturePublicKey: signaturePublicKey,
                identityPublicKey: identityPublicKey
            };

            await addWorker(workerData);
        }

        // Establish/refresh encrypted tunnel (always rotates keys)
        const tunnelManager = getTunnelManager();
        await tunnelManager.initialize();

        const tunnelEstablished = await tunnelManager.establishTunnel(
            workerId,
            encryptionPublicKey,
            signaturePublicKey,
            isReconnect  // Pass flag to indicate key rotation
        );

        if (!tunnelEstablished) {
            return res.status(500).json({
                error: true,
                errorCode: 'TUNNEL_FAILED',
                message: 'Failed to establish encrypted tunnel'
            });
        }

        // Get orchestrator's public keys and log event in parallel
        const [orchestratorEncryptionPublicKey] = await Promise.all([
            tunnelManager.getPublicKeyForExport(),
            logEvent({
                id: generateId('EVENT', 16),
                type: isReconnect ? 'WORKER_RECONNECTED' : 'WORKER_REGISTERED',
                workerId: workerId,
                timestamp: getCurrentUnixTime()
            })
        ]);

        const orchestratorSignaturePublicKey = tunnelManager.getSignaturePublicKey();

        const action = isReconnect ? 'reconnected' : 'registered';
        logger.info(`Worker ${action}: ${workerId} from ${workerIp}:${workerPort}`);

        return res.status(isReconnect ? 200 : 201).json({
            workerId: workerId,
            orchestratorEncryptionPublicKey: Array.from(orchestratorEncryptionPublicKey),
            orchestratorSignaturePublicKey: orchestratorSignaturePublicKey,
            message: isReconnect ? 'Worker reconnected with new keys' : 'Worker registered successfully',
            reconnected: isReconnect
        });

    } catch (err) {
        logger.error(`Worker registration failed: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'REGISTRATION_FAILED',
            message: err.message
        });
    }
};

/**
 * GET /r_sync/api/v1/workers
 * List all registered workers
 */
const getWorkers = async (req, res) => {
    try {
        const workers = await getAllWorkers();

        // Return sanitized worker list (no sensitive keys)
        const sanitizedWorkers = workers.map(w => ({
            id: w.id,
            ip: w.ip,
            port: w.port,
            status: w.status,
            registeredAt: w.registeredAt,
            lastHeartbeat: w.lastHeartbeat
        }));

        return res.status(200).json({
            count: sanitizedWorkers.length,
            workers: sanitizedWorkers
        });
    } catch (err) {
        logger.error(`Failed to get workers: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'FETCH_FAILED',
            message: err.message
        });
    }
};

/**
 * POST /r_sync/api/v1/broadcast
 * Broadcast event to all workers
 */
const broadcastEvent = async (req, res) => {
    try {
        const { eventName, data } = req.body;

        if (!eventName) {
            return res.status(400).json({
                error: true,
                errorCode: 'MISSING_EVENT_NAME',
                message: 'eventName is required'
            });
        }

        const event = {
            id: generateId('EVENT', 16),
            name: eventName,
            data: data || {},
            timestamp: getCurrentUnixTime()
        };

        // Log Incoming Request
        auditLogger.record({
            actorId: req.ip,
            actionType: 'API_BROADCAST_REQUEST',
            resource: eventName,
            outcome: 'PENDING',
            severity: 'INFO',
            metadata: {
                eventId: event.id,
                method: req.method,
                dataKeys: Object.keys(data || {}),
                userAgent: req.headers['user-agent']
            }
        });

        // Log event and broadcast in parallel
        const [_, results] = await Promise.all([
            logEvent({
                ...event,
                type: 'BROADCAST'
            }),
            (async () => {
                const tunnelManager = getTunnelManager();
                return await tunnelManager.broadcastToAll(event);
            })()
        ]);

        const successCount = results.filter(r => r.success).length;
        const failedCount = results.filter(r => !r.success).length;

        logger.info(`Broadcast "${eventName}": ${successCount} success, ${failedCount} failed`);

        return res.status(200).json({
            eventId: event.id,
            eventName: eventName,
            successCount: successCount,
            failedCount: failedCount,
            results: results
        });

    } catch (err) {
        logger.error(`Broadcast failed: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'BROADCAST_FAILED',
            message: err.message
        });
    }
};

/**
 * POST /r_sync/api/v1/heartbeat
 * Worker heartbeat endpoint
 */
const heartbeat = async (req, res) => {
    try {
        const workerId = req.headers['x-r_sync-worker-id'];
        const workerCluster = req.headers['x-r_sync-cluster'];

        if (!workerId) {
            return res.status(400).json({
                error: true,
                errorCode: 'MISSING_WORKER_ID',
                message: 'x-r_sync-worker-id header is required'
            });
        }

        // Validate cluster on every heartbeat
        const orchestratorCluster = globalAccessPoint.getValue('cluster');
        if (!workerCluster || workerCluster !== orchestratorCluster) {
            logger.error(`Heartbeat cluster mismatch: worker="${workerCluster}" orchestrator="${orchestratorCluster}"`);
            return res.status(403).json({
                error: true,
                errorCode: 'CLUSTER_MISMATCH',
                message: `Cluster mismatch: worker cluster "${workerCluster}" does not match orchestrator cluster "${orchestratorCluster}"`
            });
        }

        const worker = await getWorkerById(workerId);
        if (!worker) {
            return res.status(404).json({
                error: true,
                errorCode: 'WORKER_NOT_FOUND',
                message: 'Worker not registered'
            });
        }

        await updateWorker(workerId, {
            lastHeartbeat: getCurrentUnixTime(),
            status: 'active'
        });

        return res.status(200).json({
            acknowledged: true,
            timestamp: getCurrentUnixTime()
        });

    } catch (err) {
        logger.error(`Heartbeat failed: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'HEARTBEAT_FAILED',
            message: err.message
        });
    }
};

/**
 * GET /r_sync/api/v1/status
 * Orchestrator status endpoint
 */
const getStatus = async (req, res) => {
    try {
        const workers = await getAllWorkers();
        const activeWorkers = workers.filter(w => w.status === 'active').length;

        return res.status(200).json({
            status: 'running',
            role: 'ORCHESTRATOR',
            activeWorkers: activeWorkers,
            totalWorkers: workers.length,
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
 * POST /r_sync/api/v1/flush
 * Flush all data and exit
 * Sends system:flush event to all workers before clearing
 */
const flushSystem = async (req, res) => {
    try {
        logger.warn('FLUSH: System flush initiated');

        // Get all workers before clearing
        const workers = await getAllWorkers();
        const workerCount = workers.length;

        // Create flush event
        const flushEvent = {
            id: generateId('EVENT', 16),
            name: 'system:flush',
            data: {
                reason: req.body.reason || 'Manual flush requested',
                timestamp: getCurrentUnixTime(),
                initiatedBy: 'orchestrator'
            },
            timestamp: getCurrentUnixTime()
        };

        // Broadcast flush event to all workers
        logger.info(`FLUSH: Broadcasting flush event to ${workerCount} workers`);
        const tunnelManager = getTunnelManager();

        let broadcastResults = [];
        if (tunnelManager && tunnelManager.initialized) {
            broadcastResults = await tunnelManager.broadcastToAll(flushEvent);
        }

        const successCount = broadcastResults.filter(r => r.success).length;
        logger.info(`FLUSH: Flush event sent to ${successCount}/${workerCount} workers`);

        // Clear all database collections
        logger.info('FLUSH: Clearing database...');
        await clearAllData();

        // Delete config file
        logger.info('FLUSH: Deleting config files...');
        await deleteFromCaller(PERSISTANT_ORCHESTRATOR_CONFIG_FILE);
        await deleteFromCaller(R_SYNC_LOCAL_DB_NAME);

        // Clear tunnel manager state
        if (tunnelManager) {
            tunnelManager.workerConnections.clear();
        }

        logger.warn('FLUSH: System flush complete, exiting process...');

        // Send response before exiting
        res.status(200).json({
            success: true,
            message: 'Flush complete, process exiting',
            workersNotified: successCount,
            totalWorkers: workerCount,
            timestamp: getCurrentUnixTime()
        });

        // Exit after response is sent (give it time to send)
        setTimeout(() => {
            logger.info('FLUSH: Process exit');
            process.exit(0);
        }, 1000);

    } catch (err) {
        logger.error(`FLUSH: Flush failed: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'FLUSH_FAILED',
            message: err.message
        });
    }
};

/**
 * POST /r_sync/api/v1/worker-event
 * Receive an event from a worker (worker → orchestrator)
 */
const handleWorkerEvent = async (req, res) => {
    try {
        const { payload, signature, timestamp } = req.body;
        const workerId = req.headers['x-r_sync-worker-id'];

        if (!payload || !signature) {
            return res.status(400).json({
                error: true,
                errorCode: 'INVALID_EVENT',
                message: 'payload and signature are required'
            });
        }

        if (!workerId) {
            return res.status(400).json({
                error: true,
                errorCode: 'MISSING_WORKER_ID',
                message: 'x-r_sync-worker-id header is required'
            });
        }

        // Get worker connection to decrypt
        const tunnelManager = getTunnelManager();
        const connection = await tunnelManager.getWorkerConnection(workerId);

        if (!connection) {
            return res.status(404).json({
                error: true,
                errorCode: 'NO_TUNNEL',
                message: 'No established tunnel for this worker'
            });
        }

        // Decrypt and verify the event using TunnelManager
        let event;
        try {
            event = tunnelManager.decryptMessage(
                payload,
                signature,
                connection.sharedKey,
                connection.signaturePublicKey
            );
        } catch (err) {
            logger.error(`Failed to decrypt worker event from ${workerId}: ${err.message}`);
            return res.status(401).json({
                error: true,
                errorCode: 'DECRYPT_FAILED',
                message: err.message
            });
        }

        logger.info(`Received event "${event.name || 'unknown'}" from worker ${workerId}`);

        auditLogger.record({
            actorId: workerId,
            actionType: 'WORKER_EVENT_RECEIVED',
            resource: event.name,
            outcome: 'SUCCESS',
            severity: 'INFO',
            metadata: {
                eventId: event.id,
                payloadSize: JSON.stringify(payload).length,
                signaturePrefix: signature.substring(0, 10) + '...',
                timestampHeader: timestamp
            }
        });

        // Invoke registered orchestrator event handlers
        for (const handler of orchestratorEventHandlers) {
            try {
                await handler(workerId, event);
            } catch (err) {
                logger.error(`Orchestrator event handler error: ${err.message}`);
            }
        }

        return res.status(200).json({
            acknowledged: true,
            eventId: event.id,
            timestamp: getCurrentUnixTime()
        });

    } catch (err) {
        logger.error(`Worker event handling failed: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'EVENT_HANDLING_FAILED',
            message: err.message
        });
    }
};

/**
 * POST /r_sync/api/v1/send-to
 * Send an event to a specific worker by ID (Admin only - Localhost)
 */
const sendToWorkerById = async (req, res) => {
    try {
        const { workerId, eventName, data } = req.body;

        if (!workerId || !eventName) {
            return res.status(400).json({
                error: true,
                errorCode: 'MISSING_FIELDS',
                message: 'workerId and eventName are required'
            });
        }

        const event = {
            id: generateId('EVENT', 16),
            name: eventName,
            data: data || {},
            timestamp: getCurrentUnixTime()
        };

        auditLogger.record({
            actorId: 'ORCHESTRATOR', // API requestor IP? or Orchestrator logic? Let's use request IP as actor for the API call part
            actionType: 'API_SEND_TO_WORKER',
            resource: workerId,
            outcome: 'PENDING',
            severity: 'INFO',
            metadata: {
                eventName: eventName,
                eventId: event.id,
                requestIp: req.ip,
                method: req.method,
                userAgent: req.headers['user-agent']
            }
        });

        const tunnelManager = getTunnelManager();
        const success = await tunnelManager.sendToWorker(workerId, event);

        if (!success) {
            return res.status(500).json({
                error: true,
                errorCode: 'SEND_FAILED',
                message: `Failed to send event to worker ${workerId}`
            });
        }

        await logEvent({
            ...event,
            type: 'SEND_TO_WORKER',
            targetWorkerId: workerId
        });

        logger.info(`Sent "${eventName}" to worker ${workerId}`);

        return res.status(200).json({
            eventId: event.id,
            eventName: eventName,
            workerId: workerId,
            success: true
        });

    } catch (err) {
        logger.error(`Send to worker failed: ${err.message}`);
        return res.status(500).json({
            error: true,
            errorCode: 'SEND_FAILED',
            message: err.message
        });
    }
};

/**
 * Register an event handler for worker → orchestrator events
 */
const registerOrchestratorEventHandler = (handler) => {
    if (typeof handler === 'function') {
        orchestratorEventHandlers.push(handler);
    }
};

export {
    registerWorker,
    getWorkers,
    broadcastEvent,
    heartbeat,
    getStatus,
    flushSystem,
    handleWorkerEvent,
    sendToWorkerById,
    registerOrchestratorEventHandler
};
