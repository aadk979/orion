/**
 * Database Manager and Instance Validator
 * 
 * Provides database instance validation and setup system for Orion.
 * Supports multiple database providers including Firestore, MongoDB and PostgreSQL
 * 
 * NOTE: For PostgreSQL, Orion strictly uses only JSON/NoSQL-like structures
 * which may not allow traditional SQL interactions or manipulations.
 */

import { FirestoreService } from './firestore.js';
import { MongoService } from './mongoDB.js';
import { PostgresService } from './postgres.js';

const supportedProviders = [
  "FIRESTORE",
  "MONGO-DB",
  "POSTGRES"
];

class PersistantDatabaseManager {
  constructor(systemConfig) {
    if (!systemConfig.db.provider || !systemConfig.db.credentials) {
      throw new Error("Database options have not been configured correctly!");
    }

    if (!supportedProviders.includes(systemConfig.db.provider)) {
      throw new Error("The given database provider is not supported!");
    }

    PersistantDatabaseManager.provider = systemConfig.db.provider;
    PersistantDatabaseManager.credentials = systemConfig.db.credentials;

    switch (PersistantDatabaseManager.provider) {
      case "FIRESTORE": {
        const system = new FirestoreService();
        if (!system.initialize(PersistantDatabaseManager.credentials)) {
          throw new Error("Unable to initialize Firestore!");
        }
        PersistantDatabaseManager.system = system;
        break;
      }

      case "MONGO-DB": {
        const system = new MongoService();
        if (!system.initialize(PersistantDatabaseManager.credentials)) {
          throw new Error("Unable to initialize MongoDB!");
        }
        PersistantDatabaseManager.system = system;
        break;
      }

      case "POSTGRES": {
        const system = new PostgresService();
        if (!system.initialize(PersistantDatabaseManager.credentials)) {
          throw new Error("Unable to initialize Postgres!");
        }
        PersistantDatabaseManager.system = system;
        break;
      }
    }
  }

  db() {
    return PersistantDatabaseManager.system;
  }
}

export { PersistantDatabaseManager };