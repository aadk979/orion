import { cron, globalAccessPoint } from '../../../index.js';
import { getRandomElement } from '../ArrayUtilities.js';
import { isUnixExpired } from '../Date&Time.js';
import { readFromCaller, removeFromCaller, writeToCaller } from '../FileHandler.js';
import { logger } from '../logger.js';
import { Snapshotter } from './Snapshotter.js';
import { SecretsCrypto } from './SecretsCrypto.js';
import { SafeModuleHandler } from '../UnavailableModuleWrapper.js';

const redisInstanceModule = new SafeModuleHandler('RedisInstance', 'redisInstance', 'TokenSecretsManager.js');

const KEY_TYPES = [
    { algorithm: 'ES256', size: 256, type: 'ECDSA' },
    { algorithm: 'ES384', size: 384, type: 'ECDSA' },
    { algorithm: 'ES512', size: 512, type: 'ECDSA' },
    { algorithm: 'RS256', size: 2048, type: 'RSA' },
    { algorithm: 'RS384', size: 3072, type: 'RSA' },
    { algorithm: 'RS512', size: 4096, type: 'RSA' }
];

// Cluster mode stores all of a domain's key pairs in a single Redis hash
// (field = keyPairId), so reads never scan the keyspace. Expiry is enforced
// in-code via publicKeyExp; the whole-hash TTL below is only a safety net so
// an abandoned domain's hash eventually vacates on its own.
const CLUSTER_HASH_PREFIX = 'TOKEN_SECRETS_KEY_PAIRS_CLUSTER';
const CLUSTER_HASH_TTL_BUFFER_SECONDS = 24 * 60 * 60;
const CLUSTER_PRUNE_GRACE_SECONDS = 5 * 60;
const CLUSTER_PRUNE_LOCK_TTL_SECONDS = 30 * 60;
const MAX_NUMBER_OF_PAIRS = 10;
const MAX_VERIFICATION_PAIRS = 20;
const AUTO_PRUNE_INTERVAL = 60_000;

class TokenSecretsManager {
    constructor(domain, algorithm = 'ES256', nPairs = 2) {
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
        this.instanceType = globalAccessPoint.clusterMode() ? 'CLUSTER' : 'SINGLE';

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
        this._lockPromise = new Promise(r => {
            release = r;
        });
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
        if (this.instanceType === 'SINGLE') {
            await this._initializeSingle();
        } else {
            await this._initializeCluster();
        }

        setInterval(() => this.pruneVerificationPairs(), AUTO_PRUNE_INTERVAL);
    }

