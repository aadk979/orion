import { getFutureUnixTime, isUnixExpired } from './Date&Time.js';

class GlobalAccessPoint {
    static instance;

    constructor() {
        if (GlobalAccessPoint.instance) {
            throw new Error('There can only be one instance of global access point!');
        }

        this._values = {};
        this._lockedKeys = new Set(['db', 'systemConfig', 'volatileSecretsManager', 'oAuthToolKit', 'clusterMode']);
        this._postBootUpdateAllowedKeys = ['systemConfig'];
        this._postBootUpdateAllowedDurationAfterBoot = '1m';
        this._postBootUpdateAllowedExpiry = getFutureUnixTime(this._postBootUpdateAllowedDurationAfterBoot);

        GlobalAccessPoint.instance = this;
    }

    /**
     * Reports a critical access violation.
     *
     * The logger is resolved through our own value map rather than an import, on
     * purpose. GlobalAccessPoint is the root primitive of the tree: importing a
     * consumer created a cycle with logger.js, whose module body registers itself
     * here at top level. Entering that cycle at GlobalAccessPoint left its
     * binding in TDZ and threw `Cannot access 'globalAccessPoint' before
     * initialization` — so merely importing this file first crashed the process.
     * Moving the registration into this file only mirrors the failure to the
     * opposite entry order; removing the edge is what actually fixes it.
     *
     * Falls back to console for the window before logger.js registers itself.
     */
    #critical(message) {
        const registered = this._values.logger;

        if (registered && typeof registered.error === 'function') {
            registered.error(message);
            return;
        }

