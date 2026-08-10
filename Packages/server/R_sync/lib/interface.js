import { PERSISTANT_ORCHESTRATOR_CONFIG_FILE, PERSISTANT_WORKER_CONFIG_FILE } from './r_sync.meta.js';
import {
    generateKeyPairECC,
    exportPublicKeyECC,
    importPublicKeyECC,
    deriveSharedSecret,
    deriveKey,
    deriveTunnelSalt,
    generateSignatureKeyPair,
    generateSignature,
    sha256Hash,
    encrypt
} from './utils/crypto.js';
import { getCurrentUnixTime } from './utils/Date&Time.js';
import { readFromCaller, writeToCaller } from './utils/fileHandler.js';
import { globalAccessPoint } from './utils/globalAccessPoint.js';
import { generateId, generateRandomNumber } from './utils/valueGenerators.js';
import { logger } from './utils/logger.js';
import { createServer, startServer } from './core/server.js';
import { orchestratorRoutes } from './core/routes/orchestratorRoutes.js';
import { workerRoutes } from './core/routes/workerRoutes.js';
import { etsRoutes } from './core/routes/etsRoutes.js';
import { getTunnelManager } from './core/TunnelManager.js';
import { waitForDb } from './utils/lokidb.js';
import { registerEventHandler, setTunnelState, getTunnelState, setReregisterHandler } from './core/controllers/workerController.js';
import { registerOrchestratorEventHandler } from './core/controllers/orchestratorController.js';
import { validateConfig, OrchestratorConfigSchema, WorkerConfigSchema } from './utils/configSchemas.js';
import { signRequest } from './utils/httpSignature.js';

class R_Sync {
    static #ROLES = Object.freeze(['ORCHESTRATOR', 'WORKER']);
    static #ENCRYPTION_ALGS = Object.freeze(['ECC_256', 'ECC_384', 'ECC_521']);
    static instance = null;
    static systemInitialized = false;

    constructor(config) {
        if (R_Sync.instance) {
            throw new Error('There can only be one instance of R_Sync');
        }

        if (!config || typeof config !== 'object') {
            throw new Error('Configuration error: config object is required');
        }

        if (!config.role) {
            throw new Error('Configuration error: no role provided');
        }

        if (!R_Sync.#ROLES.includes(config.role.trim().toUpperCase())) {
            throw new Error('Configuration error: invalid role');
        }

        this.role = config.role.trim().toUpperCase();
        this.server = null;
        this.app = null;
        this.heartbeatInterval = null;

        if (this.role === R_Sync.#ROLES[0]) {
            // ORCHESTRATOR config
            const validated = validateConfig(config, OrchestratorConfigSchema);
            this.publicIp = validated.publicIp;
            this.port = validated.port;
            this.encryptionAlg = validated.encryptionAlg;
            this.cluster = validated.cluster;
            this.trustAdvertisedWorkerIp = validated.trustAdvertisedWorkerIp === true;
            this.acceptLegacySignatures = validated.acceptLegacySignatures === true;
        }

        if (this.role === R_Sync.#ROLES[1]) {
            // WORKER config
            const validated = validateConfig(config, WorkerConfigSchema);
            this.publicIp = validated.publicIp;
            this.orchestratorIp = validated.orchestratorIp;
            this.orchestratorPort = validated.orchestratorPort;
            this.port = validated.port;
            this.encryptionAlg = validated.encryptionAlg;
            this.heartbeatIntervalMs = validated.heartbeatIntervalMs;
            this.cluster = validated.cluster;
            this.exitOnBootFailure = validated.exitOnBootFailure !== false;
        }

        // Register the singleton only after the config has fully validated, so a
        // failed construction never poisons the slot for a subsequent retry.
        R_Sync.instance = this;
    }

    getRole() {
        return this.role;
    }

