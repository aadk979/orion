import { cron, globalAccessPoint } from "../../../index.js";
import { getRandomElement } from "../ArrayUtilities.js";
import { isUnixExpired } from "../Date&Time.js";
import { readFromCaller, removeFromCaller, writeToCaller } from "../FileHandler.js";
import { logger } from "../logger.js";
import { Snapshotter } from "./Snapshotter.js";
import { SecretsCrypto } from "./SecretsCrypto.js";
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const redisInstanceModule = new SafeModuleHandler('RedisInstance', 'redisInstance', 'TokenSecretsManager.js');


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
        this.instanceType = globalAccessPoint.clusterMode() ? "CLUSTER" : "SINGLE";

        this.tokenSecretsCrypto = new SecretsCrypto(this.domain);
        this.TOKEN_SECRETS_FILE_NAME = `orion.internal.token_secrets_manager.${this.domain}.json`;

        this.signingPairs = [];
        this.verificationPairs = [];

        // FIX: Removed this._lockResolve. The old design stored only the most
        // recent caller's resolver here, so any earlier caller's lock was
        // silently stolen and could never be released, causing a deadlock.
        // Each _safeRotation call now owns its own release function returned
        // directly from _acquireLock(), so no shared resolver is needed.
        this._lockPromise = null;

        this.initialized = false;
        this.checkExpAndRepopulate = this.checkExpAndRepopulate.bind(this);
    }

    // FIX: Returns { previous, release } instead of just `previous`.
    // Each caller gets its own `release` closure, preventing the deadlock
    // caused by a shared this._lockResolve being overwritten by concurrent callers.
    _acquireLock() {
        const previous = this._lockPromise;
        let release;
        this._lockPromise = new Promise(r => { release = r; });
        return { previous, release };
    }

    async _waitForLock() {
        while (this._lockPromise) {
            const current = this._lockPromise;
            await current;
            if (this._lockPromise === current) {
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

        if ((fileRead.error && fileRead.errorCode !== "FILE-OPS::FILE-NOT-FOUND::A::p") || (fileRead?.data && !fileRead.json)) {
            await removeFromCaller(this.TOKEN_SECRETS_FILE_NAME);
            logger.warn(`Token Secrets Manager: Token secrets file for domain (${this.domain}) reset due to error/corruption`);
            fileRead.data = undefined;
        }

        if (!fileRead?.data) {
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
        const redisInstance = redisInstanceModule.probeModule();

        const redisKeysResult = await redisInstance.keys();
        const redisKeyNames = redisKeysResult?.data || [];
        const filteredKeyNames = redisKeyNames.filter(k => k.startsWith(`${CLUSTER_KEY_START_PREFIX}_${this.domain}`));
        const regionalKeyData = await Promise.all(filteredKeyNames.map(k => redisInstance.getData(k)));
        const importedVerificationKeys = await Promise.all(
            regionalKeyData
                .filter(r => !r.error && r.data !== undefined)
                .map(r => this._importPublicKey(r.data))
        );
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

    async _importPublicKey(key) {
        if (!key || !key.generationConfig) return key;

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
            const redisInstance = redisInstanceModule.probeModule();
            const redisKey = `${CLUSTER_KEY_START_PREFIX}_${this.domain}_${keyPairId}`;
            const key = await redisInstance.getData(redisKey);
            if (!key?.data || isUnixExpired(key.data.publicKeyExp)) {
                redisInstance.deleteData(redisKey);
                return null;
            }
            const imported = await this._importPublicKey(key.data);
            this.verificationPairs.push(imported);
            return imported;
        }

        return null;
    }

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

            const mergedVerification = [
                ...this.verificationPairs.filter(k => !isUnixExpired(k.publicKeyExp)),
                ...expired.map(this._stripRuntimeKeys)
            ]
                .sort((a, b) => b.publicKeyExp - a.publicKeyExp)
                .slice(0, MAX_VERIFICATION_PAIRS);

            this.verificationPairs = mergedVerification;
            this.signingPairs = active;

            const needed = this.nPairs - active.length;
            let newKeys = [];
            if (needed > 0) {
                const config = KEY_TYPES.find(k => k.algorithm === this.algorithm);
                const fn = config.type === "ECDSA"
                    ? this.tokenSecretsCrypto.generateECDSAKey
                    : this.tokenSecretsCrypto.generateRSAKey;

                newKeys = await Promise.all(Array(needed).fill(config).map(c => fn.call(this.tokenSecretsCrypto, c)));
                this.signingPairs.push(...newKeys);
            }

            // FIX: In cluster mode, new signing keys must be published to Redis
            // so that other nodes can import them for verification. Previously
            // this branch always called writeToCaller(), which writes a local
            // file that other cluster nodes never read, silently breaking
            // cross-node token verification after every rotation cycle.
            // Expired keys are also explicitly removed from Redis here to avoid
            // accumulating stale entries that Redis TTL alone may not clean up
            // fast enough (depending on the TTL precision of the Redis adapter).
            if (this.instanceType === "CLUSTER") {
                const redisInstance = redisInstanceModule.probeModule();

                if (expired.length > 0) {
                    await Promise.all(
                        expired.map(k => redisInstance.deleteData(
                            `${CLUSTER_KEY_START_PREFIX}_${this.domain}_${k.keyPairId}`
                        ))
                    );
                }

                if (newKeys.length > 0) {
                    const cleanedNewKeys = newKeys.map(this._stripRuntimeKeys);
                    await Promise.all(
                        cleanedNewKeys.map(k => redisInstance.addData(
                            `${CLUSTER_KEY_START_PREFIX}_${this.domain}_${k.keyPairId}`,
                            k,
                            k.publicKeyExp
                        ))
                    );
                }
            } else {
                const formattedVerification = this.verificationPairs.map(this._stripRuntimeKeys);
                const formattedSigning = this.signingPairs.map(this._stripRuntimeKeys);
                await writeToCaller(this.TOKEN_SECRETS_FILE_NAME, { keys: [...formattedVerification, ...formattedSigning] });
            }

            cron.addEvent(`TOKEN_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, "1h", {});
        });
    }

    async pruneVerificationPairs() {
        if (!this.initialized) return;

        await this._safeRotation(async () => {
            this.verificationPairs = this.verificationPairs
                .filter(k => !isUnixExpired(k.publicKeyExp))
                .sort((a, b) => b.publicKeyExp - a.publicKeyExp)
                .slice(0, MAX_VERIFICATION_PAIRS);
        });
    }

    async _safeRotation(fn) {
        // FIX: Destructure the per-call release function from _acquireLock().
        // Previously the lock used a shared this._lockResolve that was overwritten
        // on every call, meaning the last writer always stole earlier callers'
        // resolvers. Caller A would hold the lock but caller B's resolver was
        // stored, so when A released it resolved B's promise — and A's promise
        // (which B was awaiting as `previous`) could never resolve → deadlock.
        // Now each caller closes over its own `release` and is solely responsible
        // for freeing the lock it acquired.
        const { previous, release } = this._acquireLock();
        if (previous) await previous;

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
            // FIX: Reset _lockPromise to null before releasing so that
            // _waitForLock() exits its loop cleanly once the lock is free,
            // rather than looping forever on a stale resolved promise.
            this._lockPromise = null;
            release();
        }
    }
}

export { TokenSecretsManager };