/**
 * This file contains systems that have to be configured on server start or just before
 * All functions for each system must be written seperatley and added to handleOnStartConfiguration finally
 * If an error occurs that is critical, the function must throw and error and not try to propogate the error since these are mission critical errors
 * DO NOT TOUCH IF YOU DO NOT KNOW WHAT YOU ARE DOING
 */

import { validateRASCallbacks } from "../Utils/Core/ResourceAccessManagment/callbackBasedResources/callbackValidator.js";
import { cronScheduler } from "../Utils/Cron.js";
import { readFromCaller, writeToCaller } from "../Utils/FileHandler.js";
import { globalAccessPoint } from "../Utils/GlobalAccessPoint.js"
import { logger } from "../Utils/logger.js";
import { generateRandomNumber } from "../Utils/valueGenerator.js";

const TOKEN_SECRETS_FILE_NAME = "orion.internal.token_secrets.json";

const utilTokenSecretsExport = async () => {
    const tokenSecretsManager = globalAccessPoint.getValue("tokenSecretsManager");

    const tokens = await tokenSecretsManager.massGetJWKs();

    const writeOpp = await writeToCaller(TOKEN_SECRETS_FILE_NAME, tokens);

    cronScheduler.addEvent("TOKEN-SECRETS-AUTO-EXPORT", utilTokenSecretsExport, "1d", {});

    if (writeOpp.error) {
        logger.error("Scheduled token secrets write failed!");
        return;
    }

    return;
}

// This functions default fallback is to wipe the file by setting its value to {}, so no throw error statment is needed
const handleTokenSecretsImport = async () => {
    const tokenSecretsManager = globalAccessPoint.getValue("tokenSecretsManager");

    const fileData = await readFromCaller(TOKEN_SECRETS_FILE_NAME);

    setTimeout(() => {
        utilTokenSecretsExport()
    }, 60_000)

    if (fileData.errorCode === "FILE-NOT-FOUND") {
        const result1 = await writeToCaller(TOKEN_SECRETS_FILE_NAME, {});
        return;
    }

    const secretsImport = tokenSecretsManager.massAddJWKs(fileData.data);

    if (secretsImport?.error) {
        const result2 = await writeToCaller(TOKEN_SECRETS_FILE_NAME, {});
        return;
    }

    return;
}

const utilDatabaseLiveCheck = async (db, maxRetries = 3, retryDelay = 1000) => {
    let attempts = 0;
    
    while (attempts < maxRetries) {
        attempts++;
        
        const randomKey = generateRandomNumber(36);
        const randomData = generateRandomNumber(35);

        const writeCheck = await db.addData("Test", randomKey, { data: randomData });

        if (writeCheck.error) {
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts }
        }

        const readCheck = await db.getData("Test", randomKey);

        if (readCheck.error) {
            // Cleanup before retry
            await db.deleteData("Test", randomKey).catch(() => {});
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts }
        }

        const deleteCheck = await db.deleteData("Test", randomKey);

        if (deleteCheck.error) {
            if (attempts < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            }
            return { error: true, failed: true, attemptsUsed: attempts }
        }

        return { error: false, passed: true, attemptsUsed: attempts }
    }
    
    return { error: true, failed: true, attemptsUsed: attempts }
}

const handleDatabaseLiveCheck = async () => {
    const db = globalAccessPoint.db();
    let testData = [];

    const NUMBER_OF_TESTS = 15;
    const PASS_PERCENTAGE = 100;

    for (let i = 0; i < NUMBER_OF_TESTS; i++) {
        const test = await utilDatabaseLiveCheck(db);
        testData.push(test);
    }

    const passedTests = testData.filter(item => item?.passed === true);
    const passedPercentage = (passedTests.length / NUMBER_OF_TESTS) * 100;

    if (passedPercentage < PASS_PERCENTAGE) {
        throw new Error("Unable to certify database as operational, pass rate for db check test: " + passedPercentage + "%. Database must be fully operational before server start.");
    }

    return;
}

const utilIsValidDomainFormat = (domain) => {
    return typeof domain === 'string' && 
           domain.length > 0 && 
           !domain.includes(' ') && 
           domain.includes('.');
}

const handleConfigValidationForEmailDomains = () => {
    const systemConfig = globalAccessPoint.systemConfig();
    const domains = systemConfig?.authMethods?.allowedEmailDomains;

    if (!domains || domains.length === 0) {
        globalAccessPoint.setValue("allowedEmailDomains", "*");
        logger.warn("No email domains configured, defaulting to ALLOW ALL");
        return;
    }

    const hasWildcard = domains.includes("*");
    const hasSpecificDomains = domains.length > 1 || (domains.length === 1 && domains[0] !== "*");
    
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
        globalAccessPoint.setValue("allowedEmailDomains", "*");
        return;
    }

    if (firstValue === "*") {
        globalAccessPoint.setValue("allowedEmailDomains", "*");
        return;
    }

    globalAccessPoint.setValue("allowedEmailDomains", domains);
}

const utilGetBooleanValuesForSystemSecurityConfig = (status) => {
    return status === "DISABLED" ? false : true;
}

const handleConfigValidationForSystemSecurity = () => {
    const currentConfigurableSystemSecurityModules = [ "dip", "captcha", "deviceAuthorization" ]
    const systemConfig = globalAccessPoint.systemConfig();
    const systemSecurityConfig = systemConfig?.systemSecurity || { dip: 'ENABLED', captcha: "ENABLED", deviceAuthorization: "ENABLED" };

    let initalArr = currentConfigurableSystemSecurityModules.map(val => ({ key: val, enabled: true }));
    const givenConfigKeys = Object.keys(systemSecurityConfig);

    for (const key of givenConfigKeys) {
        const val = systemSecurityConfig[key];
        const status = utilGetBooleanValuesForSystemSecurityConfig(val);

        const filtered = initalArr.filter(val => val.key !== key);

        filtered.push({ key: key, enabled: status });

        initalArr = filtered
    }

    for (const system of initalArr) {
        globalAccessPoint.setValue(system.key, system.enabled);
    }

    return;
}

const handleRASValidation = () => {
    const systemConfig = globalAccessPoint.systemConfig();

    const validatedConfig = validateRASCallbacks(systemConfig?.resourceAccessConfig);

    globalAccessPoint.setValue("resourceAccessSystem_Config", validatedConfig);

    return;
}

const handleAllowedUserRolesConfig = () => {
    const systemConfig = globalAccessPoint.systemConfig();

    if (systemConfig?.userRoles) {

        if (!Array.isArray(systemConfig.userRoles?.allowedUserRoles)) {
            throw new Error("Configuration error: allowed custom user roles must be a valid array of roles got " + typeof systemConfig.userRoles?.allowedUserRoles);
        }

        if (systemConfig.userRoles?.allowedUserRoles.length <= 0) {
            throw new Error("Configuration error: allowed custom user roles array is empty");
        }

        globalAccessPoint.setValue("allowedUserRoles" , systemConfig.userRoles?.allowedUserRoles.map(val => val.toUpperCase().trim()));

        return;
    }

    globalAccessPoint.setValue("allowedUserRoles", null);

    return;
}

const handleOnStartConfiguration = async () => {
    await handleTokenSecretsImport();
    await handleDatabaseLiveCheck();
    handleConfigValidationForEmailDomains();
    handleConfigValidationForSystemSecurity();
    handleRASValidation();
    handleAllowedUserRolesConfig()
}

export { handleOnStartConfiguration }