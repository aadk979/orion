import cron from 'node-cron';
import { logger } from '../logger.js';
import { generateKeyPair } from '../CryptoFunctions.js';
import { generateId } from '../valueGenerator.js';

const MAX_KEYS_PER_PARTITION = 15;
const VALID_KEY_SIZES = [2048, 3072, 4096];

function generateKeyPairId() {
  return generateId("TOKEN_KEY_PAIR");
}

class TokenSecretsManager {
  constructor({
    partitions = ["access", "refresh", "resource_access"],
    nKeysPerPartition = 10,
    keySize = 2048,
    enableAutoRotation = true,
  } = {}) {
    this.keySize = VALID_KEY_SIZES.includes(keySize) ? keySize : VALID_KEY_SIZES[0];
    this.enableAutoRotation = enableAutoRotation;

    const safeKeyCount = (count) => {
      if (count > MAX_KEYS_PER_PARTITION) return MAX_KEYS_PER_PARTITION;
      return count % 2 === 0 ? count : Math.min(count + 1, MAX_KEYS_PER_PARTITION);
    };
    this.nKeysPerPartition = safeKeyCount(nKeysPerPartition);

    this.partitions = new Map();
    partitions.forEach((p) => {
      this.partitions.set(p, { keys: new Map(), oldKeys: [] });
    });

    this.cronJob = null;
    this.isReady = false;
    this.readyPromise = this._generateAllPartitions()
      .then(() => {
        this.isReady = true;
        logger.info(
          `Token Secrets Manager: Initialized ${this.partitions.size} partitions with ${this.nKeysPerPartition} keys each`
        );
      })
      .catch((err) => {
        logger.error("Token Secrets Manager: Failed to generate initial keys", err);
        this.isReady = false;
      });

    if (this.enableAutoRotation) this._setupAutoRotation();
  }

  ready () {
    return this.isReady;
  }

  async waitUntilReady() {
    if (this.isReady) return;
    await this.readyPromise;
  }

  async _generateAllPartitions() {
    for (const [type, pool] of this.partitions.entries()) {
      pool.keys.clear();
      const pairs = await Promise.all(
        Array.from({ length: this.nKeysPerPartition }, async () => {
          const keyPair = await generateKeyPair(this.keySize);
          return {
            keyPairId: generateKeyPairId(),
            type,
            createdAt: Date.now(),
            ...keyPair,
          };
        })
      );
      pairs.forEach((pair, i) => pool.keys.set(i, pair));
    }
  }

  _setupAutoRotation() {
    this.cronJob = cron.schedule(
      '0 0 * * *',
      async () => await this._rotateAllPartitions(),
      { scheduled: true, timezone: "UTC" }
    );
    logger.info("Token Secrets Manager: Auto rotation scheduled daily at midnight UTC");
  }

  async _rotateAllPartitions() {
    logger.info("Token Secrets Manager: Rotating all partitions...");
    try {
      const now = Date.now();
      const oneWeek = 7 * 24 * 60 * 60 * 1000;

      for (const [type, pool] of this.partitions.entries()) {
        for (const [index, keyObj] of pool.keys.entries()) {
          const { privateKey, ...rest } = keyObj;
          pool.oldKeys.push({ ...rest, createdAt: keyObj.createdAt });

          const newPair = await generateKeyPair(this.keySize);
          pool.keys.set(index, {
            keyPairId: generateKeyPairId(),
            type,
            createdAt: now,
            ...newPair,
          });
        }
        pool.oldKeys = pool.oldKeys.filter((k) => now - k.createdAt < oneWeek);
      }

      logger.info("Token Secrets Manager: All partitions rotated successfully");
    } catch (err) {
      logger.error("Token Secrets Manager: Rotation failure", err);
    }
  }

  async getRandomKeyPair(type) {
    await this.waitUntilReady();
    const pool = this.partitions.get(type);
    if (!pool) return { error: true, message: `Unknown token type: ${type}` };

    const index = Math.floor(Math.random() * this.nKeysPerPartition);
    return { error: false, ...pool.keys.get(index) };
  }

  async getKeyPairById(keyPairId, type) {
    await this.waitUntilReady();
    const pool = this.partitions.get(type);
    if (!pool) return { error: true, message: `Invalid partition ${type}` };

    for (const [, keyObj] of pool.keys.entries()) {
      if (keyObj.keyPairId === keyPairId)
        return { error: false, ...keyObj, notFound: false };
    }

    for (const keyObj of pool.oldKeys) {
      if (keyObj.keyPairId === keyPairId)
        return { error: false, ...keyObj, notFound: false };
    }

    logger.log(`Token Secrets Manager: Key ${keyPairId} (${type}) not found`);
    return { error: false, notFound: true };
  }

  getJWKsKeys(type) {
    const pool = this.partitions.get(type);
    return pool ? pool.oldKeys : [];
  }

  addJWKs(type, jwksArray = []) {
    const pool = this.partitions.get(type);
    if (!pool) {
      logger.error(`Token Secrets Manager: Invalid partition ${type}`);
      return { error: true };
    }

    const now = Date.now();
    jwksArray.forEach((jwk) => {
      if (jwk.keyPairId && jwk.type === type) {
        pool.oldKeys.push({ ...jwk, createdAt: jwk.createdAt || now });
      } else {
        logger.warn("Token Secrets Manager: Ignored invalid JWK", jwk);
      }
    });
    logger.info(`Token Secrets Manager: Added ${jwksArray.length} JWKs to ${type}`);
    return { error: false, count: jwksArray.length };
  }

