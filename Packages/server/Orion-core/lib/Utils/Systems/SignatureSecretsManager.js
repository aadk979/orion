import { cron, globalAccessPoint } from "../../../index.js";
import { getRandomElement } from "../ArrayUtilities.js";
import { isUnixExpired } from "../Date&Time.js";
import { readFromCaller, removeFromCaller, writeToCaller } from "../FileHandler.js";
import { logger } from "../logger.js";
import { Snapshotter } from "./Snapshotter.js";
import { SecretsCrypto } from "./SecretsCrypto.js";
import crypto from 'crypto';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const redisInstanceModule = new SafeModuleHandler('RedisInstance', 'redisInstance', 'SignatureSecretsManager.js');


const KEY_TYPES = [
    { algorithm: "ES256", size: 256, type: "ECDSA" },
    { algorithm: "ES384", size: 384, type: "ECDSA" },
    { algorithm: "ES512", size: 512, type: "ECDSA" },
    { algorithm: "RS256", size: 2048, type: "RSA" },
    { algorithm: "RS384", size: 3072, type: "RSA" },
    { algorithm: "RS512", size: 4096, type: "RSA" }
];

const CLUSTER_KEY_START_PREFIX = "SIGNATURE_SECRETS_KEY_PAIR_CLUSTER";
const MAX_NUMBER_OF_PAIRS = 10;
const MAX_VERIFICATION_PAIRS = 20;
const AUTO_PRUNE_INTERVAL = 60_000;

class SignatureSecretsManager {

    constructor(domain, algorithm = "ES256", nPairs = 2) {
        if (!domain) throw new Error(`Configuration error: No domain provided`);
        if (!KEY_TYPES.find(obj => obj.algorithm === algorithm)) {
            throw new Error(`Configuration error: Invalid signature secrets manager algorithm: ${algorithm}`);
        }
        if (nPairs > MAX_NUMBER_OF_PAIRS) {
            logger.warn(`Signature Secrets Manager: Only a maximum of ${MAX_NUMBER_OF_PAIRS} key pairs are allowed! Defaulting to ${MAX_NUMBER_OF_PAIRS}`);
            nPairs = MAX_NUMBER_OF_PAIRS;
        }

        this.domain = domain;
        this.algorithm = algorithm;
        this.nPairs = nPairs;
        this.instanceType = globalAccessPoint.clusterMode() ? "CLUSTER" : "SINGLE";

        this.tokenSecretsCrypto = new SecretsCrypto(this.domain);
        this.SIGNATURE_SECRETS_FILE_NAME = `orion.internal.signature_secrets_manager.${this.domain}.json`;

        this.signingPairs = [];
        this.verificationPairs = [];

        // FIX 1: Removed this._lockResolve. Each _safeRotation call now owns
        // its own release function returned from _acquireLock(), preventing the
        // deadlock caused by a shared resolver being overwritten by concurrent callers.
        this._lockPromise = null;

        this.initialized = false;
        this.checkExpAndRepopulate = this.checkExpAndRepopulate.bind(this);
    }

