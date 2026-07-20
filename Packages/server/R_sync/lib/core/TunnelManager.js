import {
    generateKeyPairECC,
    exportPublicKeyECC,
    importPublicKeyECC,
    deriveSharedSecret,
    deriveKey,
    deriveTunnelSalt,
    encrypt,
    decrypt,
    generateSignature,
    verifySignature,
    generateSignatureKeyPair
} from '../utils/crypto.js';
import { globalAccessPoint } from '../utils/globalAccessPoint.js';
import { getEncryptionKeyByWorkerId, storeEncryptionKey, getWorkerById, getAllWorkers, updateWorker } from '../utils/lokidb.js';
import { generateId } from '../utils/valueGenerators.js';
import { getCurrentUnixTime } from '../utils/Date&Time.js';
import { logger } from '../utils/logger.js';
import { auditLogger } from '../utils/AuditLogSystem.js';

class TunnelManager {
    static instance = null;

    constructor(encryptionAlg = 'P-256') {
        if (TunnelManager.instance) {
            return TunnelManager.instance;
        }

        this.encryptionAlg = encryptionAlg;
        this.keyPair = null;
        this.signatureKeyPair = null;
        this.workerConnections = new Map(); // workerId -> { sharedKey, publicKey }
        this.initialized = false;

        TunnelManager.instance = this;
    }

    /**
     * @param {object|null} persistedSignatureKeyPair Ed25519 JWK pair carried over
     *   from the orchestrator config. Reusing it is what lets already-registered
     *   workers keep verifying our events across a restart — see below.
     */
    async initialize(persistedSignatureKeyPair = null) {
        if (this.initialized) return;

        // ECDH key: always fresh. This one carries secrecy, so rotating it per
        // boot is deliberate (forward secrecy) — workers re-derive the shared
        // key from it on every registration anyway.
        this.keyPair = await generateKeyPairECC(this.encryptionAlg);

        // Ed25519 signature key: persistent identity, NOT a secrecy primitive.
        // Regenerating it silently breaks the fleet — every worker still holds
        // the previous public key from its registration handshake and answers
        // orchestrator→worker events with 401 INVALID_SIGNATURE until it
        // re-registers. Reuse the persisted pair whenever the caller has one.
        const reused = Boolean(persistedSignatureKeyPair && persistedSignatureKeyPair.privateKey && persistedSignatureKeyPair.publicKey);
        this.signatureKeyPair = reused ? persistedSignatureKeyPair : generateSignatureKeyPair();

        this.initialized = true;
        logger.info(`TunnelManager initialized (signing key: ${reused ? 'restored from config' : 'newly generated'})`);
    }

    async getPublicKeyForExport() {
        if (!this.keyPair) {
            throw new Error('TunnelManager not initialized');
        }
        return await exportPublicKeyECC(this.keyPair.publicKey);
    }

    getSignaturePublicKey() {
        if (!this.signatureKeyPair) {
            throw new Error('TunnelManager not initialized');
        }
        return this.signatureKeyPair.publicKey;
    }

    async establishTunnel(workerId, workerPublicKeyRaw, workerSignaturePublicKey, isReconnect = false) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            // Import worker's public key
            const workerPublicKey = await importPublicKeyECC(new Uint8Array(workerPublicKeyRaw), this.encryptionAlg);

            // Derive shared secret using ECDH
            const sharedSecret = await deriveSharedSecret(this.keyPair.privateKey, workerPublicKey);

            // Per-session HKDF salt from both public keys (worker bytes first, then
            // orchestrator bytes) — must match the worker's derivation exactly.
            const orchestratorPublicKeyRaw = await exportPublicKeyECC(this.keyPair.publicKey);
            const tunnelSalt = deriveTunnelSalt(new Uint8Array(workerPublicKeyRaw), orchestratorPublicKeyRaw);

            // Derive AES-256 key from shared secret
            const sharedKey = await deriveKey(sharedSecret, tunnelSalt);

