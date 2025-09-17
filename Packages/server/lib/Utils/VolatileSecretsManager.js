/**
 * This module contains the VolatileSecretsManager (VSM).
 * It holds a specified number of secrets in memory, determined at startup,
 * and allows access via their index.
 * 
 * These secrets are intended for non-critical, temporary operations that require a secret.
 * They should only be used when the loss of a secret would not cause significant damage
 * and can be safely recovered.
 * 
 * Keys are automatically rotated every 24 hours for enhanced security.
 * CronScheduler was not used due to the nature of the secrets and a custom cron system has been implemented.
 */

const cron = require('node-cron');
const { logger } = require("./logger");
const { generateChallenge } = require("./valueGenerator");

class VolatileSecretsManager {
  constructor(nKeys = 10, byteLength = 32, enableAutoRotation = true) {
    this.nKeys = nKeys;
    this.byteLength = byteLength;
    this.keys = new Map();
    this.cronJob = null;
    this.enableAutoRotation = enableAutoRotation;
    
    this._generateKeys();
    
    if (this.enableAutoRotation) {
      this._setupAutoRotation();
    }
  }

  _generateKeys() {
    for (let i = 0; i < this.nKeys; i++) {
      this.keys.set(i, generateChallenge(this.byteLength));
    }
    logger.info(`Volatile Secrets Manager: Generated ${this.nKeys} new keys`);
  }

  _setupAutoRotation() {
    // Schedule key rotation every day at midnight (00:00)
    this.cronJob = cron.schedule('0 0 * * *', () => {
      this._rotateAllKeys();
    }, {
      scheduled: true,
      timezone: "UTC"
    });
    
    logger.info("Volatile Secrets Manager: Auto key rotation scheduled for every 24 hours at midnight UTC");
  }

  _rotateAllKeys() {
    logger.info("Volatile Secrets Manager: Starting automatic key rotation");
    
    try {
      this._generateKeys();
      logger.info("Volatile Secrets Manager: Successfully rotated all keys");
    } catch (error) {
      logger.error("Volatile Secrets Manager: Failed to rotate keys", error);
    }
  }

  getKey(index) {
    if (!this.keys.has(index)) {
      logger.error("Volatile Secrets Manager: Invalid key index!");
      return { error: true };
    }

    return { error: false, secret: this.keys.get(index) };
  }

  destroyByIndex(index) {
    if (!this.keys.has(index)) {
      logger.error("Volatile Secrets Manager: Invalid key index!");
      return { error: true };
    }

    this.keys.set(index, generateChallenge(this.byteLength));
    logger.debug(`Volatile Secrets Manager: Manually rotated key at index ${index}`);

    return { error: false };
  }

  // Manual method to rotate all keys immediately
  rotateAllKeys() {
    this._rotateAllKeys();
    return { error: false };
  }

  // Method to stop the cron job when shutting down
  stopAutoRotation() {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info("Volatile Secrets Manager: Auto key rotation stopped");
    }
  }

  // Method to restart auto rotation
  startAutoRotation() {
    if (this.cronJob && !this.cronJob.running) {
      this.cronJob.start();
      logger.info("Volatile Secrets Manager: Auto key rotation restarted");
    } else if (!this.cronJob && this.enableAutoRotation) {
      this._setupAutoRotation();
    }
  }

  // Cleanup method for graceful shutdown
  destroy() {
    this.stopAutoRotation();
    this.keys.clear();
    logger.info("Volatile Secrets Manager: Destroyed all keys and stopped auto rotation");
  }
}

module.exports = { VolatileSecretsManager };