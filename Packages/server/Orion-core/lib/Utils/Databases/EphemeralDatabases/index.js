import { RedisService } from './redis.js';
import { InMemoryDB } from './localMemoryDB.js';

class EphemeralDatabaseManager {
    static async create(provider, credentials) {
        const instance = new EphemeralDatabaseManager();

        switch (provider) {
            case 'REDIS': {
                const system = new RedisService();
                const ok = await system.initialize(credentials);

                if (!ok) {
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

            default:
                throw new Error(`Unknown ephemeral DB provider: ${provider}`);
        }

        return instance;
    }

    db() {
        return EphemeralDatabaseManager.system;
    }
}

export { EphemeralDatabaseManager };