    getSupportedEncryptionAlgorithms() {
        return structuredClone(R_Sync.#ENCRYPTION_ALGS);
    }

    /**
     * Start the orchestrator server
     */
    async startOrchestrator() {
        if (this.role !== 'ORCHESTRATOR') {
            throw new Error('Cannot start orchestrator: role is not ORCHESTRATOR');
        }

        // Wait for database
        await waitForDb();

        // Load or create orchestrator config
        let existingConfig = await readFromCaller(PERSISTANT_ORCHESTRATOR_CONFIG_FILE);

        if (existingConfig.error && existingConfig.errorCode !== 'FILE-NOT-FOUND') {
            throw new Error('Boot error: ' + existingConfig.errorCode);
        }

        const config = existingConfig.data || {};

        if (!config.orchestratorId) {
            config.orchestratorId = generateId('ORCHESTRATOR', 36);
            config.publicIp = this.publicIp;
            config.port = this.port;
            config.createdAt = getCurrentUnixTime();
        }

        // Persistent signing identity — the mirror of the worker's identityKeyPair
        // below. The orchestratorId already survives restarts, so a worker keeps
        // talking to "the same" orchestrator; if the signing key changed underneath
        // it, every event we send is rejected with INVALID_SIGNATURE until that
        // worker re-registers. Created once, then reused for the box's lifetime.
        if (!config.signatureKeyPair || !config.signatureKeyPair.privateKey) {
            config.signatureKeyPair = generateSignatureKeyPair();
        }

        config.lastBoot = getCurrentUnixTime();
        await writeToCaller(PERSISTANT_ORCHESTRATOR_CONFIG_FILE, config);

        this.orchestratorId = config.orchestratorId;

        // Initialize tunnel manager
        const tunnelManager = getTunnelManager(`P-${this.encryptionAlg.split('_')[1]}`);
        await tunnelManager.initialize(config.signatureKeyPair);
        tunnelManager.setOrchestratorId(this.orchestratorId);

        // Store cluster name for validation
        globalAccessPoint.setValue('cluster', this.cluster);
        globalAccessPoint.setValue('trustAdvertisedWorkerIp', this.trustAdvertisedWorkerIp === true);

        // Workers sign with RFC 9421 HTTP Message Signatures. The proprietary
        // header scheme that preceded it is refused by default; enable this only
        // for the duration of a rolling upgrade, while some workers still run the
        // old build, and turn it off once the fleet has caught up.
        //
        // Both schemes use the same Ed25519 identity key, so accepting the old
        // one is not a cryptographic downgrade — it is an interoperability
        // window, and leaving it open indefinitely just keeps a second format
        // alive with no one speaking it.
        const acceptLegacy = this.acceptLegacySignatures === true;
        globalAccessPoint.setValue('R_SYNC_ACCEPT_LEGACY_SIGNATURES', acceptLegacy);

        if (acceptLegacy) {
            logger.warn('R_sync: legacy (pre-RFC 9421) worker signatures are being accepted — disable acceptLegacySignatures once every worker is upgraded.');
        }

        // Create and configure server
        this.app = createServer();

        // Mount orchestrator routes
        this.app.use(`/${globalAccessPoint.nameSpace()}/api/v1`, orchestratorRoutes);

        // Mount ETS admin routes (localhost-only; intentionally outside lockdown enforcement)
        this.app.use(`/${globalAccessPoint.nameSpace()}/api/v1/ets`, etsRoutes);

        // Start server
        this.server = await startServer(this.app, this.port, 'ORCHESTRATOR');

        R_Sync.systemInitialized = true;
        logger.info(`Orchestrator ${this.orchestratorId} is ready`);

        return this;
    }

    /**
     * Start the worker and register with orchestrator
     */
    async startWorker() {
        if (this.role !== 'WORKER') {
            throw new Error('Cannot start worker: role is not WORKER');
        }

        // Wait for database
        await waitForDb();

        // Load or create worker config
        let existingConfig = await readFromCaller(PERSISTANT_WORKER_CONFIG_FILE);

        if (existingConfig.error && existingConfig.errorCode !== 'FILE-NOT-FOUND') {
            throw new Error('Boot error: ' + existingConfig.errorCode);
        }

        const config = existingConfig.data || {};

        await this.#registerWithOrchestrator(config, { isBoot: true });

        // Create and configure server to receive events
        this.app = createServer();
        this.app.use(`/${globalAccessPoint.nameSpace()}/api/v1`, workerRoutes);
        this.server = await startServer(this.app, this.port, 'WORKER');

        // Let the inbound event path rebuild this tunnel by itself if our copy of
        // the orchestrator's signing key ever goes stale (see workerController).
        setReregisterHandler(reason => this.#reregister(reason));

        // Start heartbeat
        this.#startHeartbeat();

        R_Sync.systemInitialized = true;
        logger.info(`Worker ${this.workerId} registered and listening`);

        return this;
    }

    /**
     * Re-run the registration handshake on a worker that is already serving.
     * Refreshes our session keys AND our copy of the orchestrator's signing key,
     * which is the whole point: an orchestrator that came back with a different
     * key is otherwise unable to reach us ever again. The HTTP server, heartbeat
     * and worker id all survive — the persistent identity key is what proves to
     * the orchestrator that this is the same worker reconnecting.
     */
    async #reregister(reason = 'manual') {
        const existingConfig = await readFromCaller(PERSISTANT_WORKER_CONFIG_FILE);

        if (existingConfig.error && existingConfig.errorCode !== 'FILE-NOT-FOUND') {
            throw new Error(`Cannot re-register: worker config unreadable (${existingConfig.errorCode})`);
        }

        const config = existingConfig.data || {};
        logger.info(`Re-registering with orchestrator (trigger: ${reason})`);

        await this.#registerWithOrchestrator(config, { isBoot: false });
        return this;
    }

    /**
     * The registration handshake itself, shared by boot and re-registration.
     *
     * @param {object} config Worker config; mutated in place then persisted.
     * @param {{isBoot: boolean}} opts On boot, an unreachable or rejecting
     *   orchestrator may crash the process (`exitOnBootFailure`) because a worker
     *   cannot operate without one. On a live re-registration it never exits — the
     *   worker is already serving traffic, and a transient orchestrator outage
     *   must not take it down; the caller just sees the throw.
     */
    async #registerWithOrchestrator(config, { isBoot }) {
        const failHard = isBoot && this.exitOnBootFailure;

        // Check if we have an existing worker ID (for restarts)
        const existingWorkerId = config.workerId || null;
        const isReconnect = existingWorkerId !== null;

        if (isReconnect) {
            logger.info(`Reconnecting with existing worker ID: ${existingWorkerId}`);
        }

        // Persistent identity key pair — created once and reused across restarts.
        // This is what proves, on every reconnect, that we are the SAME worker that
        // originally registered. The session encryption/signature keys below still
        // rotate on every boot for forward secrecy; the identity key does not.
        if (!config.identityKeyPair || !config.identityKeyPair.privateKey) {
            config.identityKeyPair = generateSignatureKeyPair();
        }
        const identityKeyPair = config.identityKeyPair;

        // Generate new encryption and signature keys (always fresh for security)
        const encryptionKeyPair = await generateKeyPairECC(`P-${this.encryptionAlg.split('_')[1]}`);
        const signatureKeyPair = generateSignatureKeyPair();
        const exportedPublicKey = await exportPublicKeyECC(encryptionKeyPair.publicKey);

        // Register with orchestrator
        const ORCHESTRATOR_BASE_URL = `http://${this.orchestratorIp}:${this.orchestratorPort}`;
        const ORCHESTRATOR_DISCOVERY_API = `${ORCHESTRATOR_BASE_URL}/${globalAccessPoint.nameSpace()}/api/v1/discover-me`;

        logger.info(`Registering with orchestrator at ${ORCHESTRATOR_BASE_URL}...`);

        const timestamp = getCurrentUnixTime();
        const nonce = generateRandomNumber(36);
        const encryptionPublicKeyArray = Array.from(exportedPublicKey);
        // Bind the registration to a fresh nonce (replay defense) and to the actual
        // encryption key being offered (so the signed request cannot be replayed
        // with swapped key material). Signed with the PERSISTENT identity key.
        const encKeyDigest = sha256Hash(JSON.stringify(encryptionPublicKeyArray));
        const signaturePayload = `${timestamp}:${existingWorkerId || ''}:${nonce}:${encKeyDigest}`;
        const signature = generateSignature(signaturePayload, identityKeyPair.privateKey);

        let response;
        try {
            response = await fetch(ORCHESTRATOR_DISCOVERY_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-r_sync-ip': this.publicIp,
                    'x-r_sync-port': this.port.toString(),
                    'x-r_sync-timestamp': timestamp.toString(),
                    'x-r_sync-nonce': nonce,
                    'x-r_sync-rand': generateRandomNumber(36),
                    'x-r_sync-cluster': this.cluster,
                    'x-r_sync-worker-id': existingWorkerId || '',
                    'x-r_sync-signature': signature
                },
                body: JSON.stringify({
                    signaturePublicKey: signatureKeyPair.publicKey,
                    identityPublicKey: identityKeyPair.publicKey,
                    encryptionPublicKey: encryptionPublicKeyArray,
                    cluster: this.cluster,
                    existingWorkerId: existingWorkerId
                })
            });
        } catch (err) {
            logger.error(`Worker registration: could not reach orchestrator at ${ORCHESTRATOR_BASE_URL} — ${err.message}`);
            if (failHard) {
                logger.error(`A worker cannot operate without an orchestrator. Crashing process.`);
                process.exit(1);
            }
            // Embedded-worker semantics: hand the failure back to the host so it can
            // retry registration without losing its own process.
            throw new Error(`Worker registration failed: orchestrator unreachable at ${ORCHESTRATOR_BASE_URL} — ${err.message}`);
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            logger.error(`Worker registration: orchestrator rejected us — ${errorData.message || response.statusText} (HTTP ${response.status})`);
            if (failHard) {
                logger.error(`A worker cannot operate without an orchestrator. Crashing process.`);
                process.exit(1);
            }
            throw new Error(`Worker registration rejected: ${errorData.message || response.statusText} (HTTP ${response.status})`);
        }

        const data = await response.json();

        this.workerId = data.workerId;
        config.workerId = data.workerId;
        config.lastRegistration = getCurrentUnixTime();

        // Import orchestrator's public key and derive shared secret
        const orchestratorPublicKey = await importPublicKeyECC(new Uint8Array(data.orchestratorEncryptionPublicKey), `P-${this.encryptionAlg.split('_')[1]}`);

        const sharedSecret = await deriveSharedSecret(encryptionKeyPair.privateKey, orchestratorPublicKey);

        // Per-session HKDF salt derived from both public keys (identical formula on
        // the orchestrator side) — replaces the fixed constant salt.
        const tunnelSalt = deriveTunnelSalt(exportedPublicKey, new Uint8Array(data.orchestratorEncryptionPublicKey));
        const sharedKey = await deriveKey(sharedSecret, tunnelSalt);

        // Store tunnel state
        setTunnelState({
            orchestratorId: data.orchestratorId,
            sharedKey: Buffer.from(sharedKey),
            orchestratorSignaturePublicKey: data.orchestratorSignaturePublicKey,
            mySignatureKeyPair: signatureKeyPair
        });

        await writeToCaller(PERSISTANT_WORKER_CONFIG_FILE, config);

        // NB: the discover-me response carries no orchestratorId, so don't report
        // one here — `reconnected` is the field that actually distinguishes a
        // fresh registration from a re-handshake.
        logger.info(`Registered with orchestrator as ${this.workerId}${data.reconnected ? ' (reconnected)' : ''}`);

        return data;
    }

    /**
     * Broadcast an event to all workers (orchestrator only)
     */
    async broadcast(eventName, data = {}) {
        if (this.role !== 'ORCHESTRATOR') {
            throw new Error('Only orchestrator can broadcast events');
        }

        if (!R_Sync.systemInitialized) {
            throw new Error('System not initialized. Call startOrchestrator() first');
        }

        const tunnelManager = getTunnelManager();
        const event = {
            id: generateId('EVENT', 16),
            name: eventName,
            data: data,
            timestamp: getCurrentUnixTime()
        };

        const results = await tunnelManager.broadcastToAll(event);
        return results;
    }

    /**
     * Register an event handler (worker only)
     */
    onEvent(callback) {
        if (this.role !== 'WORKER') {
            throw new Error('Only workers can register event handlers');
        }

        if (typeof callback !== 'function') {
            throw new Error('Event handler must be a function');
        }

        registerEventHandler(callback);
        return this;
    }

    /**
     * Register an event handler for worker → orchestrator events (orchestrator only)
     */
    onWorkerEvent(callback) {
        if (this.role !== 'ORCHESTRATOR') {
            throw new Error('Only orchestrator can register worker event handlers');
        }

        if (typeof callback !== 'function') {
            throw new Error('Event handler must be a function');
        }

        registerOrchestratorEventHandler(callback);
        return this;
    }

    /**
     * Send an event to the orchestrator (worker only)
     */
    async emitToOrchestrator(eventName, data = {}) {
        if (this.role !== 'WORKER') {
            throw new Error('Only workers can emit events to orchestrator');
        }

        if (!R_Sync.systemInitialized) {
            throw new Error('System not initialized. Call startWorker() first');
        }

        const tunnelState = getTunnelState();
        if (!tunnelState.sharedKey || !tunnelState.mySignatureKeyPair) {
            throw new Error('Not registered with orchestrator');
        }

        const event = {
            id: generateId('EVENT', 16),
            name: eventName,
            data: data,
            timestamp: getCurrentUnixTime()
        };

        // Encrypt once — the ciphertext is stable and reused across all retry attempts
        const plaintext = JSON.stringify(event);
        const encrypted = encrypt(plaintext, tunnelState.sharedKey);

        // Sign the encrypted payload once — stable across retries
        const payloadSignature = generateSignature(encrypted, tunnelState.mySignatureKeyPair.privateKey);

        const ORCHESTRATOR_BASE_URL = `http://${this.orchestratorIp}:${this.orchestratorPort}`;
        const EVENT_URL = `${ORCHESTRATOR_BASE_URL}/${globalAccessPoint.nameSpace()}/api/v1/worker-event`;

        const MAX_RETRIES = 3;
        let lastError = null;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Regenerate auth headers on every attempt — each needs a fresh timestamp
                // and a unique nonce to pass the replay-attack guard on the orchestrator.
                const timestamp = getCurrentUnixTime();
                const nonce = generateRandomNumber(36);

                // The auth signature covers this exact request — method, path and
                // body digest included — so it cannot be lifted onto a different
                // request. Body must match what is sent below, byte for byte.
                const requestBody = { payload: encrypted, signature: payloadSignature, timestamp: timestamp };

                // RFC 9421 HTTP Message Signatures. `@target-uri` binds the
                // signature to this exact host, port and path, and the RFC 9530
                // Content-Digest binds it to this exact body.
                const httpSig = signRequest({
                    method: 'POST',
                    url: EVENT_URL,
                    body: requestBody,
                    workerId: this.workerId,
                    privateJwk: tunnelState.mySignatureKeyPair.privateKey,
                    nonce,
                    created: timestamp
                });

                logger.info(`Emitting "${eventName}" to orchestrator (attempt ${attempt}/${MAX_RETRIES})...`);

                const response = await fetch(EVENT_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-r_sync-worker-id': this.workerId,
                        'x-r_sync-cluster': this.cluster,
                        'Content-Digest': httpSig.contentDigest,
                        'Signature-Input': httpSig.signatureInput,
                        Signature: httpSig.signature
                    },
                    // Same object the signature was computed over.
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(`Orchestrator returned HTTP ${response.status}: ${errorData.message || response.statusText}`);
                }

                // Confirmed 200 — event acknowledged by orchestrator
                const result = await response.json();
                logger.info(`Event "${eventName}" confirmed by orchestrator on attempt ${attempt} (${result.eventId})`);
                return result;
            } catch (err) {
                lastError = err;
                logger.warn(`Attempt ${attempt}/${MAX_RETRIES} failed to emit "${eventName}" to orchestrator: ${err.message}`);

                if (attempt < MAX_RETRIES) {
                    // Exponential backoff: 500ms → 1000ms → 2000ms
                    const delayMs = 500 * Math.pow(2, attempt - 1);
                    logger.info(`Retrying orchestrator emit in ${delayMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
        }

        logger.error(`All ${MAX_RETRIES} attempts to emit "${eventName}" to orchestrator failed.`);
        throw lastError;
    }

    /**
     * Send an event to a specific worker by ID (orchestrator only)
     */
    async sendTo(workerId, eventName, data = {}) {
        if (this.role !== 'ORCHESTRATOR') {
            throw new Error('Only orchestrator can send events to specific workers');
        }

        if (!R_Sync.systemInitialized) {
            throw new Error('System not initialized. Call startOrchestrator() first');
        }

        const tunnelManager = getTunnelManager();
        const event = {
            id: generateId('EVENT', 16),
            name: eventName,
            data: data,
            timestamp: getCurrentUnixTime()
        };

        const success = await tunnelManager.sendToWorker(workerId, event);
        if (!success) {
            throw new Error(`Failed to send event to worker ${workerId}`);
        }

        logger.info(`Event "${eventName}" sent to worker ${workerId}`);
        return { eventId: event.id, workerId, success: true };
    }

    /**
     * Start heartbeat interval (worker)
     */
    #startHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        const ORCHESTRATOR_BASE_URL = `http://${this.orchestratorIp}:${this.orchestratorPort}`;
        const HEARTBEAT_URL = `${ORCHESTRATOR_BASE_URL}/${globalAccessPoint.nameSpace()}/api/v1/heartbeat`;

        this.heartbeatInterval = setInterval(async () => {
            try {
                const timestamp = getCurrentUnixTime();
                const tunnelState = getTunnelState();

                if (!tunnelState.mySignatureKeyPair) {
                    logger.warn('Heartbeat skipped: No signature key pair available');
                    return;
                }

                const nonce = generateRandomNumber(36);

                // Heartbeat sends no body; both sides canonicalize that to `{}`
                // inside contentDigest, so the digests agree.
                const httpSig = signRequest({
                    method: 'POST',
                    url: HEARTBEAT_URL,
                    body: {},
                    workerId: this.workerId,
                    privateJwk: tunnelState.mySignatureKeyPair.privateKey,
                    nonce,
                    created: timestamp
                });

                const response = await fetch(HEARTBEAT_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-r_sync-worker-id': this.workerId,
                        'x-r_sync-cluster': this.cluster,
                        'Content-Digest': httpSig.contentDigest,
                        'Signature-Input': httpSig.signatureInput,
                        Signature: httpSig.signature
                    }
                });

                if (!response.ok) {
                    logger.warn('Heartbeat failed: ' + response.statusText);
                }
            } catch (err) {
                logger.warn('Heartbeat error: ' + err.message);
            }
        }, this.heartbeatIntervalMs);

        logger.info(`Heartbeat started (interval: ${this.heartbeatIntervalMs}ms)`);
    }

    /**
     * Stop the system
     */
    async stop() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        if (this.server) {
            await new Promise(resolve => {
                this.server.close(resolve);
            });
            this.server = null;
        }

        R_Sync.systemInitialized = false;
        // Release the singleton so a fresh instance can be constructed in-process
        // (e.g. tests, or a supervised restart) after a clean stop.
        if (R_Sync.instance === this) {
            R_Sync.instance = null;
        }
        logger.info(`R_Sync ${this.role} stopped`);
    }

    /**
     * Get singleton instance
     */
    static getInstance() {
        return R_Sync.instance;
    }
}

export { R_Sync };
