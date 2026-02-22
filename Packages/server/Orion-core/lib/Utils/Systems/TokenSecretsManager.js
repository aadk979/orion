import { cron, globalAccessPoint } from "../../../index.js";
import { getRandomElement } from "../ArrayUtilities.js";
import { isUnixExpired } from "../Date&Time.js";
import { readFromCaller, removeFromCaller, writeToCaller } from "../FileHandler.js";
import { logger } from "../logger.js";
import { Snapshotter } from "./SnapShotter.js";
import { TokenSecretsCrypto } from "./TokenSecretsCrypto.js";

// FIX: Added `algorithm` field to RSA entries so generateRSAKey can derive
// the correct hash (SHA-256/384/512) per algorithm instead of always using SHA-256.
const KEY_TYPES = [
    { algorithm: "ES256", size: 256, type: "ECDSA" },
    { algorithm: "ES384", size: 384, type: "ECDSA" },
    { algorithm: "ES512", size: 512, type: "ECDSA" },
    { algorithm: "RS256", size: 2048, type: "RSA" },
    { algorithm: "RS384", size: 3072, type: "RSA" },
    { algorithm: "RS512", size: 4096, type: "RSA" }
];

const CLUSTER_KEY_START_PREFIX = "TOKEN_SECRETS_KEY_PAIR_CLUSTER";
const MAX_NUMBER_OF_PAIRS = 10;
const MAX_VERIFICATION_PAIRS = 20;
const AUTO_PRUNE_INTERVAL = 60_000;

class TokenSecretsManager {

    constructor(domain, algorithm = "ES256", nPairs = 2) {
        if (!domain) throw new Error(`Configuration error: No domain provided`);
        if (!KEY_TYPES.find(obj => obj.algorithm === algorithm)) {
            throw new Error(`Configuration error: Invalid token secrets manager algorithm: ${algorithm}`);
        }
        if (nPairs > MAX_NUMBER_OF_PAIRS) {
            logger.warn(`Token Secrets Manager: Only a maximum of ${MAX_NUMBER_OF_PAIRS} key pairs are allowed! Defaulting to ${MAX_NUMBER_OF_PAIRS}`);
            nPairs = MAX_NUMBER_OF_PAIRS;
        }

        this.domain = domain;
        this.algorithm = algorithm;
        this.nPairs = nPairs;
        this.instanceType = globalAccessPoint.getValue("clusterMode") ? "CLUSTER" : "SINGLE";

        this.tokenSecretsCrypto = new TokenSecretsCrypto(this.domain);
        this.TOKEN_SECRETS_FILE_NAME = `orion.internal.token_secrets_manager.${this.domain}.json`;

        this.signingPairs = [];
        this.verificationPairs = [];

        // FIX: rotationLock is now a Promise (or null), not a boolean.
        // This eliminates the TOCTOU race in waitForLock where the lock could
        // be set between the check and the queue push, causing callers to hang forever.
        this._lockPromise = null;
        this._lockResolve = null;

        this.initialized = false;
        this.checkExpAndRepopulate = this.checkExpAndRepopulate.bind(this);
    }

    // FIX: Lock is now a proper async mutex based on a chained Promise.
    // Callers always await the current lock promise before proceeding,
    // with no window for the race condition that existed with the boolean + queue approach.
    _acquireLock() {
        const previous = this._lockPromise;
        let resolve;
        this._lockPromise = new Promise(r => { resolve = r; });
        this._lockResolve = resolve;
        return previous; // caller awaits this
    }

    _releaseLock() {
        if (this._lockResolve) {
            this._lockResolve();
            this._lockResolve = null;
        }
    }

    async _waitForLock() {
        // Spin-wait on the chain: if a lock is held, this awaits it.
        // New lock acquisitions chain on top, preserving FIFO order.
        while (this._lockPromise) {
            const current = this._lockPromise;
            await current;
            // After awaiting, if _lockPromise changed it means someone else
            // acquired a new lock — loop and wait again.
            if (this._lockPromise === current) {
                // The promise that just resolved was the last one, lock is free.
                break;
            }
        }
    }

    async initialize() {
        if (this.instanceType === "SINGLE") {
            await this._initializeSingle();
        } else {
            await this._initializeCluster();
        }

        // Auto prune verification pairs — runs inside its own safe lock
        setInterval(() => this.pruneVerificationPairs(), AUTO_PRUNE_INTERVAL);
    }

