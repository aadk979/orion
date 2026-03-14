/**
 * Server Start Configuration Handler
 *
 * Contains systems that must be configured on server start or just before.
 * All functions for each system must be written separately and added to
 * handleOnStartConfiguration finally.
 *
 * If a critical error occurs, the function must throw an error and not
 * attempt to propagate the error, as these are mission-critical errors.
 *
 * WARNING: DO NOT MODIFY THIS FILE UNLESS YOU UNDERSTAND WHAT YOU ARE DOING.
 */

import { validateRASCallbacks } from '../Utils/Core/ResourceAccessManagment/callbackBasedResources/callbackValidator.js';
import { cronScheduler } from '../Utils/Cron.js';
import { readFromCaller, writeToCaller } from '../Utils/FileHandler.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';
import { logger } from '../Utils/logger.js';
import { validateClientUrls } from '../Utils/Validator.js';
import { generateRandomNumber } from '../Utils/valueGenerator.js';
import { PERSISTANT_CLIENT_URLS_FILE_NAME, SIGNATURE_SECRETS_FILE_NAME } from '../orion.meta.js';
import { EphemeralDatabaseManager } from '../Utils/Databases/EphemeralDatabases/index.js';
import { getFutureUnixTime } from '../Utils/Date&Time.js';
import { populateEphemeralConfigs } from '../Utils/Databases/EphemeralDatabases/configPopulator.js';
import { generateNumberedStringsFromTemplate, getRandomElement } from '../Utils/ArrayUtilities.js';
import { TokenSecretsManager } from "../Utils/Systems/TokenSecretsManager.js";
import { SignatureSecretsManager } from "../Utils/Systems/SignatureSecretsManager.js";
import { importPrivateKeyECC } from '../Utils/dedicatedCrypto.js';
import { base64DecodeToUint8 } from '../Utils/Encoders.js';

const utilDatabaseLiveCheck = async (db, maxRetries = 3, retryDelay = 1000) => {
    let attempts = 0;

    while (attempts < maxRetries) {
        attempts++;

        const randomKey = generateRandomNumber(36);
        const randomData = generateRandomNumber(35);

        const writeCheck = await db.addData('Test', randomKey, { data: randomData });

        if (writeCheck.error) {
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts };
        }

        const readCheck = await db.getData('Test', randomKey);

        if (readCheck.error) {
            // Cleanup before retry
            await db.deleteData('Test', randomKey).catch(() => { });
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts };
        }

        const deleteCheck = await db.deleteData('Test', randomKey);

        if (deleteCheck.error) {
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts };
        }

        return { error: false, passed: true, attemptsUsed: attempts };
    }

    return { error: true, failed: true, attemptsUsed: attempts };
};

const handleDatabaseLiveCheck = async () => {
    const db = globalAccessPoint.db();
    let testData = [];

    const NUMBER_OF_TESTS = 15;
    const PASS_PERCENTAGE = 100;

    // The initialization of a db is an async operation executed in a sync manner and hence maybe not be fully completed before test begins hence the timeout
    return await new Promise((resolve) => {
        setTimeout(async () => {
            for (let i = 0; i < NUMBER_OF_TESTS; i++) {
                const test = await utilDatabaseLiveCheck(db);
                testData.push(test);
            }

            const passedTests = testData.filter(item => item?.passed === true);
            const passedPercentage = (passedTests.length / NUMBER_OF_TESTS) * 100;

            if (passedPercentage < PASS_PERCENTAGE) {
                throw new Error(
                    'Unable to certify database as operational, pass rate for db check test: ' +
                    passedPercentage +
                    '%. Database must be fully operational before server start.'
                );
            }

            resolve();
        }, 3000)
    });
};

