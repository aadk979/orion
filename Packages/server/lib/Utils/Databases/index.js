import { FirestoreService } from './firestore.js';
import { MongoService } from './mongoDB.js';

const supportedProviders = [
    "FIRESTORE",
    "MONGO-DB",
]

function hasNoDuplicateValues(obj) {
  const values = Object.values(obj);
  const uniqueValues = new Set(values);
  return values.length === uniqueValues.size;
}

function hasExactKeysAndValues(obj, count) {
  for (let i = 1; i <= count; i++) {
    const key = `key${i}`;
    if (!(key in obj) || obj[key] === undefined || obj[key] === null) {
      return false;
    }
  }
  return Object.keys(obj).length === count;
}

class DatabaseManager {
    constructor(systemConfig) {
        if (!systemConfig.db.provider || !systemConfig.db.credentials) {
            throw new Error("Database options have not been configured correctly!")
        }

        if (!supportedProviders.includes(systemConfig.db.provider)) {
            throw new Error("The given database provider is not supported!")
        }

        DatabaseManager.provider = systemConfig.db.provider;
        DatabaseManager.credentials = systemConfig.db.credentials;

        switch (DatabaseManager.provider) {
            case supportedProviders[0]: {
                const system = new FirestoreService();
                const initialization = system.initialize(DatabaseManager.credentials);

                if (!initialization) {
                    throw new Error("Unable to initialize database!");
                }

                DatabaseManager.system = system;
                break;
            }

            case supportedProviders[1]: {
                const system = new MongoService();
                const initialization = system.initialize(DatabaseManager.credentials);

                if (!initialization) {
                    throw new Error("Unable to initialize database!");
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

export { DatabaseManager };;