        console.error(message);
    }

    setValue(name, value) {
        let lockOverride = false;

        if (!isUnixExpired(this._postBootUpdateAllowedExpiry) && this._postBootUpdateAllowedKeys.includes(name)) {
            lockOverride = true;
        }

        if (this._lockedKeys.has(name) && this._values[name] !== undefined && !lockOverride) {
            this.#critical(`CRITICAL: Locked value for key ${name} cannot be overwritten.`);
            return false;
        }

        this._values[name] = value;
        return true;
    }

    getValue(name) {
        if (!(name in this._values) && this._lockedKeys.has(name)) {
            this.#critical(`CRITICAL: Requested value for key ${name} does not exist.`);
            const error = new Error(`GlobalAccessPoint: Missing value for key ${name}`);
            error.keyName = name;
            error.code = 'GAP:$:VALUE_NOT_FOUND';
            throw error;
        }

        return this._values[name];
    }

    removeValue(name) {
        if (this._lockedKeys.has(name)) {
            this.#critical(`CRITICAL: Locked value for key ${name} cannot be removed.`);
            return false;
        }

        delete this._values[name];
        return true;
    }

    // Convenience getters
    /**
     * @returns {import('./Databases/PersitantDatabases/postgres.js').PostgresService | undefined}
     */
    db() {
        return this.getValue('db');
    }

    /**
     * @returns {Object | undefined}
     */
    systemConfig() {
        return this.getValue('systemConfig');
    }

    /**
     * @returns {import('./Systems/VolatileSecretsManager.js').VolatileSecretsManager | undefined}
     */
    volatileSecretsManager() {
        return this.getValue('volatileSecretsManager');
    }

    /**
     * @returns {import('./Core/OAuth/OrionOAuthToolKit.js').OAuthProviderToolkit | undefined}
     */
    oAuthToolKit() {
        return this.getValue('oAuthToolKit');
    }

    /**
     * @returns {import('./Systems/MemoryMonitoringSystem.js').MemoryMonitoringSystem | undefined}
     */
    memoryMonitioringSystem() {
        return this.getValue('memoryMonitioringSystem');
    }

    /**
     * @returns {import('./Systems/AuditTrailSystem.js').AuditTrailSystem | undefined}
     */
    auditTrailSystem() {
        return this.getValue('auditTrailSystem');
    }

    /**
     * @returns {import('./Core/KeyVault/KeyVaultManager.js').KeyVaultManager | undefined}
     */
    keyVaultManager() {
        return this.getValue('keyVaultManager');
    }

    /**
     * Field encryption at rest. Undefined (or `available === false`) means the
     * node has no usable key vault, in which case every encryptable field is
     * deactivated — see Core/KeyVault/EncryptedFieldRegistry.js.
     *
     * @returns {import('./Core/KeyVault/EncryptionKeyManager.js').EncryptionKeyManager | undefined}
     */
    encryptionKeyManager() {
        return this.getValue('encryptionKeyManager');
    }

    /**
     * @returns {typeof import('./logger.js').logger | undefined}
     */
    logger() {
        return this.getValue('logger');
    }

    /**
     * @returns {string | undefined}
     */
    apiSlug() {
        return this.getValue('apiSlug');
    }

    /**
     * @returns {import('./Systems/SignatureSecretsManager.js').SignatureSecretsManager | undefined}
     */
    SIGNATURE_SECRETS_MANAGER_internal() {
        return this.getValue('SIGNATURE_SECRETS_MANAGER_internal');
    }

    /**
     * @returns {Object | undefined}
     */
    captcha() {
        return this.getValue('captcha');
    }

    /**
     * @returns {import('./Databases/EphemeralDatabases/index.js').EphemeralDatabaseManager | undefined}
     */
    ephemeralDB() {
        return this.getValue('ephemeralDB');
    }

    /**
     * @returns {Object | undefined}
     */
    deviceAuthorization() {
        return this.getValue('deviceAuthorization');
    }

    /**
     * @returns {Array<string> | undefined}
     */
    allowedEmailDomains() {
        return this.getValue('allowedEmailDomains');
    }

    /**
     * @returns {Array<string> | undefined}
     */
    allowedClientUrls() {
        return this.getValue('allowedClientUrls');
    }

    /**
     * @returns {Object | undefined}
     */
    resourceAccessSystem_Config() {
        return this.getValue('resourceAccessSystem_Config');
    }

    /**
     * @returns {Object | undefined}
     */
    server() {
        return this.getValue('server');
    }

    /**
     * @returns {boolean | undefined}
     */
    ETS_LOCKDOWN() {
        return this.getValue('ETS_LOCKDOWN');
    }

    /**
     * @returns {number | undefined}
     */
    timeOfLife() {
        return this.getValue('timeOfLife');
    }

    /**
     * @returns {import('./Databases/EphemeralDatabases/redis.js').RedisService | undefined}
     */
    redisInstance() {
        return this.getValue('redisInstance');
    }

    /**
     * @returns {Array<string> | undefined}
     */
    allowedUserRoles() {
        return this.getValue('allowedUserRoles');
    }

    /**
     * @returns {number | undefined}
     */
    tokenSecurityTier() {
        return this.getValue('tokenSecurityTier');
    }

    /**
     * @returns {boolean | undefined}
     */
    clusterMode() {
        return this.getValue('clusterMode');
    }

    /**
     * @returns {import('./Systems/TokenSecretsManager.js').TokenSecretsManager | undefined}
     */
    TOKEN_SECRETS_MANAGER_access() {
        return this.getValue('TOKEN_SECRETS_MANAGER_access');
    }

    /**
     * @returns {import('./Systems/TokenSecretsManager.js').TokenSecretsManager | undefined}
     */
    TOKEN_SECRETS_MANAGER_refresh() {
        return this.getValue('TOKEN_SECRETS_MANAGER_refresh');
    }

    /**
     * @returns {import('./Systems/TokenSecretsManager.js').TokenSecretsManager | undefined}
     */
    TOKEN_SECRETS_MANAGER_resource() {
        return this.getValue('TOKEN_SECRETS_MANAGER_resource');
    }

    /**
     * @returns {import('./Systems/CircuitBreakerSystem.js').CircuitBreakerSystem | undefined}
     */
    circuitBreakerSystem() {
        return this.getValue('circuitBreakerSystem');
    }

    /**
     * @returns {import('./Systems/EventLoopMonitor.js').EventLoopMonitor | undefined}
     */
    eventLoopMonitor() {
        return this.getValue('eventLoopMonitor');
    }

    /**
     * @returns {import('./Systems/LoadSheddingSystem.js').LoadSheddingSystem | undefined}
     */
    loadSheddingSystem() {
        return this.getValue('loadSheddingSystem');
    }

    /**
     * @returns {import('./Systems/AbuseDetectionSystem.js').AbuseDetectionSystem | undefined}
     */
    abuseDetectionSystem() {
        return this.getValue('abuseDetectionSystem');
    }

    /**
     * @returns {boolean | undefined}
     */
    ELM_DEGRADED() {
        return this.getValue('ELM_DEGRADED');
    }

    /**
     * @returns {import('./Systems/ClusterLinkSystem.js').ClusterLinkSystem | undefined}
     */
    clusterLinkSystem() {
        return this.getValue('clusterLinkSystem');
    }

    /**
     * @returns {import('./Systems/DatabaseJanitor.js').DatabaseJanitor | undefined}
     */
    databaseJanitor() {
        return this.getValue('databaseJanitor');
    }

    /**
     * This node's batch mailer — undefined unless utilities.batchMailer.enabled.
     * @returns {import('./Systems/BatchMailer/index.js').BatchMailerSystem | undefined}
     */
    batchMailerSystem() {
        return this.getValue('batchMailerSystem');
    }

    /**
     * Latest cluster health broadcast from the Orion-Orchestrator (or undefined
     * when not clustered / no broadcast received yet).
     * @returns {{state: string, previousState: string, summary: Object, changedAt: number} | undefined}
     */
    clusterState() {
        return this.getValue('clusterState');
    }

    nameSpace() {
        return 'alpine';
    }
}

// Singleton instance
const globalAccessPoint = new GlobalAccessPoint();

export { globalAccessPoint };
