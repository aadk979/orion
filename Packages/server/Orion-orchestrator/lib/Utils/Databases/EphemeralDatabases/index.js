import { RedisService } from './redis.js';
import { InMemoryDB } from './localMemoryDB.js';

class EphemeralDatabaseManager {
    constructor(provider, credentials) {
        switch (provider) {
            case 'REDIS': {
                const system = new RedisService();

                if (!system.initialize(credentials)) {
                    throw new Error('Unable to initialize Redis!');
                }

                EphemeralDatabaseManager.system = system;
                break;
            }

            case 'LOCAL_DB': {
                const system = new InMemoryDB('orionConfigDB');
                EphemeralDatabaseManager.system = system;
                break;
            }
        }
    }

    db() {
        return EphemeralDatabaseManager.system;
    }
}

export { EphemeralDatabaseManager };
