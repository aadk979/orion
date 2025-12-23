import Redis from "ioredis";
import { logger } from "../../logger.js";

function buildRedisURI({ host, port, password }) {
  return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
}

class RedisService {
  constructor() {
    this.client = null;
    this.initialized = false;
    this.collectionName = "orion-configs";
  }

  initialize(cred) {
    try {
      if (!cred || typeof cred !== "object" || !cred.password) {
        throw new Error("Missing or invalid Redis credentials object");
      }

      const uri = buildRedisURI({
        host: cred?.host || "localhost",
        port: cred?.PORT || 6379,
        password: cred?.password,
      });

      this.client = new Redis(uri, {
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        reconnectOnError: (err) => {
          logger.error("Redis reconnect triggered:", err.message);
          return true;
        },
      });

      this.client.on("connect", () =>
        logger.info("✅ Redis connected successfully")
      );
      this.client.on("error", (err) =>
        logger.error("Redis Error:", err)
      );

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

  _key(id) {
    return `${this.collectionName}:${id}`;
  }

  async addData(id, data, ttl) {
    try {
      this.ensureInitialized();
      const key = this._key(id);
      const value = JSON.stringify(data);

      if (ttl !== undefined) {
        const now = Math.floor(Date.now() / 1000);
        const expiresIn = ttl - now;

        if (expiresIn <= 0) {
          await this.client.del(key);
          return { error: false, expired: true, completed: true };
        }

        await this.client.setex(key, expiresIn, value);
      } else {
        await this.client.set(key, value);
      }

      return { error: false, completed: true };
    } catch (err) {
      logger.error("Add Error:", err.message);
      return { error: true, completed: false };
    }
  }

  async getData(id) {
    try {
      this.ensureInitialized();
      const res = await this.client.get(this._key(id));
      return {
        error: false,
        data: res ? JSON.parse(res) : undefined,
        completed: true,
      };
    } catch (err) {
      logger.error("Get Error:", err.message);
      return { error: true, completed: false };
    }
  }

  async has(id) {
    const exists = await this.client.exists(this._key(id));
    return { error: false, data: Boolean(exists), completed: true };
  }

  async getTTL(id) {
    const ttl = await this.client.ttl(this._key(id));
    if (ttl === -2) return { error: false, expired: true, completed: true };
    if (ttl === -1) return { error: false, data: null, completed: true };
    return { error: false, data: ttl, completed: true };
  }

  async updateTTL(id, ttl) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = ttl - now;

    if (expiresIn <= 0) {
      await this.client.del(this._key(id));
      return { error: false, expired: true, completed: true };
    }

    await this.client.expire(this._key(id), expiresIn);
    return { error: false, completed: true };
  }

  async removeTTL(id) {
    await this.client.persist(this._key(id));
    return { error: false, completed: true };
  }

  async deleteData(id) {
    const deleted = await this.client.del(this._key(id));
    return {
      error: false,
      expired: deleted === 0,
      completed: true,
    };
  }

  async clear() {
    const keys = await this.client.keys(`${this.collectionName}:*`);
    if (keys.length) await this.client.del(keys);
    return { error: false, completed: true };
  }

  async size() {
    const keys = await this.client.keys(`${this.collectionName}:*`);
    return { error: false, data: keys.length, completed: true };
  }

  async keys() {
    const keys = await this.client.keys(`${this.collectionName}:*`);
    return {
      error: false,
      data: keys.map(k => k.replace(`${this.collectionName}:`, "")),
      completed: true,
    };
  }

  async close() {
    if (this.client) await this.client.quit();
    this.initialized = false;
    logger.info("Redis connection closed");
    return { error: false, completed: true };
  }
}

export { RedisService };