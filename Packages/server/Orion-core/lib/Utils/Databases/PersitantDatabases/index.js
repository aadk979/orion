import { PostgresService } from './postgres.js';

/**
 * PersistantDatabaseManager — Postgres-only database factory.
 *
 * Initializes a PostgresService from the systemConfig and exposes it via db().
 * MongoDB and Firestore support has been permanently removed.
 */
class PersistantDatabaseManager {
    constructor(systemConfig) {
        const provider = systemConfig?.db?.provider?.toUpperCase();

        if (provider !== 'POSTGRES') {
            throw new Error(
                `Unsupported database provider: "${systemConfig?.db?.provider}". ` + `Orion now supports only PostgreSQL. Set db.provider to "POSTGRES".`
            );
        }

        const credentials = systemConfig?.db?.credentials;

        if (!credentials) {
            throw new Error('Database credentials are required. Provide db.credentials in your system config.');
        }

        this.service = new PostgresService(credentials);
    }

    /**
     * @returns {PostgresService}
     */
    db() {
        return this.service;
    }
}

export { PersistantDatabaseManager };
