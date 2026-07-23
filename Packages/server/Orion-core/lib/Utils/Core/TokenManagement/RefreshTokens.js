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
import { TokenModel, ConsumedRefreshTokenModel } from '../../Databases/models/index.js';
import { parseDuration, getFutureUnixTime } from '../../Date&Time.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { cleanUpTokens } from './TokenCleanup.js';
import { logger } from '../../logger.js';
import { generateSessionToken, validateSessionToken } from './internals/sessionTokenCore.js';
import { decodeTokenIdWithoutVerification } from './internals/jwtCodec.js';
import { revokeTokensByLinkCode, revokeAllTokensForUser } from './TokenRevocation.js';

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
    const result = await validateSessionToken({
        names: { ...KIND, functionName: 'validateRefreshToken' },
        modules: MODULES,
        token,
        fingerprint,
        ip,
        clientUrl,
        // The account row was already loaded by the shared validator's account
        // gate; reuse it rather than issuing a second query for the same user.
        onStatefulPayload: async (validatedToken, accountState) => {
            validatedToken.email = accountState?.email;
        }
    });

    // Reuse detection. A rotated refresh token is deleted from `tokens`, so a
    // replay of it surfaces above as TOKEN-ID-NOT-FOUND — which is
    // indistinguishable from a token that never existed unless we remember the
    // ids we retired. If this id is in the consumed set, the token was captured
    // and replayed after the legitimate holder rotated it, and we cannot tell
    // which party is which: revoke the entire session family.
    if (result.error && result.errorCode === 'TOKEN-REFRESH::TOKEN-ID-NOT-FOUND::A::p') {
        const replayedId = decodeTokenIdWithoutVerification(token);

        if (replayedId) {
            const consumed = await ConsumedRefreshTokenModel.find(replayedId);

            if (consumed) {
                logger.error(
                    `RefreshTokens: reuse detected for retired token ${replayedId} (uid ${consumed.user_uid}) — revoking session family ${consumed.link_code || 'n/a'}`
                );

                if (consumed.link_code) {
                    await revokeTokensByLinkCode(consumed.link_code, {
                        uid: consumed.user_uid,
                        reason: 'refresh-token-reuse-detected',
                        revokedBy: 'SYSTEM'
                    }).catch(err => logger.error(`RefreshTokens: family revocation failed — ${err.message}`));
                } else {
                    await revokeAllTokensForUser(consumed.user_uid, {
                        reason: 'refresh-token-reuse-detected',
                        revokedBy: 'SYSTEM'
                    }).catch(err => logger.error(`RefreshTokens: user revocation failed — ${err.message}`));
                }

                return { error: true, errorCode: 'TOKEN-REFRESH::REUSE-DETECTED::A::p' };
            }
        }
    }

    return result;
}

/**
 * Retires a refresh token at rotation: deletes its row so it stops validating,
 * and remembers its id until just past its natural expiry so a later replay is
 * recognised as reuse rather than as an unknown token.
 *
 * Best-effort by design — a bookkeeping failure must not block the rotation that
 * is already in flight — but a failure to DELETE is escalated, because that is
 * the half that keeps the old token alive.
 *
 * @param {object} validatedRefreshPayload  the decoded payload of the token being rotated away
 */
async function retireRefreshToken(validatedRefreshPayload) {
    const tokenId = validatedRefreshPayload?.tokenData?.tokenId;
    const uid = validatedRefreshPayload?.uid;

    // Tier 1 has no row and no id — nothing to retire.
    if (!tokenId || !uid) return;

    const linkCode = validatedRefreshPayload?.tokenData?.accessTokenLinkCode || validatedRefreshPayload?.accessTokenLinkCode || null;

    const lifespan = systemConfigModule.getModule().tokens?.lifespans?.refreshTokens || '15m';

    try {
        await ConsumedRefreshTokenModel.record({
            tokenId,
            uid,
            linkCode,
            expiresAt: getFutureUnixTime(lifespan)
        });
    } catch (err) {
        logger.warn(`RefreshTokens: could not record retired token ${tokenId} — reuse detection degraded (${err.message})`);
    }

    try {
        await TokenModel.deleteToken(tokenId);
    } catch (err) {
        logger.error(`RefreshTokens: FAILED to delete rotated token ${tokenId} — it remains replayable (${err.message})`);
    }
}

export { generateRefreshToken, validateRefreshToken, retireRefreshToken };
