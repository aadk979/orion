/**
 * Database Manager and Instance Validator
 * 
 * Provides database instance validation and setup system for Orion.
 * Supports multiple database providers including Firestore, MongoDB, PostgreSQL,
 * and Redis.
 * 
 * NOTE: For PostgreSQL, Orion strictly uses only JSON/NoSQL-like structures
 * which may not allow traditional SQL interactions or manipulations.
 */

import { FirestoreService } from './firestore.js';
import { MongoService } from './mongoDB.js';
import { RedisService } from './redis.js';
import { PostgresService } from './postgres.js';

const supportedProviders = [
  "FIRESTORE",
  "MONGO-DB",
  "REDIS",
  "POSTGRES"
];

class DatabaseManager {
  constructor(systemConfig) {
    if (!systemConfig.db.provider || !systemConfig.db.credentials) {
      throw new Error("Database options have not been configured correctly!");
    }

    if (!supportedProviders.includes(systemConfig.db.provider)) {
      throw new Error("The given database provider is not supported!");
    }

    DatabaseManager.provider = systemConfig.db.provider;
    DatabaseManager.credentials = systemConfig.db.credentials;

    switch (DatabaseManager.provider) {
      case "FIRESTORE": {
        const system = new FirestoreService();
        if (!system.initialize(DatabaseManager.credentials)) {
          throw new Error("Unable to initialize Firestore!");
        }
        DatabaseManager.system = system;
        break;
      }

      case "MONGO-DB": {
        const system = new MongoService();
        if (!system.initialize(DatabaseManager.credentials)) {
          throw new Error("Unable to initialize MongoDB!");
        }
        DatabaseManager.system = system;
        break;
      }

      case "REDIS": {
        const system = new RedisService();
        if (!system.initialize(DatabaseManager.credentials)) {
          throw new Error("Unable to initialize Redis!");
        }
        DatabaseManager.system = system;
        break;
      }

      case "POSTGRES": {
        const system = new PostgresService();
        if (!system.initialize(DatabaseManager.credentials)) {
          throw new Error("Unable to initialize Postgres!");
        }
        DatabaseManager.system = system;
        break;
      }
    }
  }

  db() {
    return DatabaseManager.system;
  }
}

export { DatabaseManager };