  massGetJWKs(includePrivateKeys = false) {
    const bundle = { 
      issuedAt: Date.now(), 
      partitions: {},
      metadata: {
        keySize: this.keySize,
        nKeysPerPartition: this.nKeysPerPartition,
        includesPrivateKeys: includePrivateKeys
      }
    };
    
    for (const [type, pool] of this.partitions.entries()) {
      const currentKeys = Array.from(pool.keys.values());
      
      bundle.partitions[type] = {
        currentKeys: currentKeys.map((key) => {
          if (includePrivateKeys) {
            return key; // Include everything including privateKey
          }
          const { privateKey, ...rest } = key;
          return rest; // Strip private keys for security
        }),
        oldKeys: [...pool.oldKeys] // Copy array
      };
    }
    
    logger.info(`Token Secrets Manager: Mass-exported ${Object.keys(bundle.partitions).length} partitions (privateKeys: ${includePrivateKeys})`);
    return bundle;
  }
  
  massAddJWKs(jwksBundle = {}) {
    if (!jwksBundle || !jwksBundle.partitions) {
      logger.error("Token Secrets Manager: Invalid massAdd bundle format");
      return { error: true, message: "Invalid bundle format" };
    }
  
    const now = Date.now();
    let totalCurrentKeys = 0;
    let totalOldKeys = 0;
    const includesPrivateKeys = jwksBundle.metadata?.includesPrivateKeys || false;
  
    for (const [type, partitionData] of Object.entries(jwksBundle.partitions)) {
      if (!this.partitions.has(type)) {
        this.partitions.set(type, { keys: new Map(), oldKeys: [] });
        logger.info(`Token Secrets Manager: Created new partition "${type}"`);
      }
  
      const pool = this.partitions.get(type);
      
      // Handle current keys
      if (partitionData.currentKeys && Array.isArray(partitionData.currentKeys)) {
        if (includesPrivateKeys) {
          // If we have private keys, restore them as current keys
          pool.keys.clear();
          partitionData.currentKeys.forEach((jwk, index) => {
            if (jwk.keyPairId && jwk.type === type && jwk.privateKey) {
              pool.keys.set(index, { 
                ...jwk, 
                createdAt: jwk.createdAt || now 
              });
              totalCurrentKeys++;
            }
          });
        } else {
          // No private keys, add to oldKeys for verification only
          partitionData.currentKeys.forEach((jwk) => {
            if (jwk.keyPairId && jwk.type === type) {
              pool.oldKeys.push({ 
                ...jwk, 
                createdAt: jwk.createdAt || now 
              });
              totalOldKeys++;
            }
          });
        }
      }
      
      // Handle old keys - always add to oldKeys
      if (partitionData.oldKeys && Array.isArray(partitionData.oldKeys)) {
        partitionData.oldKeys.forEach((jwk) => {
          if (jwk.keyPairId && jwk.type === type) {
            // Check for duplicates
            const exists = pool.oldKeys.some(k => k.keyPairId === jwk.keyPairId);
            if (!exists) {
              pool.oldKeys.push({ 
                ...jwk, 
                createdAt: jwk.createdAt || now 
              });
              totalOldKeys++;
            }
          }
        });
      }
    }
  
    logger.info(`Token Secrets Manager: Mass-added ${totalCurrentKeys} current keys and ${totalOldKeys} old keys`);
    return { 
      error: false, 
      currentKeys: totalCurrentKeys, 
      oldKeys: totalOldKeys,
      total: totalCurrentKeys + totalOldKeys
    };
  }

  async destroyByIndex(type, index) {
    await this.waitUntilReady();
    const pool = this.partitions.get(type);
    if (!pool || !pool.keys.has(index)) {
      logger.error("Token Secrets Manager: Invalid partition or index");
      return { error: true };
    }

    const oldKey = pool.keys.get(index);
    const { privateKey, ...rest } = oldKey;
    pool.oldKeys.push({ ...rest, createdAt: oldKey.createdAt });

    const newKeyPair = await generateKeyPair(this.keySize);
    pool.keys.set(index, { keyPairId: generateKeyPairId(), type, createdAt: Date.now(), ...newKeyPair });

    logger.log(`Token Secrets Manager: Manually rotated ${type} key at index ${index}`);
    return { error: false };
  }

  async rotateAllKeys() {
    await this.waitUntilReady();
    await this._rotateAllPartitions();
    return { error: false };
  }

  stopAutoRotation() {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info("Token Secrets Manager: Auto rotation stopped");
    }
  }

  startAutoRotation() {
    if (this.cronJob && !this.cronJob.running) {
      this.cronJob.start();
      logger.info("Token Secrets Manager: Auto rotation restarted");
    } else if (!this.cronJob && this.enableAutoRotation) {
      this._setupAutoRotation();
    }
  }

  destroy() {
    this.stopAutoRotation();
    for (const pool of this.partitions.values()) {
      pool.keys.clear();
      pool.oldKeys = [];
    }
    logger.info("Token Secrets Manager: Destroyed all partitions and stopped rotation");
  }

  async addPartition(type, keyCount = this.nKeysPerPartition) {
    if (this.partitions.has(type)) {
      logger.warn(`Token Secrets Manager: Partition ${type} already exists`);
      return { error: true };
    }

    const safeCount = Math.min(Math.max(2, keyCount), MAX_KEYS_PER_PARTITION);
    const keys = new Map();
    const oldKeys = [];

    const pairs = await Promise.all(
      Array.from({ length: safeCount }, async () => {
        const kp = await generateKeyPair(this.keySize);
        return { keyPairId: generateKeyPairId(), type, createdAt: Date.now(), ...kp };
      })
    );
    pairs.forEach((pair, i) => keys.set(i, pair));

    this.partitions.set(type, { keys, oldKeys });
    logger.info(`Token Secrets Manager: Added new partition "${type}" with ${safeCount} keys`);
    return { error: false };
  }
}

export { TokenSecretsManager };