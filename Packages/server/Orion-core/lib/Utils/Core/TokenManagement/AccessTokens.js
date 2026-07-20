/**
 * Access token issuance + validation.
 *
 * Thin kind-specific wrapper over the shared session token engine — the
 * tier-aware payload/persistence/validation pipeline lives in
 * internals/sessionTokenCore.js.
 */
import { generateId } from '../../valueGenerator.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { generateSessionToken, validateSessionToken } from './internals/sessionTokenCore.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'AccessTokens.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'AccessTokens.js');
const tokenSecretsManagerAccessModule = new SafeModuleHandler('TokenSecretsManager(access)', 'TOKEN_SECRETS_MANAGER_access', 'AccessTokens.js');

const MODULES = {
    secretsModule: tokenSecretsManagerAccessModule,
    configModule: systemConfigModule,
    auditModule: auditTrailSystemModule
};

const KIND = {
    source: 'AccessTokens.js',
    errorPrefix: 'TOKEN-ACCESS',
    tokenType: 'ACCESS_TOKEN',
    label: 'access'
};

async function generateAccessToken(uid, email, fingerprint, authMethod, role, ip, userAgent) {
    return generateSessionToken({
        names: { ...KIND, functionName: 'generateAccessToken' },
        modules: MODULES,
        lifespanKey: 'accessTokens',
        identity: { uid, email, fingerprint, authMethod, role, ip, userAgent },
        linkCode: generateId('AT_LINK', 10),
        payloadExtras: { email }
    });
}

async function validateAccessToken(token, fingerprint, ip, clientUrl) {
    return validateSessionToken({
        names: { ...KIND, functionName: 'validateAccessToken' },
        modules: MODULES,
        token,
        fingerprint,
        ip,
        clientUrl
    });
}

export { generateAccessToken, validateAccessToken };
