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
import { readFromCaller, writeToCaller } from '../Utils/FileHandler.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';
import { logger } from '../Utils/logger.js';
import { validateClientUrls } from '../Utils/Validator.js';
import { generateRandomNumber } from '../Utils/valueGenerator.js';
import { PERSISTANT_CLIENT_URLS_FILE_NAME } from '../orion.meta.js';
import { EphemeralDatabaseManager } from '../Utils/Databases/EphemeralDatabases/index.js';
import { HealthCheckModel } from '../Utils/Databases/models/index.js';
import { TokenSecretsManager } from '../Utils/Systems/TokenSecretsManager.js';
import { SignatureSecretsManager } from '../Utils/Systems/SignatureSecretsManager.js';
import { SafeModuleHandler } from '../Utils/UnavailableModuleWrapper.js';
import { KeyVaultManager } from '../Utils/Core/KeyVault/KeyVaultManager.js';
import { EncryptionKeyManager } from '../Utils/Core/KeyVault/EncryptionKeyManager.js';
import { deactivatedFeatures } from '../Utils/Core/KeyVault/EncryptedFieldRegistry.js';
import { validateDataEncryptionConfig } from '../Utils/Core/KeyVault/configSchema.js';
import { announceEncryptionDegraded } from '../Utils/Core/Notifications/NotificationService.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'onStartConfigurations.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'onStartConfigurations.js');

const utilDatabaseLiveCheck = async (maxRetries = 3, retryDelay = 1000) => {
    let attempts = 0;

    while (attempts < maxRetries) {
        attempts++;

        const randomKey = generateRandomNumber(12);
        const randomData = generateRandomNumber(5);

        const writeCheck = await HealthCheckModel.write(randomKey, { data: randomData });

        if (writeCheck.error) {
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts };
        }

        const readCheck = await HealthCheckModel.read(randomKey);

        if (readCheck.error) {
            await HealthCheckModel.remove(randomKey).catch(() => {});
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts };
        }

        const deleteCheck = await HealthCheckModel.remove(randomKey);

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
    let testData = [];

    const NUMBER_OF_TESTS = 15;
    const PASS_PERCENTAGE = 100;

    // Schema migration is already awaited in initiateServer.js, but allow brief settling time
    return await new Promise(resolve => {
        setTimeout(async () => {
            for (let i = 0; i < NUMBER_OF_TESTS; i++) {
                const test = await utilDatabaseLiveCheck();
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
        }, 3000);
    });
};