            // For reconnecting workers, clear old connection first
            if (isReconnect && this.workerConnections.has(workerId)) {
                logger.info(`Rotating keys for reconnecting worker: ${workerId}`);
                this.workerConnections.delete(workerId);
            }

            // Store the connection (new or updated)
            this.workerConnections.set(workerId, {
                sharedKey: Buffer.from(sharedKey),
                signaturePublicKey: workerSignaturePublicKey,
                establishedAt: getCurrentUnixTime(),
                lastRotation: isReconnect ? getCurrentUnixTime() : null
            });

            // Persist to database (this will update if exists due to workerId being unique)
            await storeEncryptionKey({
                id: generateId('KEY', 16),
                workerId: workerId,
                sharedKey: Buffer.from(sharedKey).toString('base64'),
                signaturePublicKey: workerSignaturePublicKey,
                createdAt: getCurrentUnixTime(),
                isRotation: isReconnect
            });

            const action = isReconnect ? 'Key rotated' : 'Tunnel established';
            logger.info(`${action} with worker: ${workerId}`);
            return true;
        } catch (err) {
            logger.error(`Failed to establish tunnel with worker ${workerId}: ${err.message}`);
            return false;
        }
    }

    async getWorkerConnection(workerId) {
        // Check in-memory first
        if (this.workerConnections.has(workerId)) {
            return this.workerConnections.get(workerId);
        }

        // Try to load from database
        const storedKey = await getEncryptionKeyByWorkerId(workerId);
        if (storedKey) {
            const connection = {
                sharedKey: Buffer.from(storedKey.sharedKey, 'base64'),
                signaturePublicKey: storedKey.signaturePublicKey,
                establishedAt: storedKey.createdAt
            };
            this.workerConnections.set(workerId, connection);
            return connection;
        }

        return null;
    }

    encryptMessage(message, sharedKey) {
        const plaintext = typeof message === 'string' ? message : JSON.stringify(message);
        const encrypted = encrypt(plaintext, sharedKey);

        // Sign the encrypted message
        const signature = generateSignature(encrypted, this.signatureKeyPair.privateKey);

        return {
            payload: encrypted,
            signature: signature,
            timestamp: getCurrentUnixTime()
        };
    }

    decryptMessage(encryptedPayload, signature, sharedKey, senderSignaturePublicKey) {
        // Verify signature
        const isValid = verifySignature(encryptedPayload, signature, senderSignaturePublicKey);
        if (!isValid) {
            throw new Error('Invalid message signature');
        }

        // Decrypt
        const decrypted = decrypt(encryptedPayload, sharedKey);

        try {
            return JSON.parse(decrypted);
        } catch {
            return decrypted;
        }
    }

    async sendToWorker(workerId, event) {
        const connection = await this.getWorkerConnection(workerId);
        if (!connection) {
            throw new Error(`No tunnel established with worker: ${workerId}`);
        }

        const worker = await getWorkerById(workerId);
        if (!worker) {
            throw new Error(`Worker not found: ${workerId}`);
        }

        const encryptedMessage = this.encryptMessage(event, connection.sharedKey);

        // Send to worker's event endpoint
        const workerUrl = `http://${worker.ip}:${worker.port}/${globalAccessPoint.nameSpace()}/api/v1/event`;

        const MAX_RETRIES = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                logger.info(`Sending event "${event.name}" to worker ${workerId} (attempt ${attempt}/${MAX_RETRIES})...`);

                const response = await fetch(workerUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-r_sync-orchestrator-id': this.orchestratorId || 'unknown'
                    },
                    body: JSON.stringify(encryptedMessage)
                });

                if (!response.ok) {
                    throw new Error(`Worker returned HTTP ${response.status}`);
                }

                // Confirmed 200 — event delivered
                logger.info(`Event "${event.name}" confirmed by worker ${workerId} on attempt ${attempt}`);
                return true;
            } catch (err) {
                lastError = err;
                logger.warn(`Attempt ${attempt}/${MAX_RETRIES} failed for worker ${workerId}: ${err.message}`);

                if (attempt < MAX_RETRIES) {
                    // Exponential backoff: 500ms → 1000ms → 2000ms
                    const delayMs = 500 * Math.pow(2, attempt - 1);
                    logger.info(`Retrying worker ${workerId} in ${delayMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        // All retries exhausted — mark worker as faulty
        logger.error(`All ${MAX_RETRIES} attempts failed for worker ${workerId}. Marking as faulty.`);

        try {
            await updateWorker(workerId, {
                status: 'faulty',
                lastFaultAt: getCurrentUnixTime(),
                faultReason: lastError?.message || 'Unknown error'
            });
        } catch (updateErr) {
            logger.error(`Failed to persist faulty status for worker ${workerId}: ${updateErr.message}`);
        }

        // Evict from in-memory tunnel map so stale key is not reused
        this.workerConnections.delete(workerId);

        auditLogger.record({
            actorId: 'ORCHESTRATOR',
            actionType: 'WORKER_MARKED_FAULTY',
            resource: workerId,
            outcome: 'FAILURE',
            severity: 'CRITICAL',
            metadata: {
                eventName: event.name,
                eventId: event.id,
                attempts: MAX_RETRIES,
                lastError: lastError?.message
            }
        });

        return false;
    }

    async broadcastToAll(event) {
        const workers = await getAllWorkers();
        const activeWorkers = workers.filter(w => w.status === 'active');

        if (activeWorkers.length === 0) {
            return [];
        }

        logger.info(`Broadcasting "${event.name}" to ${activeWorkers.length} active workers...`);

        // Log the broadcast initiation
        auditLogger.record({
            actorId: 'ORCHESTRATOR',
            actionType: 'BROADCAST_INITIATED',
            resource: event.name,
            severity: 'INFO',
            metadata: {
                eventId: event.id,
                targetCount: activeWorkers.length
            }
        });

        // Create promises for all active workers
        const broadcastPromises = activeWorkers.map(async worker => {
            try {
                const success = await this.sendToWorker(worker.id, event);

                // Log individual worker interaction
                auditLogger.record({
                    actorId: 'ORCHESTRATOR',
                    actionType: 'BROADCAST_SEND',
                    resource: worker.id,
                    outcome: success ? 'SUCCESS' : 'FAILURE',
                    severity: success ? 'INFO' : 'ERROR',
                    metadata: {
                        eventName: event.name,
                        eventId: event.id
                    }
                });

                return { workerId: worker.id, success };
            } catch (err) {
                // Should be caught inside sendToWorker, but just in case
                auditLogger.record({
                    actorId: 'ORCHESTRATOR',
                    actionType: 'BROADCAST_ERROR',
                    resource: worker.id,
                    outcome: 'FAILURE',
                    severity: 'ERROR',
                    metadata: {
                        eventName: event.name,
                        eventId: event.id,
                        error: err.message
                    }
                });
                return { workerId: worker.id, success: false, error: err.message };
            }
        });

        // Execute all promises in parallel and wait for all to settle
        const settledResults = await Promise.allSettled(broadcastPromises);

        // Map results back to the expected format
        const results = settledResults.map(result => {
            if (result.status === 'fulfilled') {
                return result.value;
            } else {
                // This branch shouldn't ideally be reached if promises catch their own errors
                return { success: false, error: result.reason || 'Unknown error' };
            }
        });

        const successCount = results.filter(r => r.success).length;
        logger.info(`Broadcast complete: ${successCount}/${activeWorkers.length} workers successfully reached`);

        return results;
    }

    removeTunnel(workerId) {
        this.workerConnections.delete(workerId);
        logger.info(`Tunnel removed for worker: ${workerId}`);
    }

    setOrchestratorId(id) {
        this.orchestratorId = id;
    }
}

// Singleton factory
const getTunnelManager = encryptionAlg => {
    if (!TunnelManager.instance) {
        new TunnelManager(encryptionAlg);
    }
    return TunnelManager.instance;
};

export { TunnelManager, getTunnelManager };