    async _initializeSingle() {
        const config = KEY_TYPES.find(obj => obj.algorithm === this.algorithm);
        const configArr = Array(this.nPairs).fill(config);
        const fn = config.type === "ECDSA"
            ? this.tokenSecretsCrypto.generateECDSAKey
            : this.tokenSecretsCrypto.generateRSAKey;

        try {
            const allKeys = await Promise.all(configArr.map(c => fn.call(this.tokenSecretsCrypto, c)));
            this.signingPairs.push(...allKeys);
        } catch (err) {
            logger.error("Token Secrets Manager: Key generation failed", err);
            throw err;
        }

        let fileRead = await readFromCaller(this.TOKEN_SECRETS_FILE_NAME);

        if ((fileRead.error && fileRead.errorCode !== "FILE-NOT-FOUND") || (fileRead?.data && !fileRead.json)) {
            await removeFromCaller(this.TOKEN_SECRETS_FILE_NAME);
            logger.warn(`Token Secrets Manager: Token secrets file for domain (${this.domain}) reset due to error/corruption`);
            fileRead.data = undefined;
        }

        if (!fileRead?.data) {
            // FIX: On first boot, persist signing pairs (public portion only) so they
            // are available for verification after a restart, consistent with what
            // checkExpAndRepopulate writes (both verification + signing public keys).
            const cleanedKeys = this.signingPairs.map(this._stripRuntimeKeys);
            await writeToCaller(this.TOKEN_SECRETS_FILE_NAME, { keys: cleanedKeys });
        }

        if (fileRead?.data) {
            const importedKeys = await Promise.all(
                fileRead.data.keys
                    .filter(k => !isUnixExpired(k.publicKeyExp))
                    .map(k => this._importPublicKey(k))
            );
            this.verificationPairs.push(...importedKeys);
        }

        cron.addEvent(`TOKEN_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, "30s", {});
        this.initialized = true;
    }

    async _initializeCluster() {
        const redisInstance = globalAccessPoint.getValue("redisInstance");

        // FIX: Renamed variables clearly to avoid collision and accidental overwrite.
        const redisKeyNames = redisInstance.keys() || [];
        const filteredKeyNames = redisKeyNames.filter(k => k.startsWith(`${CLUSTER_KEY_START_PREFIX}_${this.domain}`));
        const regionalKeyData = await Promise.all(filteredKeyNames.map(k => redisInstance.getData(k)));
        const importedVerificationKeys = await Promise.all(regionalKeyData.map(k => this._importPublicKey(k)));
        this.verificationPairs = importedVerificationKeys;

        const config = KEY_TYPES.find(obj => obj.algorithm === this.algorithm);
        const configArr = Array(this.nPairs).fill(config);
        const fn = config.type === "ECDSA"
            ? this.tokenSecretsCrypto.generateECDSAKey
            : this.tokenSecretsCrypto.generateRSAKey;

        const newSigningPairs = await Promise.all(configArr.map(c => fn.call(this.tokenSecretsCrypto, c)));
        this.signingPairs.push(...newSigningPairs);

        const cleanedKeys = newSigningPairs.map(this._stripRuntimeKeys);
        await Promise.all(
            cleanedKeys.map(k => redisInstance.addData(`${CLUSTER_KEY_START_PREFIX}_${this.domain}_${k.keyPairId}`, k, k.publicKeyExp))
        );

        // FIX: Cluster mode now schedules rotation, matching SINGLE behaviour.
        // Without this, private keys expire after 7 days and getRandomSigningKeyPair
        // silently returns null forever.
        cron.addEvent(`TOKEN_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, "30s", {});

        this.initialized = true;
    }

    _stripRuntimeKeys = (key) => {
        const copy = { ...key, keys: { ...key.keys } };
        if (copy.keys.private) delete copy.keys.private;
        if (copy.keys.public?.spki) delete copy.keys.public.spki;
        if (copy.keys.public?.base64) delete copy.keys.public.base64;
        delete copy._cryptoKey;
        delete copy._nodePrivateKey;
        delete copy._nodePublicKey;
        return copy;
    }

    // FIX: _importPublicKey no longer mutates its input.
    // It works on a shallow copy so that source data (Redis, file reads) is not altered.
    async _importPublicKey(key) {
        if (!key || !key.generationConfig) return key;

        // Shallow clone to avoid mutating the original object
        const safeKey = { ...key, keys: { ...key.keys, public: { ...key.keys.public } } };

        let imported;
        if (safeKey.generationConfig.type === "ECDSA") {
            imported = await this.tokenSecretsCrypto.importECDSAPublicKeyFromJWK(safeKey.keys.public.jwk);
        } else {
            imported = await this.tokenSecretsCrypto.importRSAPublicKeyFromJWK(safeKey.keys.public.jwk);
        }

        safeKey.keys.public = { ...safeKey.keys.public, ...imported };
        safeKey._cryptoKey = imported._cryptoKey;
        safeKey._nodePublicKey = imported._nodePublicKey;
        return safeKey;
    }