    async _initializeSingle() {
        const config = KEY_TYPES.find(obj => obj.algorithm === this.algorithm);
        const configArr = Array(this.nPairs).fill(config);
        const fn = config.type === 'ECDSA' ? this.tokenSecretsCrypto.generateECDSAKey : this.tokenSecretsCrypto.generateRSAKey;

        try {
            const allKeys = await Promise.all(configArr.map(c => fn.call(this.tokenSecretsCrypto, c)));
            this.signingPairs.push(...allKeys);
        } catch (err) {
            logger.error('Token Secrets Manager: Key generation failed', err);
            throw err;
        }

        let fileRead = await readFromCaller(this.TOKEN_SECRETS_FILE_NAME);

        if ((fileRead.error && fileRead.errorCode !== 'FILE-OPS::FILE-NOT-FOUND::A::p') || (fileRead?.data && !fileRead.json)) {
            await removeFromCaller(this.TOKEN_SECRETS_FILE_NAME);
            logger.warn(`Token Secrets Manager: Token secrets file for domain (${this.domain}) reset due to error/corruption`);
            fileRead.data = undefined;
        }

        if (!fileRead?.data) {
            const cleanedKeys = this.signingPairs.map(this._stripRuntimeKeys);
            await writeToCaller(this.TOKEN_SECRETS_FILE_NAME, { keys: cleanedKeys });
        }

        if (fileRead?.data) {
            const importedKeys = await Promise.all(fileRead.data.keys.filter(k => !isUnixExpired(k.publicKeyExp)).map(k => this._importPublicKey(k)));
            this.verificationPairs.push(...importedKeys);
        }

        cron.addEvent(`TOKEN_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, '30s', {});
        this.initialized = true;
    }

    _clusterHashKey() {
        return `${CLUSTER_HASH_PREFIX}_${this.domain}`;
    }

    // Deleting from Redis waits out a grace period beyond expiry so clock skew
    // between nodes can't wipe a pair another node still considers valid.
    // Malformed pairs (no publicKeyExp) are prunable immediately.
    _isPrunablePair(pair) {
        return !pair || !pair.publicKeyExp || isUnixExpired(pair.publicKeyExp + CLUSTER_PRUNE_GRACE_SECONDS);
    }

    // Cluster-wide sweep of the domain hash so expired pairs left behind by
    // other nodes (e.g. a node that died before its rotation ran) don't
    // accumulate forever. HDEL on an already-removed field is a no-op, so
    // concurrent sweeps are safe; the NX lock just keeps every node from
    // repeating the same sweep each interval.
    async _pruneClusterExpiredPairs(redisInstance) {
        const lock = await redisInstance.setIfAbsent(
            `${this._clusterHashKey()}_PRUNE_LOCK`,
            true,
            Math.floor(Date.now() / 1000) + CLUSTER_PRUNE_LOCK_TTL_SECONDS
        );
        if (lock?.data !== true) return;

        const stored = await redisInstance.hashGetAll(this._clusterHashKey());
        const prunableIds = Object.entries(stored?.data || {})
            .filter(([, pair]) => this._isPrunablePair(pair))
            .map(([keyPairId]) => keyPairId);
        if (prunableIds.length > 0) await redisInstance.hashDelete(this._clusterHashKey(), prunableIds);
    }

    // Publishes stripped key pairs as hash fields and refreshes the whole-hash
    // safety-net TTL past the latest expiry among the written pairs.
    _publishPairsToCluster(redisInstance, cleanedKeys) {
        const fields = Object.fromEntries(cleanedKeys.map(k => [k.keyPairId, k]));
        const hashTTL = Math.max(...cleanedKeys.map(k => k.publicKeyExp)) + CLUSTER_HASH_TTL_BUFFER_SECONDS;
        return redisInstance.hashSet(this._clusterHashKey(), fields, hashTTL);
    }

    async _initializeCluster() {
        const redisInstance = redisInstanceModule.probeModule();

        const storedResult = await redisInstance.hashGetAll(this._clusterHashKey());
        const storedPairs = storedResult?.data || {};

        // Hash fields have no per-field TTL, so expired pairs are pruned lazily here,
        // during rotation, and by the periodic cluster sweep.
        const expiredFieldIds = Object.entries(storedPairs)
            .filter(([, pair]) => this._isPrunablePair(pair))
            .map(([keyPairId]) => keyPairId);
        if (expiredFieldIds.length > 0) await redisInstance.hashDelete(this._clusterHashKey(), expiredFieldIds);

        const validPairs = Object.values(storedPairs).filter(pair => pair && !isUnixExpired(pair.publicKeyExp));
        this.verificationPairs = await Promise.all(validPairs.map(pair => this._importPublicKey(pair)));

        const config = KEY_TYPES.find(obj => obj.algorithm === this.algorithm);
        const configArr = Array(this.nPairs).fill(config);
        const fn = config.type === 'ECDSA' ? this.tokenSecretsCrypto.generateECDSAKey : this.tokenSecretsCrypto.generateRSAKey;

        const newSigningPairs = await Promise.all(configArr.map(c => fn.call(this.tokenSecretsCrypto, c)));
        this.signingPairs.push(...newSigningPairs);

        await this._publishPairsToCluster(redisInstance, newSigningPairs.map(this._stripRuntimeKeys));

        cron.addEvent(`TOKEN_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, '30s', {});

        this.initialized = true;
    }

    _stripRuntimeKeys = key => {
        const copy = { ...key, keys: { ...key.keys } };
        if (copy.keys.private) delete copy.keys.private;
        if (copy.keys.public?.spki) delete copy.keys.public.spki;
        if (copy.keys.public?.base64) delete copy.keys.public.base64;
        delete copy._cryptoKey;
        delete copy._nodePrivateKey;
        delete copy._nodePublicKey;
        return copy;
    };