const utilAuditTrailSystemLiveCheck = async (auditSystem, maxRetries = 3, retryDelay = 1000) => {
    let attempts = 0;

    while (attempts < maxRetries) {
        attempts++;

        try {
            await auditSystem.getLastHash().catch(() => { });

            const record = auditSystem.record({
                user: { uid: 'TEST_UID', email: 'test@orion.local' },
                action: 'SYSTEM-AUDIT-TEST',
                status: 'SUCCESS',
                source: 'SystemStartup',
                functionName: 'utilAuditTrailSystemLiveCheck',
                metadata: { attempt: attempts }
            });

            if (record.error) throw new Error('Insert failed');

            // Force flush the buffered record to the database before querying
            await auditSystem.forceFlush();

            const rows = await auditSystem.query({ action: 'SYSTEM-AUDIT-TEST' });
            if (!rows || rows.length === 0) throw new Error('Read failed');

            const conn = await auditSystem.getPool().getConnection();
            await conn.query("DELETE FROM audit_trail WHERE action = 'SYSTEM-AUDIT-TEST'");
            conn.release();

            return { error: false, passed: true, attemptsUsed: attempts };
        } catch (e) {
            if (attempts < maxRetries) {
                await new Promise(res => setTimeout(res, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts, reason: e.message };
        }
    }

    return { error: true, failed: true, attemptsUsed: attempts };
};

const handleAuditTrailSystemCheck = async () => {
    const systemConfig = globalAccessPoint.systemConfig();
    const auditSystemEnabled = systemConfig?.utilities?.auditTrailSystem?.enabled ?? false;

    if (!auditSystemEnabled) {
        logger.info('🧩 AuditTrailSystem disabled — skipping integrity test');
        return;
    }

    const auditSystem = globalAccessPoint.auditTrailSystem();

    if (!auditSystem) {
        throw new Error('AuditTrailSystem instance not found in globalAccessPoint');
    }

    const result = await utilAuditTrailSystemLiveCheck(auditSystem);

    if (result.error) {
        throw new Error(`AuditTrailSystem integrity test failed after ${result.attemptsUsed} attempts — reason: ${result.reason}`);
    }
};

const utilIsValidDomainFormat = domain => {
    return typeof domain === 'string' && domain.length > 0 && !domain.includes(' ') && domain.includes('.');
};

const handleConfigValidationForEmailDomains = () => {
    const systemConfig = globalAccessPoint.systemConfig();
    const domains = systemConfig?.authMethods?.allowedEmailDomains;

    if (!domains || domains.length === 0) {
        globalAccessPoint.setValue('allowedEmailDomains', '*');
        logger.warn('No email domains configured, defaulting to ALLOW ALL');
        return;
    }

    const hasWildcard = domains.includes('*');
    const hasSpecificDomains = domains.length > 1 || (domains.length === 1 && domains[0] !== '*');

    if (hasWildcard && hasSpecificDomains) {
        throw new Error("Configuration conflict: Cannot mix wildcard '*' with specific domains. Use either ['*'] or specific domains like ['company.com']");
    }

    if (!hasWildcard) {
        const invalidDomains = domains.filter(domain => !utilIsValidDomainFormat(domain));
        if (invalidDomains.length > 0) {
            throw new Error(`Invalid domain format: ${invalidDomains.join(', ')}`);
        }
    }

    const firstValue = domains[0]?.trim();

    if (!firstValue) {
        globalAccessPoint.setValue('allowedEmailDomains', '*');
        return;
    }

    if (firstValue === '*') {
        globalAccessPoint.setValue('allowedEmailDomains', '*');
        return;
    }

    globalAccessPoint.setValue('allowedEmailDomains', domains);
};

const utilGetBooleanValuesForSystemSecurityConfig = status => {
    return status === 'DISABLED' ? false : true;
};

const handleConfigValidationForSystemSecurity = () => {
    const currentConfigurableSystemSecurityModules = ['dip', 'captcha', 'deviceAuthorization'];
    const systemConfig = globalAccessPoint.systemConfig();
    const systemSecurityConfig = systemConfig?.utilities?.systemSecurity || { dip: 'ENABLED', captcha: 'ENABLED', deviceAuthorization: 'ENABLED' };

    const slug = systemConfig?.api?.slug || '';

    globalAccessPoint.setValue('apiSlug', slug);

    let initalArr = currentConfigurableSystemSecurityModules.map(val => ({ key: val, enabled: true }));
    const givenConfigKeys = Object.keys(systemSecurityConfig);

    for (const key of givenConfigKeys) {
        const val = systemSecurityConfig[key];
        const status = utilGetBooleanValuesForSystemSecurityConfig(val);

        const filtered = initalArr.filter(val => val.key !== key);

        filtered.push({ key: key, enabled: status });

        initalArr = filtered;
    }

    for (const system of initalArr) {
        globalAccessPoint.setValue(system.key, system.enabled);
    }

    return;
};

const handleRASValidation = () => {
    const systemConfig = globalAccessPoint.systemConfig();

    const validatedConfig = validateRASCallbacks(systemConfig?.api?.resourceAccessConfig);

    globalAccessPoint.setValue('resourceAccessSystem_Config', validatedConfig);

    return;
};

const handleAllowedUserRolesConfig = () => {
    const systemConfig = globalAccessPoint.systemConfig();

    if (systemConfig?.utilities?.userRoles) {
        if (!Array.isArray(systemConfig?.utilities?.userRoles?.allowedUserRoles)) {
            throw new Error(
                'Configuration error: allowed custom user roles must be a valid array of roles got ' + typeof systemConfig.userRoles?.allowedUserRoles
            );
        }

        if (systemConfig.utilities?.userRoles?.allowedUserRoles.length <= 0) {
            throw new Error('Configuration error: allowed custom user roles array is empty');
        }

        globalAccessPoint.setValue(
            'allowedUserRoles',
            systemConfig.utilites?.userRoles?.allowedUserRoles.map(val => val.toUpperCase().trim())
        );

        return;
    }

    globalAccessPoint.setValue('allowedUserRoles', null);

    return;
};

const handleAllowedClientUrlsConfig = async () => {
    const systemConfig = globalAccessPoint.systemConfig();

    const clientUrlsFromConfig = systemConfig?.client?.urls;

    if (!clientUrlsFromConfig) {
        throw new Error('Configuration error: allowed client urls must be given to allow communication between client and server');
    }

    if (!Array.isArray(clientUrlsFromConfig) || clientUrlsFromConfig.length <= 0) {
        throw new Error('Configuration error: allowed client urls must be a valid array with client urls present');
    }

    const runTimeUpdateAllowed = systemConfig.client?.runTimeUpdateAllowed || false;

    const persistantUpdateAllowed = systemConfig.client?.persistantUpdateAllowed || false;

    if (persistantUpdateAllowed && !runTimeUpdateAllowed) {
        throw new Error('Configuration conflict: persistant updates for client urls cannot be enabled while run time client url updates are disabled');
    }

    globalAccessPoint.setValue('clientUrlsRunTimeUpdateAllowed', runTimeUpdateAllowed);
    globalAccessPoint.setValue('clientUrlsPersistantUpdateAllowed', persistantUpdateAllowed);

    if (persistantUpdateAllowed) {
        const fileData = await readFromCaller(PERSISTANT_CLIENT_URLS_FILE_NAME);

        if (fileData.errorCode === 'FILE-NOT-FOUND') {
            await writeToCaller(PERSISTANT_CLIENT_URLS_FILE_NAME, { clientUrls: [...validateClientUrls(clientUrlsFromConfig)] });
        }

        if (!fileData?.data?.clientUrls) {
            // Reset corrupt file
            await writeToCaller(PERSISTANT_CLIENT_URLS_FILE_NAME, { clientUrls: [...validateClientUrls(clientUrlsFromConfig)] });
        }

        if (fileData?.data) {
            await writeToCaller(PERSISTANT_CLIENT_URLS_FILE_NAME, { clientUrls: [...validateClientUrls([...fileData.data.clientUrls, ...clientUrlsFromConfig])] });
        }

        globalAccessPoint.setValue(
            'allowedClientUrls',
            fileData?.data?.clientUrls
                ? [...validateClientUrls([...fileData.data.clientUrls, ...clientUrlsFromConfig])]
                : validateClientUrls(clientUrlsFromConfig)
        );

        return;
    }

    globalAccessPoint.setValue('allowedClientUrls', validateClientUrls(clientUrlsFromConfig));

    return;
};

const decodeRedisEncryptionGroup = async groupData => {
    if (!Array.isArray(groupData)) return groupData;

    return Promise.all(
        groupData.map(async config => {
            if (config.alg !== 'ECC' || !config.privateKey) return config;

            // ECC private key was stored as base64(pkcs8) by the orchestrator
            const curve = `P-${config.size || 256}`;
            const pkcs8Bytes = base64DecodeToUint8(config.privateKey);
            const restoredKey = await importPrivateKeyECC(pkcs8Bytes, curve);

            return { ...config, privateKey: restoredKey };
        })
    );
};

const refreshEphemeralRedisConfigs = async () => {
    try {
        const redisInstance = globalAccessPoint.redisInstance();

        if (!redisInstance) {
            logger.error('refreshEphemeralRedisConfigs: No Redis instance found on globalAccessPoint — skipping refresh');
            return;
        }

        const configKeys = await redisInstance.keys();
        const dipConfigKeys = configKeys.data.filter(val => val.startsWith('DIP_GROUP'));
        const encryptionConfigKeys = configKeys.data.filter(val => val.startsWith('ENCRYPTION_GROUP'));

        const freshDbManager = await EphemeralDatabaseManager.create('LOCAL_DB');
        const freshDb = freshDbManager.db();

        await Promise.all([
            ...dipConfigKeys.map(async dipGroup => {
                const data = await redisInstance.getData(dipGroup);
                if (!data.error && data.data !== undefined) {
                    await freshDb.addData(dipGroup, data.data);
                }
            }),
            ...encryptionConfigKeys.map(async encryptionGroup => {
                const data = await redisInstance.getData(encryptionGroup);
                if (!data.error && data.data !== undefined) {
                    const decoded = await decodeRedisEncryptionGroup(data.data);
                    await freshDb.addData(encryptionGroup, decoded);
                }
            })
        ]);

        const oldDb = globalAccessPoint.ephemeralDB();
        if (oldDb && typeof oldDb.clear === 'function') {
            await oldDb.clear();
        }

        globalAccessPoint.setValue('ephemeralDB', freshDb);
        globalAccessPoint.setValue('dipConfigsAvailable', dipConfigKeys);
        globalAccessPoint.setValue('encryptionConfigsAvailable', encryptionConfigKeys);

        logger.info(`✅ Ephemeral Redis config refresh complete — ${dipConfigKeys.length} DIP group(s), ${encryptionConfigKeys.length} encryption group(s)`);
    } catch (err) {
        logger.error('refreshEphemeralRedisConfigs: Refresh failed —', err.message);
    }
};

const handleEphemeralDatabaseSetup = async () => {
    const dipActive = globalAccessPoint.dip();
    const encryptionActive = true;

    const configExp = getFutureUnixTime('24h');
    const systemConfig = globalAccessPoint.systemConfig();

    const ephemeralDB = systemConfig?.utilities?.ephemeralDB || { provider: 'LOCAL_DB' };

    if (!ephemeralDB?.provider || (!ephemeralDB?.credentials && ephemeralDB.provider !== 'LOCAL_DB')) {
        throw new Error("Configuration error: Ephemeral database object present but missing 'provider' or 'credentials'");
    }

    let numberOfDipConfigs = 5;
    let numberOfEncryptionConfigs = 5;

    if (systemConfig?.utilities?.numberOfDipConfigs && !Number.isNaN(Number(systemConfig?.utilities?.numberOfDipConfigs))) {
        const n = Math.ceil(Number(systemConfig.utilities.numberOfDipConfigs) / 5) * 5;
        numberOfDipConfigs = Math.max(numberOfDipConfigs, n);
    }

    if (systemConfig?.utilities?.numberOfEncryptionConfigs && !Number.isNaN(Number(systemConfig?.utilities?.numberOfEncryptionConfigs))) {
        const n = Math.ceil(Number(systemConfig.utilities.numberOfEncryptionConfigs) / 5) * 5;
        numberOfEncryptionConfigs = Math.max(numberOfEncryptionConfigs, n);
    }

    const dbManager = await EphemeralDatabaseManager.create(ephemeralDB.provider, ephemeralDB.credentials);
    const db = dbManager.db();

    if (ephemeralDB.provider === 'LOCAL_DB') {
        globalAccessPoint.setValue('ephemeralDB', db);

        globalAccessPoint.setValue('dipConfigsAvailable', generateNumberedStringsFromTemplate('DIP_GROUP[<i>]', numberOfDipConfigs / 5));
        globalAccessPoint.setValue('encryptionConfigsAvailable', generateNumberedStringsFromTemplate('ENCRYPTION_GROUP[<i>]', numberOfEncryptionConfigs / 5));

        const population = await populateEphemeralConfigs({ db, values: { dipActive, encryptionActive, numberOfDipConfigs, numberOfEncryptionConfigs, configExp } });

        return population;
    }

    if (ephemeralDB.provider === 'REDIS') {
        // The redis instance is the regional instance shared by the nodes and is populated and rotated by the orchestrator.
        // For the redis option, the system pulls configs from redis and creates a new local in-memory DB.
        // The system will then periodically re-pull every 10 min and overwrite the old in-memory configs.
        // Direct redis integration was not used for speed — batch updates every 10 min keep latency low.
        // Both LOCAL_DB and REDIS paths ultimately use the same local ephemeral DB interface.

        const dbManagerLocal = await EphemeralDatabaseManager.create('LOCAL_DB');

        const configKeys = await db.keys();
        const dipConfigKeys = configKeys.data.filter(val => val.startsWith('DIP_GROUP'));
        const encryptionConfigKeys = configKeys.data.filter(val => val.startsWith('ENCRYPTION_GROUP'));

        await Promise.all([
            ...dipConfigKeys.map(async dipGroup => {
                const data = await db.getData(dipGroup);
                await dbManagerLocal.db().addData(dipGroup, data.data);
            }),
            ...encryptionConfigKeys.map(async encryptionGroup => {
                const data = await db.getData(encryptionGroup);
                const decoded = await decodeRedisEncryptionGroup(data.data);
                await dbManagerLocal.db().addData(encryptionGroup, decoded);
            })
        ]);

        globalAccessPoint.setValue('clusterMode', true);
        globalAccessPoint.setValue('redisInstance', db);
        globalAccessPoint.setValue('ephemeralDB', dbManagerLocal.db());
        globalAccessPoint.setValue('dipConfigsAvailable', dipConfigKeys);
        globalAccessPoint.setValue('encryptionConfigsAvailable', encryptionConfigKeys);

        // Schedule periodic re-sync from Redis every 10 minutes
        cronScheduler.addEvent('ephemeralDB_redis_refresh', refreshEphemeralRedisConfigs, '10m', {});

        return;
    }

    return;
};

const handleTokenSecretsSetup = async () => {

    const defaultDomains = ["access", "refresh", "resource"];

    const token_security_tier = globalAccessPoint.systemConfig()?.tokens?.security_tier;

    globalAccessPoint.setValue("token_security_tier", Number(token_security_tier) || 4)

    let arr = [];

    for (let i = 0; i < defaultDomains.length; i++) {
        const domain = defaultDomains[i];

        const token_secrets_manager = new TokenSecretsManager(domain, "ES256", 2);

        arr.push({ domain, token_secrets_manager });
    }

    const initialization = await Promise.all(arr.map(async val => {
        await val.token_secrets_manager.initialize();
    }));

    arr.forEach(val => {
        globalAccessPoint.setValue(`TOKEN_SECRETS_MANAGER_${val.domain}`, val.token_secrets_manager);
    });

    return initialization;

}

const handleSignatureSecretsSetup = async () => {
    const defaultDomains = ["internal"];

    let arr = [];

    for (let i = 0; i < defaultDomains.length; i++) {
        const domain = defaultDomains[i];

        const signatureSecretsManager = new SignatureSecretsManager(domain, "ES256", 2);

        arr.push({ domain, signatureSecretsManager });
    }

    const initialization = await Promise.all(arr.map(async val => {
        await val.signatureSecretsManager.initialize();
    }));

    arr.forEach(val => {
        globalAccessPoint.setValue(`SIGNATURE_SECRETS_MANAGER_${val.domain}`, val.signatureSecretsManager);
    });

    return initialization;
};

const handleOnStartConfiguration = async () => {
    await handleDatabaseLiveCheck();
    await handleAllowedClientUrlsConfig();
    await handleAuditTrailSystemCheck();
    handleConfigValidationForEmailDomains();
    handleConfigValidationForSystemSecurity();
    handleRASValidation();
    handleAllowedUserRolesConfig();
    await handleEphemeralDatabaseSetup();
    await handleTokenSecretsSetup();
    await handleSignatureSecretsSetup();
};

export { handleOnStartConfiguration, refreshEphemeralRedisConfigs };
