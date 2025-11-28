import Redis from "ioredis";
import { logger } from "../logger.js";

class RedisService {
  constructor() {
    this.client = null;
    this.initialized = false;
  }

  initialize(cred) {
    try {
      if (!cred || typeof cred !== "object" || !cred.uri) {
        throw new Error("Missing or invalid Redis credentials object");
      }

      this.client = new Redis(cred.uri, {
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        reconnectOnError: (err) => {
          logger.error("Redis reconnect triggered:", err.message);
          return true;
        },
      });

      this.client.on("connect", () => logger.info("✅ Redis connected successfully"));
      this.client.on("error", (err) => logger.error("Redis Error:", err.message));

      this.initialized = true;
      return true;
    } catch (err) {
      logger.error("Initialization Error:", err.message);
      return false;
    }
  }

  ensureInitialized() {
    if (!this.initialized || !this.client) {
      throw new Error("Redis is not initialized. Call initialize() first.");
    }
  }

  async addData(collectionName, docId, data) {
    try {
      this.ensureInitialized();
      const key = `${collectionName}:${docId}`;
      await this.client.set(key, JSON.stringify(data));
      return { completed: true, error: false };
    } catch (err) {
      logger.error("Add Error:", err.message);
      return { error: true, context: "DB-FAIL", errorArray: [err.message] };
    }
  }

  async getData(collectionName, docId) {
    try {
      this.ensureInitialized();
      const key = `${collectionName}:${docId}`;
      const result = await this.client.get(key);
      return {
        error: false,
        data: result ? JSON.parse(result) : undefined,
        completed: true,
      };
    } catch (err) {
      logger.error("Get Error:", err.message);
      return { error: true, context: "DB-FAIL", errorArray: [err.message] };
    }
  }

  async deleteData(collectionName, docId) {
    try {
      this.ensureInitialized();
      const key = `${collectionName}:${docId}`;
      const deleted = await this.client.del(key);
      if (deleted === 0) throw new Error("Key not found!");
      return { completed: true, error: false };
    } catch (err) {
      logger.error("Delete Error:", err.message);
      return { error: true, context: "DB-FAIL", errorArray: [err.message] };
    }
  }

  async close() {
    try {
      if (this.client) await this.client.quit();
      this.initialized = false;
      logger.info("Redis connection closed");
    } catch (err) {
      logger.error("Close Error:", err.message);
    }
  }
}

export { RedisService };