    async _importPublicKey(key) {
        if (!key || !key.generationConfig) return key;

        const safeKey = { ...key, keys: { ...key.keys, public: { ...key.keys.public } } };

        let imported;
        if (safeKey.generationConfig.type === 'ECDSA') {
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

        if (this.instanceType === 'CLUSTER') {
            const redisInstance = redisInstanceModule.probeModule();
            const result = await redisInstance.hashGet(this._clusterHashKey(), keyPairId);
            if (!result?.data || isUnixExpired(result.data.publicKeyExp)) {
                if (result?.data && this._isPrunablePair(result.data)) {
                    redisInstance.hashDelete(this._clusterHashKey(), keyPairId);
                }
                return null;
            }
            const imported = await this._importPublicKey(result.data);
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

            const mergedVerification = [...this.verificationPairs.filter(k => !isUnixExpired(k.publicKeyExp)), ...expired.map(this._stripRuntimeKeys)]
                .sort((a, b) => b.publicKeyExp - a.publicKeyExp)
                .slice(0, MAX_VERIFICATION_PAIRS);

            this.verificationPairs = mergedVerification;
            this.signingPairs = active;

            const needed = this.nPairs - active.length;
            let newKeys = [];
            if (needed > 0) {
                const config = KEY_TYPES.find(k => k.algorithm === this.algorithm);
                const fn = config.type === 'ECDSA' ? this.tokenSecretsCrypto.generateECDSAKey : this.tokenSecretsCrypto.generateRSAKey;

                newKeys = await Promise.all(
                    Array(needed)
                        .fill(config)
                        .map(c => fn.call(this.tokenSecretsCrypto, c))
                );
                this.signingPairs.push(...newKeys);
            }

            // In cluster mode, publish new signing keys to the domain hash so other
            // nodes can import them for verification; expired fields are removed
            // explicitly since hash fields carry no per-field TTL.
            if (this.instanceType === 'CLUSTER') {
                const redisInstance = redisInstanceModule.probeModule();

                if (expired.length > 0) {
                    await redisInstance.hashDelete(
                        this._clusterHashKey(),
                        expired.map(k => k.keyPairId)
                    );
                }

                if (newKeys.length > 0) {
                    await this._publishPairsToCluster(redisInstance, newKeys.map(this._stripRuntimeKeys));
                }

                await this._pruneClusterExpiredPairs(redisInstance);
            } else {
                const formattedVerification = this.verificationPairs.map(this._stripRuntimeKeys);
                const formattedSigning = this.signingPairs.map(this._stripRuntimeKeys);
                await writeToCaller(this.TOKEN_SECRETS_FILE_NAME, { keys: [...formattedVerification, ...formattedSigning] });
            }

            cron.addEvent(`TOKEN_SECRETS_MANAGER_CHECK_ROTATE_${this.domain}`, this.checkExpAndRepopulate, '1h', {});
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

    /**
     * Non-expired key inventory: signing kids this node owns and verification
     * kids it trusts. Safe to ship off-node — kids and expiries only, no key
     * material.
     */
    describeKeys() {
        return {
            domain: this.domain,
            algorithm: this.algorithm,
            instanceType: this.instanceType,
            signing: this.signingPairs
                .filter(k => !isUnixExpired(k.privateKeyExp))
                .map(k => ({ kid: k.keyPairId, privateKeyExp: k.privateKeyExp, publicKeyExp: k.publicKeyExp })),
            verification: this.verificationPairs.filter(k => !isUnixExpired(k.publicKeyExp)).map(k => ({ kid: k.keyPairId, publicKeyExp: k.publicKeyExp }))
        };
    }

    /**
     * Best-effort scrub of a revoked pair's key material so nothing usable
     * lingers on the discarded object while it awaits GC.
     */
    _wipePairSecrets(pair) {
        if (!pair) return;
        if (pair.keys) {
            delete pair.keys.private;
            if (pair.keys.public) {
                delete pair.keys.public.spki;
                delete pair.keys.public.base64;
                delete pair.keys.public.jwk;
            }
        }
        delete pair._cryptoKey;
        delete pair._nodePrivateKey;
        delete pair._nodePublicKey;
    }

    /**
     * Immediate out-of-band revocation + replacement (compromise response).
     *
     * Two modes:
     *   forceRotate({ kids: [...] }) — every listed kid found in the SIGNING
     *     pool is decommissioned and replaced with a freshly generated pair;
     *     kids found in the VERIFICATION pool are dropped so this node stops
     *     accepting their signatures. Kids in neither pool are reported as
     *     `unknown` but (in cluster mode) still deleted from Redis, so a kid
     *     this node never imported dies cluster-wide anyway.
     *   forceRotate({ full: true }) — decommissions the ENTIRE signing pool at
     *     once and regenerates nPairs fresh pairs.
     *
     * Unlike scheduled rotation, revoked signing pairs are NOT demoted to the
     * verification pool — revocation means their signatures must stop
     * verifying immediately. Runs under the rotation lock; on any failure the
     * in-memory state reverts and this method throws. Private key material of
     * revoked pairs is scrubbed from memory as the final step, after every
     * fallible operation has succeeded.
     */
    async forceRotate({ kids = null, full = false } = {}) {
        if (!this.initialized) throw new Error(`TokenSecretsManager not initialized for domain ${this.domain}`);
        if (!full && (!Array.isArray(kids) || kids.length === 0)) {
            throw new Error('forceRotate requires { kids: [...] } or { full: true }');
        }

        let summary = null;

        await this._safeRotation(async () => {
            const targetKids = full ? this.signingPairs.map(k => k.keyPairId) : [...new Set(kids.map(String))];
            const targetSet = new Set(targetKids);

            const revokedSigning = this.signingPairs.filter(k => targetSet.has(k.keyPairId));
            const survivingSigning = this.signingPairs.filter(k => !targetSet.has(k.keyPairId));
            const revokedVerification = this.verificationPairs.filter(k => targetSet.has(k.keyPairId));
            const survivingVerification = this.verificationPairs.filter(k => !targetSet.has(k.keyPairId));

            // Only revoked SIGNING pairs are replaced — a dropped verification
            // kid belongs to another node (or a past generation) and is not
            // ours to regenerate.
            const needed = full ? this.nPairs : revokedSigning.length;
            let newKeys = [];
            if (needed > 0) {
                const config = KEY_TYPES.find(k => k.algorithm === this.algorithm);
                const fn = config.type === 'ECDSA' ? this.tokenSecretsCrypto.generateECDSAKey : this.tokenSecretsCrypto.generateRSAKey;
                newKeys = await Promise.all(
                    Array(needed)
                        .fill(config)
                        .map(c => fn.call(this.tokenSecretsCrypto, c))
                );
            }

            if (this.instanceType === 'CLUSTER') {
                const redisInstance = redisInstanceModule.probeModule();
                // Delete before publishing: if this partially fails, keys are
                // gone from Redis without replacements — fail-safe for a
                // revocation. Deletion covers every targeted kid, including
                // ones this node never held, so verification dies fleet-wide.
                await redisInstance.hashDelete(this._clusterHashKey(), targetKids);
                if (newKeys.length > 0) {
                    await this._publishPairsToCluster(redisInstance, newKeys.map(this._stripRuntimeKeys));
                }
            }

            const nextSigning = [...survivingSigning, ...newKeys];
            const nextVerification = survivingVerification;

            if (this.instanceType === 'SINGLE') {
                await writeToCaller(this.TOKEN_SECRETS_FILE_NAME, {
                    keys: [...nextVerification.map(this._stripRuntimeKeys), ...nextSigning.map(this._stripRuntimeKeys)]
                });
            }

            this.signingPairs = nextSigning;
            this.verificationPairs = nextVerification;

            // Nothing below can throw — safe to destroy the revoked material.
            [...revokedSigning, ...revokedVerification].forEach(pair => this._wipePairSecrets(pair));

            const foundKids = new Set([...revokedSigning, ...revokedVerification].map(k => k.keyPairId));

            summary = {
                domain: this.domain,
                mode: full ? 'full' : 'kids',
                revokedSigning: revokedSigning.map(k => k.keyPairId),
                revokedVerification: revokedVerification.map(k => k.keyPairId),
                unknown: full ? [] : targetKids.filter(kid => !foundKids.has(kid)),
                generated: newKeys.map(k => k.keyPairId)
            };

            logger.warn(
                `Token Secrets Manager: FORCE ROTATION (${summary.mode}) for domain ${this.domain} — revoked signing [${summary.revokedSigning.join(', ')}], revoked verification [${summary.revokedVerification.join(', ')}], generated [${summary.generated.join(', ')}]`
            );
        });

        // _safeRotation swallows errors after reverting the snapshot — surface
        // the failure to the caller so a revocation can never silently no-op.
        if (!summary) {
            throw new Error(`Token Secrets Manager: force rotation failed for domain ${this.domain} — state reverted, see logs`);
        }

        return summary;
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
            snap => {
                this.signingPairs = snap.signingPairs;
                this.verificationPairs = snap.verificationPairs;
            },
            () => {}
        );

        try {
            await fn();
            snapshot.resolve();
        } catch (err) {
            snapshot.revert();
            logger.error('TokenSecretsManager rotation failed, reverted to snapshot', err);
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