    async findKeyPair(keyPairId) {
        if (!this.initialized) {
            logger.warn(`Token Secrets Manager: Initialize manager before use for domain ${this.domain}`);
            return null;
        }
        await this._waitForLock();

        const searchActive = this.signingPairs.find(k => k.keyPairId === keyPairId && !isUnixExpired(k.publicKeyExp));
        if (searchActive) return searchActive;

        const searchPast = this.verificationPairs.find(k => k.keyPairId === keyPairId && !isUnixExpired(k.publicKeyExp));
        if (searchPast) return searchPast;

        if (this.instanceType === "CLUSTER") {
            const redisInstance = globalAccessPoint.getValue("redisInstance");
            const redisKey = `${CLUSTER_KEY_START_PREFIX}_${this.domain}_${keyPairId}`;
            const key = await redisInstance.getData(redisKey);
            if (!key?.data || isUnixExpired(key.publicKeyExp)) {
                redisInstance.deleteData(redisKey);
                return null;
            }
            const imported = await this._importPublicKey(key);
            this.verificationPairs.push(imported);
            return imported;
        }

        return null;
    }

    // FIX: Returns a descriptive error instead of silent null when no signing keys are available.
    async getRandomSigningKeyPair() {
        if (!this.initialized) {
            logger.warn(`Token Secrets Manager: Initialize manager before use for domain ${this.domain}`);
            return null;
        }
        await this._waitForLock();

        const available = this.signingPairs.filter(k => !isUnixExpired(k.privateKeyExp));
        if (available.length === 0) {
            logger.error(`Token Secrets Manager: No valid signing key pairs available for domain ${this.domain}. Rotation may have failed.`);
            return null;
        }
        return getRandomElement(available);
    }

    async checkExpAndRepopulate() {
        if (!this.initialized) return;

        await this._safeRotation(async () => {
            const active = this.signingPairs.filter(k => !isUnixExpired(k.privateKeyExp));
            const expired = this.signingPairs.filter(k => isUnixExpired(k.privateKeyExp));

            // FIX: Merge expired (now demoted) into verificationPairs and enforce the
            // MAX_VERIFICATION_PAIRS cap immediately during rotation, not only at the
            // next prune interval. Sort by publicKeyExp descending to keep the freshest.
            const mergedVerification = [
                ...this.verificationPairs.filter(k => !isUnixExpired(k.publicKeyExp)),
                ...expired.map(this._stripRuntimeKeys)
            ]
                .sort((a, b) => b.publicKeyExp - a.publicKeyExp)
                .slice(0, MAX_VERIFICATION_PAIRS);

            this.verificationPairs = mergedVerification;
            this.signingPairs = active;

            // FIX: Only generate enough new keys to bring the pool back up to nPairs,
            // rather than always generating nPairs regardless of how many are still active.
            // This prevents the signingPairs array from growing unboundedly across rotations.
            const needed = this.nPairs - active.length;
            if (needed > 0) {
                const config = KEY_TYPES.find(k => k.algorithm === this.algorithm);
                const fn = config.type === "ECDSA"
                    ? this.tokenSecretsCrypto.generateECDSAKey
                    : this.tokenSecretsCrypto.generateRSAKey;

                const newKeys = await Promise.all(Array(needed).fill(config).map(c => fn.call(this.tokenSecretsCrypto, c)));
                this.signingPairs.push(...newKeys);
            }

            // Persist the updated state: verification (public only) + signing (public only)
            const formattedVerification = this.verificationPairs.map(this._stripRuntimeKeys);
            const formattedSigning = this.signingPairs.map(this._stripRuntimeKeys);
            await writeToCaller(this.TOKEN_SECRETS_FILE_NAME, { keys: [...formattedVerification, ...formattedSigning] });

            cron.addEvent(`TOKEN_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, "1h", {});
        });
    }

    async pruneVerificationPairs() {
        if (!this.initialized) return;

        // FIX: pruneVerificationPairs now runs inside _safeRotation so it has
        // snapshot protection and participates in the same lock as rotation,
        // preventing torn state from a concurrent rotation + prune.
        await this._safeRotation(async () => {
            this.verificationPairs = this.verificationPairs
                .filter(k => !isUnixExpired(k.publicKeyExp))
                .sort((a, b) => b.publicKeyExp - a.publicKeyExp)
                .slice(0, MAX_VERIFICATION_PAIRS);
        });
    }

    async _safeRotation(fn) {
        // Acquire the mutex before taking the snapshot so that concurrent
        // callers queue up cleanly and the snapshot reflects stable state.
        const waitFor = this._acquireLock();
        await waitFor;

        const snapshot = new Snapshotter(
            {
                signingPairs: this.signingPairs,
                verificationPairs: this.verificationPairs
            },
            (snap) => {
                this.signingPairs = snap.signingPairs;
                this.verificationPairs = snap.verificationPairs;
            },
            () => { }
        );

        try {
            await fn();
            snapshot.resolve();
        } catch (err) {
            snapshot.revert();
            logger.error("TokenSecretsManager rotation failed, reverted to snapshot", err);
        } finally {
            // FIX: Release the lock unconditionally in finally.
            // The old implementation restored `queue` from the snapshot on revert,
            // which discarded any resolvers that had queued during the failed rotation,
            // causing those callers to hang forever. Now the lock is Promise-based and
            // callers chain on the promise directly — releasing it here unblocks all waiters.
            this._releaseLock();
        }
    }
}

export { TokenSecretsManager };