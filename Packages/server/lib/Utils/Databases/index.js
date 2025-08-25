const { FirestoreService } = require("./firestore");
const { MongoService } = require("./mongoDB");

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

        if (systemConfig.security.advancedSecurityMode) {
            const keys = systemConfig.db.securityKeys;

            if (!keys || typeof keys !== "object") {
                throw new Error("Advanced security mode is active but no database security keys were given, or were given in the wrong fromat!")
            }

            if (!hasExactKeysAndValues(keys, Object.keys(keys).length)) {
                throw new Error("Database security keys configuration do not follow the expected structure or contain unrecognised names!")
            }

            if (Object.keys(keys).length < 5) {
                throw new Error("For Advanced security mode, a minimum of 5 database security keys have to be given!")
            }

            if (!hasNoDuplicateValues(keys)) {
                throw new Error("Duplicate database security keys have been given!")
            }
        }

        DatabaseManager.provider = systemConfig.db.provider;
        DatabaseManager.credentials = systemConfig.db.credentials;

        switch (DatabaseManager.provider) {
            case supportedProviders[0]: {
                const system = new FirestoreService(systemConfig.security.advancedSecurityMode);
                const initialization = system.initialize(DatabaseManager.credentials);

                if (!initialization) {
                    throw new Error("Unable to initialize database!");
                }

                DatabaseManager.system = system;
                break;
            }

            case supportedProviders[1]: {
                const system = new MongoService(systemConfig.security.advancedSecurityMode);
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

module.exports = { DatabaseManager };