    // FIX 1: Returns { previous, release } so each caller holds its own release
    // closure and cannot have it stolen by a subsequent concurrent caller.
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
            logger.error("Signature Secrets Manager: Key generation failed", err);
            throw err;
        }

        let fileRead = await readFromCaller(this.SIGNATURE_SECRETS_FILE_NAME);

        if ((fileRead.error && fileRead.errorCode !== "FILE-OPS::FILE-NOT-FOUND::A::p") || (fileRead?.data && !fileRead.json)) {
            await removeFromCaller(this.SIGNATURE_SECRETS_FILE_NAME);
            logger.warn(`Signature Secrets Manager: Secrets file for domain (${this.domain}) reset due to error/corruption`);
            fileRead.data = undefined;
        }

        if (!fileRead?.data) {
            const cleanedKeys = this.signingPairs.map(this._stripRuntimeKeys);
            await writeToCaller(this.SIGNATURE_SECRETS_FILE_NAME, { keys: cleanedKeys });
        }

        if (fileRead?.data) {
            const importedKeys = await Promise.all(
                fileRead.data.keys
                    .filter(k => !isUnixExpired(k.publicKeyExp))
                    .map(k => this._importPublicKey(k))
            );
            this.verificationPairs.push(...importedKeys);
        }

        cron.addEvent(`SIGNATURE_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, "30s", {});
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

        cron.addEvent(`SIGNATURE_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, "30s", {});

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
            logger.warn(`Signature Secrets Manager: Initialize manager before use for domain ${this.domain}`);
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
            logger.warn(`Signature Secrets Manager: Initialize manager before use for domain ${this.domain}`);
            return null;
        }
        await this._waitForLock();

        const available = this.signingPairs.filter(k => !isUnixExpired(k.privateKeyExp));
        if (available.length === 0) {
            logger.error(`Signature Secrets Manager: No valid signing key pairs available for domain ${this.domain}. Rotation may have failed.`);
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

            // FIX 2: In cluster mode, publish new signing keys to Redis so other
            // nodes can import them for verification, and explicitly delete expired
            // entries. Previously this always called writeToCaller() regardless of
            // instance type, writing a local file that other cluster nodes never read.
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
                await writeToCaller(this.SIGNATURE_SECRETS_FILE_NAME, { keys: [...formattedVerification, ...formattedSigning] });
            }

            cron.addEvent(`SIGNATURE_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, "1h", {});
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
        // FIX 1: Destructure the per-call release function from _acquireLock().
        // FIX 3: Reset _lockPromise to null before releasing so _waitForLock()
        // exits its loop cleanly rather than spinning on a stale resolved promise.
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
            logger.error("SignatureSecretsManager rotation failed, reverted to snapshot", err);
        } finally {
            this._lockPromise = null;
            release();
        }
    }

    sign(data, keyPairId) {
        if (!this.initialized) throw new Error("SignatureSecretsManager not initialized");

        const pair = this.signingPairs.find(k => k.keyPairId === keyPairId);
        if (!pair) throw new Error(`Signing failed: Key pair ${keyPairId} not found or inactive`);

        const nodePrivateKey = pair._nodePrivateKey;
        if (!nodePrivateKey) throw new Error("Private key missing on key pair");

        let algorithm;
        switch (pair.generationConfig.algorithm) {
            case "ES256": algorithm = "SHA256"; break;
            case "ES384": algorithm = "SHA384"; break;
            case "ES512": algorithm = "SHA512"; break;
            case "RS256": algorithm = "SHA256"; break;
            case "RS384": algorithm = "SHA384"; break;
            case "RS512": algorithm = "SHA512"; break;
            default: algorithm = "SHA256";
        }

        const sign = crypto.createSign(algorithm);
        sign.update(data);
        sign.end();

        return sign.sign(nodePrivateKey, "base64");
    }

    async verify(data, signature, keyPairId) {
        if (!this.initialized) throw new Error("SignatureSecretsManager not initialized");

        const pair = await this.findKeyPair(keyPairId);
        if (!pair) return false;

        const nodePublicKey = pair._nodePublicKey;
        if (!nodePublicKey) return false;

        let algorithm;
        switch (pair.generationConfig.algorithm) {
            case "ES256": algorithm = "SHA256"; break;
            case "ES384": algorithm = "SHA384"; break;
            case "ES512": algorithm = "SHA512"; break;
            case "RS256": algorithm = "SHA256"; break;
            case "RS384": algorithm = "SHA384"; break;
            case "RS512": algorithm = "SHA512"; break;
            default: algorithm = "SHA256";
        }

        const verify = crypto.createVerify(algorithm);
        verify.update(data);
        verify.end();

        try {
            return verify.verify(nodePublicKey, signature, "base64");
        } catch (e) {
            return false;
        }
    }
}

export { SignatureSecretsManager };