const utilAuditTrailSystemLiveCheck = async (auditSystem, maxRetries = 3, retryDelay = 1000) => {
    let attempts = 0;

    while (attempts < maxRetries) {
        attempts++;

        try {
            await auditSystem.getLastHash().catch(() => {});

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
    const systemConfig = systemConfigModule.getModule();
    const auditSystemEnabled = systemConfig?.utilities?.auditTrailSystem?.enabled ?? false;

    if (!auditSystemEnabled) {
        logger.info('🧩 AuditTrailSystem disabled — skipping integrity test');
        return;
    }

    const auditSystem = auditTrailSystemModule.probeModule();

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
    const systemConfig = systemConfigModule.getModule();
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

const utilHasMailCredentials = () => {
    const mail = systemConfigModule.getModule()?.mail;
    return !!(mail && mail.service && mail.email && mail.password);
};

const handleConfigValidationForSystemSecurity = () => {
    // NOTE: 'dip' (Data Integrity Protocol) was removed here when that subsystem was
    // decommissioned in favour of TLS 1.3. See Graveyard/.
    const currentConfigurableSystemSecurityModules = ['captcha', 'deviceAuthorization'];
    const systemConfig = systemConfigModule.getModule();
    const accessControlConfig = systemConfig?.utilities?.accessControl || { captcha: 'ENABLED', deviceAuthorization: 'ENABLED' };

    const combinedConfig = { ...accessControlConfig };

    const slug = systemConfig?.api?.slug || '';

    globalAccessPoint.setValue('apiSlug', slug);

    let initalArr = currentConfigurableSystemSecurityModules.map(val => ({ key: val, enabled: true }));
    const givenConfigKeys = Object.keys(combinedConfig);

    for (const key of givenConfigKeys) {
        if (!currentConfigurableSystemSecurityModules.includes(key)) continue;
        const val = combinedConfig[key];
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

const handleMailCredentialConflicts = () => {
    if (utilHasMailCredentials()) return;

    const systemConfig = systemConfigModule.getModule();

    if (globalAccessPoint.deviceAuthorization()) {
        throw new Error(
            'Configuration conflict: Device authorization is enabled but no mail credentials are configured (systemConfig.mail). Device authorization requires sending a one-time code via email. Either provide mail credentials or disable device authorization (utilities.systemSecurity.deviceAuthorization: "DISABLED").'
        );
    }

    if (systemConfig?.authMethods?.totp !== false) {
        if (!systemConfig.authMethods) systemConfig.authMethods = {};
        systemConfig.authMethods.totp = false;
        globalAccessPoint.setValue('totpSystemDisabled', true);
        logger.warn(
            'TOTP has been force-disabled: no mail credentials are configured. TOTP deletion requires an email OTP; allowing registration without deletion would leave accounts in a half-functioning state. Provide mail credentials to re-enable TOTP.'
        );
    }

    if (systemConfig?.authMethods?.passkey !== false) {
        if (!systemConfig.authMethods) systemConfig.authMethods = {};
        systemConfig.authMethods.passkey = false;
        logger.warn(
            'Passkeys have been force-disabled: no mail credentials are configured. Passkey deletion requires an email OTP; allowing registration without deletion would leave accounts in a half-functioning state. Provide mail credentials to re-enable passkeys.'
        );
    }
};

const handleRASValidation = () => {
    const systemConfig = systemConfigModule.getModule();

    const validatedConfig = validateRASCallbacks(systemConfig?.api?.resourceAccessConfig);

    globalAccessPoint.setValue('resourceAccessSystem_Config', validatedConfig);

    return;
};

const handleAllowedUserRolesConfig = () => {
    const systemConfig = systemConfigModule.getModule();

    if (systemConfig?.utilities?.userRoles) {
        if (!Array.isArray(systemConfig?.utilities?.userRoles?.allowedUserRoles)) {
            throw new Error(
                'Configuration error: allowed custom user roles must be a valid array of roles got ' + typeof systemConfig.utilities?.userRoles?.allowedUserRoles
            );
        }

        if (systemConfig.utilities?.userRoles?.allowedUserRoles.length <= 0) {
            throw new Error('Configuration error: allowed custom user roles array is empty');
        }

        globalAccessPoint.setValue(
            'allowedUserRoles',
            systemConfig.utilities?.userRoles?.allowedUserRoles.map(val => val.toUpperCase().trim())
        );

        return;
    }

    globalAccessPoint.setValue('allowedUserRoles', null);

    return;
};

const handleAllowedClientUrlsConfig = async () => {
    const systemConfig = systemConfigModule.getModule();

    const clientUrlsFromConfig = systemConfig?.client?.urls;

    if (!clientUrlsFromConfig) {
        throw new Error('Configuration error: allowed client urls must be given to allow communication between client and server');
    }

    if (!Array.isArray(clientUrlsFromConfig) || clientUrlsFromConfig.length <= 0) {
        throw new Error('Configuration error: allowed client urls must be a valid array with client urls present');
    }

    const runTimeUpdateAllowed = systemConfig.client?.runTimeUpdateAllowed || false;

    const persistentUpdateAllowed = systemConfig.client?.persistentUpdateAllowed || false;

    if (persistentUpdateAllowed && !runTimeUpdateAllowed) {
        throw new Error('Configuration conflict: persistent updates for client urls cannot be enabled while run time client url updates are disabled');
    }

    globalAccessPoint.setValue('clientUrlsRunTimeUpdateAllowed', runTimeUpdateAllowed);
    globalAccessPoint.setValue('clientUrlsPersistentUpdateAllowed', persistentUpdateAllowed);

    if (persistentUpdateAllowed) {
        const fileData = await readFromCaller(PERSISTANT_CLIENT_URLS_FILE_NAME);

        if (fileData.errorCode === 'FILE-OPS::FILE-NOT-FOUND::A::p') {
            await writeToCaller(PERSISTANT_CLIENT_URLS_FILE_NAME, { clientUrls: [...validateClientUrls(clientUrlsFromConfig)] });
        }

        if (!fileData?.data?.clientUrls) {
            // Reset corrupt file
            await writeToCaller(PERSISTANT_CLIENT_URLS_FILE_NAME, { clientUrls: [...validateClientUrls(clientUrlsFromConfig)] });
        }

        if (fileData?.data) {
            await writeToCaller(PERSISTANT_CLIENT_URLS_FILE_NAME, {
                clientUrls: [...validateClientUrls([...fileData.data.clientUrls, ...clientUrlsFromConfig])]
            });
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

// Cluster-mode determination.
//
// This function previously also stood up the ephemeral config store that fed the
// DIP (Data Integrity Protocol) and hybrid transport-encryption subsystems. Both of
// those were decommissioned in favour of TLS 1.3 (see Graveyard/). All that remains
// here is establishing whether the node runs single or cluster mode — the secrets
// managers (TokenSecretsManager / SignatureSecretsManager) still rely on the shared
// Redis instance for cross-node signing-key fan-out.
const handleEphemeralDatabaseSetup = async () => {
    const systemConfig = systemConfigModule.getModule();

    const ephemeralDB = systemConfig?.utilities?.ephemeralDB || { provider: 'LOCAL_DB' };

    if (!ephemeralDB?.provider || (!ephemeralDB?.credentials && ephemeralDB.provider !== 'LOCAL_DB')) {
        throw new Error("Configuration error: Ephemeral database object present but missing 'provider' or 'credentials'");
    }

    if (ephemeralDB.provider === 'LOCAL_DB') {
        globalAccessPoint.setValue('clusterMode', false);
        return;
    }

    if (ephemeralDB.provider === 'REDIS') {
        // Cluster mode: the shared Redis instance is consumed by the secrets managers
        // for cross-node signing-key fan-out.
        const dbManager = await EphemeralDatabaseManager.create(ephemeralDB.provider, ephemeralDB.credentials);
        const db = dbManager.db();

        globalAccessPoint.setValue('clusterMode', true);
        globalAccessPoint.setValue('redisInstance', db);
        return;
    }

    return;
};

// Field encryption at rest.
//
// Runs after handleEphemeralDatabaseSetup because the single-instance/cluster
// distinction it establishes is what decides whether an inline configuration
// key is acceptable at all: one box may hold its own key, a fleet may not.
//
// This function NEVER throws. An unusable key vault deactivates the features
// that depend on encryption (see EncryptedFieldRegistry) and the node serves
// everything else normally — enrolled users fall back to the email one-time
// code rather than being locked out. Failing the boot instead would turn a
// vault outage into a full authentication outage, which is strictly worse than
// running with one factor family disabled.
const handleDataEncryptionSetup = async () => {
    const systemConfig = systemConfigModule.getModule();
    const encryptionConfig = systemConfig?.utilities?.dataEncryption || {};
    const clusterMode = globalAccessPoint.getValue('clusterMode') === true;

    // Structural validation runs FIRST and is fatal. A misspelled key, an
    // unknown provider or a missing required value is deterministic and will
    // never resolve on its own, so starting anyway would mean running without
    // the protection the config claims to configure. That is the one failure
    // mode the degradation path below must not absorb.
    const validation = validateDataEncryptionConfig(systemConfig?.utilities?.dataEncryption, { clusterMode });

    for (const warning of validation.warnings) {
        logger.warn(`Configuration warning: ${warning}`);
    }

    if (!validation.valid) {
        throw new Error(`Configuration error in utilities.dataEncryption:\n  - ${validation.errors.join('\n  - ')}`);
    }

    // Absence is NOT fatal by default: it would break a first run and every
    // existing deployment that has no TOTP users. Operators who want a hard
    // guarantee opt in with `required: true`.
    if (!validation.providerId && encryptionConfig.required === true) {
        throw new Error(
            'Configuration error: utilities.dataEncryption.required is true but no provider is configured. ' +
                'Set utilities.dataEncryption.provider to a key vault, or utilities.dataEncryption.key on a single-instance deployment.'
        );
    }

    const vault = new KeyVaultManager(encryptionConfig, { clusterMode });
    await vault.initialize();
    globalAccessPoint.setValue('keyVaultManager', vault);

    // `key` doubles as the legacy key: rows sealed before this deployment moved
    // to a vault were sealed with sha256 of exactly that string, so keeping it
    // in config lets them be read and re-sealed by a DEK rotation. It can be
    // dropped once rotation reports zero stale rows.
    const encryptionKeyManager = new EncryptionKeyManager(vault, { legacyKey: encryptionConfig.legacyKey || encryptionConfig.key || null });
    const ready = await encryptionKeyManager.initialize();

    globalAccessPoint.setValue('encryptionKeyManager', encryptionKeyManager);
    globalAccessPoint.setValue('fieldEncryptionAvailable', ready);

    if (ready) {
        globalAccessPoint.setValue('deactivatedEncryptedFeatures', []);
        return;
    }

    const features = deactivatedFeatures();
    const reason = encryptionKeyManager.unavailableReason || vault.unavailableReason || 'unknown';

    globalAccessPoint.setValue('deactivatedEncryptedFeatures', features);

    if (features.includes('totp')) {
        if (!systemConfig.authMethods) systemConfig.authMethods = {};
        systemConfig.authMethods.totp = false;
        globalAccessPoint.setValue('totpSystemDisabled', true);
    }

    logger.error(
        `Field encryption is UNAVAILABLE — ${reason}\n` +
            `  Deactivated: ${features.join(', ') || 'none'}.\n` +
            '  Users already enrolled in TOTP are NOT locked out: they fall back to the email one-time code, ' +
            'and their stored secrets are left untouched so they become usable again the moment the vault is reachable.'
    );

    if (!utilHasMailCredentials()) {
        logger.error(
            'No mail credentials are configured either, so the email one-time code fallback is also unavailable. ' +
                'Accounts that rely on TOTP cannot complete a second factor until the key vault is restored.'
        );
    }

    // Best-effort: tell affected users what happened through the notifications
    // plane so they are not left guessing why their authenticator stopped being
    // offered. A failure here must never affect the boot.
    await announceEncryptionDegraded(reason).catch(error => logger.warn(`Could not queue the encryption-degraded notification — ${error.message}`));
};

// Flat registry of every live secrets manager so cluster-plane consumers
// (ClusterLinkSystem's secrets:* commands) can enumerate them without knowing
// the per-domain GAP key naming scheme.
const registerSecretsManager = (kind, domain, manager) => {
    const registry = globalAccessPoint.getValue('secretsManagersRegistry') || [];
    registry.push({ kind, domain, manager });
    globalAccessPoint.setValue('secretsManagersRegistry', registry);
};

const handleTokenSecretsSetup = async () => {
    const defaultDomains = ['access', 'refresh', 'resource'];

    const tokenSecurityTier = systemConfigModule.getModule()?.tokens?.securityTier;

    globalAccessPoint.setValue('tokenSecurityTier', Number(tokenSecurityTier) || 4);

    // Server key for fingerprint digests (see Utils/fingerprintDigest.js). Must be
    // stable across restarts, and identical across cluster nodes, or fingerprint
    // risk signals stop matching.
    //
    // A mismatch cannot grant access — the digest only feeds a risk score — but
    // "it only degrades a signal" understated the effect at the tiers that use
    // it. With no configured key each process invents its own, so after any
    // restart, and on every node that did not mint the token, EVERY fingerprint
    // check fails: a permanent +30 on all traffic. Add an ordinary IP change
    // (+40) and every user in the deployment crosses the step-up threshold at
    // once. That is an availability failure produced by a missing config value,
    // so tiers that actually consult the digest now refuse to boot without it
    // rather than starting into that state.
    const fingerprintDigestKey = systemConfigModule.getModule()?.tokens?.fingerprintDigestKey;
    const tierUsesFingerprint = Number(tokenSecurityTier) >= 3 || !tokenSecurityTier;

    if (fingerprintDigestKey) {
        if (String(fingerprintDigestKey).length < 32) {
            throw new Error('Configuration error: tokens.fingerprintDigestKey must be at least 32 characters');
        }

        globalAccessPoint.setValue('fingerprintDigestKey', fingerprintDigestKey);
    } else if (tierUsesFingerprint) {
        throw new Error(
            'Configuration error: tokens.fingerprintDigestKey is required at security tier 3 and above ' +
                '(the configured tier is ' +
                (tokenSecurityTier || 4) +
                '). Without it each process derives its own key, so device fingerprints never match after a ' +
                'restart or across cluster nodes and every session is pushed into step-up. Set a stable ' +
                'random value of at least 32 characters, identical on every node.'
        );
    }

    // Proof-of-possession binding (DPoP). Opt-in: when enabled, tokens are bound
    // to a non-extractable client key and a stolen token is unusable without it.
    const bindingMode = systemConfigModule.getModule()?.tokens?.binding || 'none';

    if (bindingMode !== 'none' && bindingMode !== 'dpop') {
        throw new Error(`Configuration error: tokens.binding must be "none" or "dpop" (received "${bindingMode}")`);
    }

    globalAccessPoint.setValue('tokenBinding', bindingMode);


    if (bindingMode === 'dpop') {
        logger.info('Token binding: DPoP enabled — tokens are bound to a client-held key and proofs are required on every request.');
    }

    handleSharedSignalsSetup();

    return handleTokenSecretsManagers(defaultDomains);
};

/**
 * Shared Signals Framework (OpenID SSF / CAEP).
 *
 * Off by default: transmitting security events means posting statements about
 * your users to endpoints someone configured, which is not something to switch
 * on implicitly. When it IS on, the issuer is mandatory — every SET's `iss` and
 * every `iss_sub` subject is built from it, and a receiver cannot verify or
 * attribute events without a stable one.
 */
const handleSharedSignalsSetup = () => {
    const ssf = systemConfigModule.getModule()?.sharedSignals || {};
    const enabled = ssf.enabled === true;

    globalAccessPoint.setValue('ssfEnabled', enabled);

    if (!enabled) {
        globalAccessPoint.setValue('ssfIssuer', null);
        globalAccessPoint.setValue('ssfTrustedIssuers', {});
        globalAccessPoint.setValue('ssfManagementToken', null);
        globalAccessPoint.setValue('ssfAllowInsecureDelivery', false);
        return;
    }

    const issuer = ssf.issuer || systemConfigModule.getModule()?.server?.selfUrl;

    if (!issuer) {
        throw new Error(
            'Configuration error: sharedSignals.enabled is true but no sharedSignals.issuer (or server.selfUrl) is set. ' +
                'Every Security Event Token is attributed to this value and receivers key their trust on it.'
        );
    }

    // Stream management decides who receives security events about your users —
    // a caller who can create a stream can have every revocation forwarded to an
    // endpoint they control. That is not something to leave unauthenticated.
    const managementToken = ssf.managementToken;

    if (!managementToken || String(managementToken).length < 32) {
        throw new Error(
            'Configuration error: sharedSignals.managementToken is required (min 32 characters) when Shared Signals is enabled. ' +
                'It guards stream creation, which controls where security events about your users are sent.'
        );
    }

    globalAccessPoint.setValue('ssfIssuer', issuer);
    globalAccessPoint.setValue('ssfManagementToken', managementToken);
    globalAccessPoint.setValue('ssfTrustedIssuers', ssf.trustedIssuers || {});

    // Escape hatch for local development only; SETs name users and describe
    // their security state, so plaintext delivery is refused by default.
    globalAccessPoint.setValue('ssfAllowInsecureDelivery', ssf.allowInsecureDelivery === true);

    const inboundCount = Object.keys(ssf.trustedIssuers || {}).length;
    logger.info(`Shared Signals enabled — issuer ${issuer}, ${inboundCount} trusted inbound issuer(s).`);
};

/** Builds and registers the per-domain token secrets managers. */
const handleTokenSecretsManagers = async defaultDomains => {
    let arr = [];

    for (let i = 0; i < defaultDomains.length; i++) {
        const domain = defaultDomains[i];

        const token_secrets_manager = new TokenSecretsManager(domain, 'ES256', 2);

        arr.push({ domain, token_secrets_manager });
    }

    const initialization = await Promise.all(
        arr.map(async val => {
            await val.token_secrets_manager.initialize();
        })
    );

    arr.forEach(val => {
        globalAccessPoint.setValue(`TOKEN_SECRETS_MANAGER_${val.domain}`, val.token_secrets_manager);
        registerSecretsManager('token', val.domain, val.token_secrets_manager);
    });

    return initialization;
};

const handleSignatureSecretsSetup = async () => {
    const defaultDomains = ['internal'];

    let arr = [];

    for (let i = 0; i < defaultDomains.length; i++) {
        const domain = defaultDomains[i];

        const signatureSecretsManager = new SignatureSecretsManager(domain, 'ES256', 2);

        arr.push({ domain, signatureSecretsManager });
    }

    const initialization = await Promise.all(
        arr.map(async val => {
            await val.signatureSecretsManager.initialize();
        })
    );

    arr.forEach(val => {
        globalAccessPoint.setValue(`SIGNATURE_SECRETS_MANAGER_${val.domain}`, val.signatureSecretsManager);
        registerSecretsManager('signature', val.domain, val.signatureSecretsManager);
    });

    return initialization;
};

const handleOnStartConfiguration = async () => {
    await handleDatabaseLiveCheck();
    await handleAllowedClientUrlsConfig();
    await handleAuditTrailSystemCheck();
    handleConfigValidationForEmailDomains();
    handleConfigValidationForSystemSecurity();
    handleMailCredentialConflicts();
    handleRASValidation();
    handleAllowedUserRolesConfig();
    await handleEphemeralDatabaseSetup();
    await handleDataEncryptionSetup();
    await handleTokenSecretsSetup();
    await handleSignatureSecretsSetup();
};

// handleAllowedUserRolesConfig is exported for unit testing: it is the only
// place the custom-role allowlist reaches globalAccessPoint, and a silent
// failure here disables custom roles entirely without failing the boot.
//
// handleDataEncryptionSetup is exported for the same reason: it is the only
// place that decides whether encryptable features are live, and it is required
// to degrade rather than throw.
export { handleOnStartConfiguration, handleAllowedUserRolesConfig, handleDataEncryptionSetup };
