const { FirestoreService } = require("./firestore");
const { MongoService } = require("./mongoDB");

const supportedProviders = [
    "FIRESTORE",
    "MONGO-DB",
]

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
                const system = new FirestoreService(DatabaseManager.credentials);
                const initialization = system.initialize(DatabaseManager.credentials);

                if (!initialization) {
                    throw new Error("Unable to initialize database!");
                }

                DatabaseManager.system = system;
                break;
            }

            case supportedProviders[1]: {
                const system = new MongoService(DatabaseManager.credentials.uri, systemConfig.name);
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