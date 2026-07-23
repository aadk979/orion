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

/**
 * @param {string|null} [dpopJkt] thumbprint of the client key to bind this token
 *   to. Supplied by the sign-in flows when proof-of-possession is enabled;
 *   omitted leaves the token unbound, which is what keeps rollout incremental.
 */
async function generateAccessToken(uid, email, fingerprint, authMethod, role, ip, userAgent, linkCode = null, dpopJkt = null) {
    return generateSessionToken({
        names: { ...KIND, functionName: 'generateAccessToken' },
        modules: MODULES,
        lifespanKey: 'accessTokens',
        identity: { uid, email, fingerprint, authMethod, role, ip, userAgent },
        linkCode: linkCode || generateId('AT_LINK', 10),
        payloadExtras: { email },
        dpopJkt
    });
}

async function validateAccessToken(token, fingerprint, ip, clientUrl, dpopProof = null) {
    return validateSessionToken({
        names: { ...KIND, functionName: 'validateAccessToken' },
        modules: MODULES,
        token,
        fingerprint,
        ip,
        clientUrl,
        dpopProof
    });
}

export { generateAccessToken, validateAccessToken };
