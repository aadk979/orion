/**
 * Refresh token issuance + validation.
 *
 * Thin kind-specific wrapper over the shared session token engine — the
 * tier-aware payload/persistence/validation pipeline lives in
 * internals/sessionTokenCore.js. Refresh-specific behavior: the
 * refreshCount/maxRefreshes rotation budget, the expired-row sweep on
 * rotation, and resolving the user's email during stateful validation
 * (stateful refresh payloads don't carry it).
 */
import { UserModel } from '../../Databases/models/index.js';
import { parseDuration } from '../../Date&Time.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { cleanUpTokens } from './TokenCleanup.js';
import { logger } from '../../logger.js';
import { generateSessionToken, validateSessionToken } from './internals/sessionTokenCore.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'RefreshTokens.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'RefreshTokens.js');
const tokenSecretsManagerRefreshModule = new SafeModuleHandler('TokenSecretsManager(refresh)', 'TOKEN_SECRETS_MANAGER_refresh', 'RefreshTokens.js');

const MODULES = {
    secretsModule: tokenSecretsManagerRefreshModule,
    configModule: systemConfigModule,
    auditModule: auditTrailSystemModule
};

const KIND = {
    source: 'RefreshTokens.js',
    errorPrefix: 'TOKEN-REFRESH',
    tokenType: 'REFRESH_TOKEN',
    label: 'refresh'
};

async function generateRefreshToken(
    uid,
    email,
    fingerprint,
    authMethod,
    role,
    ip,
    userAgent,
    accessTokenLinkCodeExternal,
    refreshCount = 0,
    maxRefreshes = null
) {
    // Rotation budget, fixed at first issuance: enough refreshes to cover the
    // refresh window at access-token cadence, plus slack.
    if (maxRefreshes === null) {
        const lifespans = systemConfigModule.getModule().tokens?.lifespans;
        const refreshExpiry = lifespans?.refreshTokens || '15m';
        const accessExpiry = lifespans?.accessTokens || '15m';
        maxRefreshes = Math.floor(parseDuration(refreshExpiry) / parseDuration(accessExpiry)) + 3;
    }

    const result = await generateSessionToken({
        names: { ...KIND, functionName: 'generateRefreshToken' },
        modules: MODULES,
        lifespanKey: 'refreshTokens',
        identity: { uid, email, fingerprint, authMethod, role, ip, userAgent },
        linkCode: accessTokenLinkCodeExternal,
        payloadExtras: { refreshCount, maxRefreshes },
        tier1PayloadExtras: { email },
        // Reap this user's expired token rows. Rotation recurs for every active
        // session and is the point where superseded tokens become garbage, so it
        // doubles as the sweep trigger. Detached deliberately — a failed sweep
        // must never fail token generation.
        onStored: () => cleanUpTokens(uid).catch(err => logger.warn(`RefreshTokens: expired token sweep failed — ${err.message}`))
    });

    if (result.error) return result;

    // Historical result-shape quirk, preserved: tier-1 refresh results never
    // carried the link code (it is still inside the signed payload).
    if (result.securityTier === 1) {
        return { error: false, token: result.token, securityTier: result.securityTier };
    }

    return result;
}

async function validateRefreshToken(token, fingerprint, ip, clientUrl) {
    return validateSessionToken({
        names: { ...KIND, functionName: 'validateRefreshToken' },
        modules: MODULES,
        token,
        fingerprint,
        ip,
        clientUrl,
        onStatefulPayload: async validatedToken => {
            const user = await UserModel.getUserByUid(validatedToken.uid);
            validatedToken.email = user?.email;
        }
    });
}

export { generateRefreshToken, validateRefreshToken };
