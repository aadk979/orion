/**
 * Shared engine for the two session token kinds (access + refresh).
 *
 * AccessTokens.js and RefreshTokens.js were near-identical copies; everything
 * both kinds do — tier-aware payload assembly, DB persistence for stateful
 * tiers, signing, and the mirrored validation pipeline — lives here once.
 * Kind-specific details (error-code prefix, audit labels, lifespan config
 * key, extra payload fields, post-store / stateful-validation hooks) are
 * passed in via the spec object by the thin per-kind wrappers.
 *
 * Result shapes and error codes are contract: the authentication middleware
 * and sign-in flows consume them positionally and by exact code string.
 */
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { TokenModel, UserModel } from '../../../Databases/models/index.js';
import { generateId } from '../../../valueGenerator.js';
import { getFutureUnixTime } from '../../../Date&Time.js';
import { requestContext } from '../../../../Server/Middleware/requestMetadata.js';
import { compressURLs, decompressURLs } from '../../../Compressor.js';
import { toShortPayload, toVerbosePayload } from '../tokenFieldMap.js';
import { recordTokenEvent } from './tokenAudit.js';
import { decodeKeyId, signWithKeyPair, verifyWithKeyPair } from './jwtCodec.js';
import { buildTierBinding, assessTierRisk } from './tierBinding.js';
import { isJtiRevoked } from './jtiDenylist.js';
import { verifyDpopProof } from './dpop.js';

const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * @param {object} spec
 * @param {object} spec.names   { source, functionName, errorPrefix, tokenType, label }
 * @param {object} spec.modules { secretsModule, configModule, auditModule } — SafeModuleHandlers
 * @param {string} spec.lifespanKey        key under systemConfig tokens.lifespans
 * @param {object} spec.identity           { uid, email, fingerprint, authMethod, role, ip, userAgent }
 * @param {string} spec.linkCode           access-token link code carried by this token
 * @param {object} [spec.payloadExtras]    extra JWT payload fields for every tier
 * @param {object} [spec.tier1PayloadExtras] extra JWT payload fields for tier 1 only
 * @param {Function} [spec.onStored]       fire-and-forget hook after a successful DB store
 */
async function generateSessionToken(spec) {
    const {
        names: { source, functionName, errorPrefix, tokenType, label },
        modules: { secretsModule, configModule, auditModule },
        lifespanKey,
        identity: { uid, email, fingerprint, authMethod, role, ip, userAgent },
        linkCode,
        payloadExtras = {},
        tier1PayloadExtras = {},
        onStored = null,
        dpopJkt = null
    } = spec;

    const securityTier = globalAccessPoint.tokenSecurityTier();
    const secret = await secretsModule.getModule().getRandomSigningKeyPair();
    const expiry = configModule.getModule().tokens?.lifespans[lifespanKey] || '15m';

    const payload = {
        uid,
        authMethod,
        role,
        securityTier,
        accessTokenLinkCode: linkCode,
        // Confirmation claim (RFC 7800). When proof-of-possession is enabled the
        // token is bound to the thumbprint of a key the client holds
        // non-extractably, and validation demands a signature from that key —
        // so possessing the token is no longer sufficient to use it.
        ...(dpopJkt ? { cnf: { jkt: dpopJkt } } : {}),
        ...payloadExtras,

        // Standard JWT fields
        aud: compressURLs(globalAccessPoint.allowedClientUrls()),
        iss: compressURLs(configModule.getModule().server.urls)
    };

    const auditBase = { source, functionName, ip, user: { email, uid } };

    // Tier 1: stateless — sign and go, nothing persisted
    if (securityTier === 1) {
        Object.assign(payload, tier1PayloadExtras);

        // A per-token id even though nothing is stored: it is what makes targeted
        // revocation possible at tier 1 (see internals/jtiDenylist.js). Without
        // it, "sign out this device" had no handle to revoke.
        payload.jti = generateId(tokenType, 15);

        recordTokenEvent(auditModule, {
            ...auditBase,
            device: { userAgent },
            action: `${tokenType}_GENERATION_SUCCESS`,
            status: 'SUCCESS',
            impact: `Stateless ${label} token generated (Tier 1)`,
            metadata: { authMethod, role, expiry, securityTier }
        });

        const token = signWithKeyPair(secret, toShortPayload(payload), expiry);
        return { error: false, token, accessTokenLinkCode: linkCode, securityTier };
    }

    // Tiers 2-4: stateful — the link code moves out of the flat payload into
    // the DB row and the tokenData envelope
    delete payload.accessTokenLinkCode;

    const tokenData = {
        tokenId: generateId(tokenType, 15),
        type: tokenType,
        accessTokenLinkCode: linkCode
    };
    payload.tokenData = tokenData;

    const binding = await buildTierBinding(securityTier, { fingerprint, ip });
    Object.assign(payload, binding.payloadFields);

    const storage = await TokenModel.createToken({
        tokenId: tokenData.tokenId,
        uid,
        type: tokenType,
        expiry: getFutureUnixTime(expiry),
        userAgent,
        linkCode,
        securityTier,
        dpopJkt,
        ...binding.dbFields
    });

    if (storage.error) {
        const errorCode = `${errorPrefix}::GENERATION-FAILED::A::i`;
        recordTokenEvent(auditModule, {
            ...auditBase,
            device: { fingerprint, userAgent },
            action: `${tokenType}_GENERATION_ATTEMPT`,
            status: 'FAILED',
            impact: `${capitalize(label)} token generation failed - database error`,
            metadata: { reason: 'DATABASE_ERROR', authMethod, role, securityTier },
            errorCode
        });
        return { error: true, errorCode };
    }

    if (onStored) onStored();

    const token = signWithKeyPair(secret, toShortPayload(payload), expiry);

    recordTokenEvent(auditModule, {
        ...auditBase,
        device: { fingerprint, userAgent },
        action: `${tokenType}_GENERATION_SUCCESS`,
        status: 'SUCCESS',
        impact: `${capitalize(label)} token generated successfully (${securityTier})`,
        metadata: { authMethod, role, expiry, tokenId: tokenData.tokenId, securityTier }
    });

    return { error: false, token, accessTokenLinkCode: linkCode, securityTier };
}

/**
 * @param {object} spec
 * @param {object} spec.names   { source, functionName, errorPrefix, tokenType, label }
 * @param {object} spec.modules { secretsModule, configModule, auditModule }
 * @param {string} spec.token
 * @param {string} spec.fingerprint
 * @param {string} spec.ip
 * @param {string} spec.clientUrl
 * @param {Function} [spec.onStatefulPayload] async hook to enrich the decoded
 *   payload before stateful checks (refresh uses it to resolve the email)
 */
async function validateSessionToken(spec) {
    const {
        names: { source, functionName, errorPrefix, tokenType, label },
        modules: { secretsModule, configModule, auditModule },
        token,
        fingerprint,
        ip,
        clientUrl,
        onStatefulPayload = null,
        dpopProof = null
    } = spec;

    const requestMetadata = requestContext.getStore();
    const configuredSecurityTier = globalAccessPoint.tokenSecurityTier();

    try {
        if (!token) {
            recordTokenEvent(auditModule, {
                source,
                functionName,
                ip,
                user: {},
                device: { fingerprint, userAgent: requestMetadata?.userAgent },
                action: `${tokenType}_VALIDATION_ATTEMPT`,
                status: 'FAILED',
                impact: `${capitalize(label)} token validation failed - missing token`,
                metadata: { reason: 'MISSING_TOKEN' },
                errorCode: 'AUTH::MISSING-TOKEN::A::p'
            });
            return { error: true, errorCode: 'AUTH::MISSING-TOKEN::A::p' };
        }

        const keyId = decodeKeyId(token);
        if (!keyId) {
            return { error: true, errorCode: `${errorPrefix}::VALIDATION-FAILED::A::p` };
        }

        const secret = await secretsModule.getModule().findKeyPair(keyId);
        if (!secret) {
            return { error: true, errorCode: `${errorPrefix}::KEY-NOT-FOUND::A::i` };
        }

        const verification = verifyWithKeyPair(token, secret);
        if (!verification.valid) {
            return {
                error: true,
                errorCode: verification.expired ? `${errorPrefix}::EXPIRED::A::p` : `${errorPrefix}::VALIDATION-FAILED::A::p`
            };
        }

        const validatedToken = toVerbosePayload(verification.payload);

        // Restore compressed URLs to original form
        validatedToken.aud = decompressURLs(validatedToken.aud);
        validatedToken.iss = decompressURLs(validatedToken.iss);

        // Audience must be carried by the TOKEN. The previous disjunction also
        // accepted any client in the server-wide allowlist, which every request
        // reaching this point already satisfies (originVerifier ran first) — so
        // the token's own aud claim could never decide anything.
        if (!validatedToken.aud.includes(clientUrl)) {
            return { error: true, errorCode: `${errorPrefix}::INVALID-AUD::A::p` };
        }

        const serverUrl = configModule.getModule().server.selfUrl;
        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: `${errorPrefix}::ISS-NOT-ALLOWED::A::p` };
        }

        const securityTier = validatedToken.securityTier;
        if (securityTier !== configuredSecurityTier) {
            return { error: true, errorCode: `${errorPrefix}::TIER-CONFLICT::A::i` };
        }

        // Proof-of-possession gate. A token carrying a cnf.jkt is only usable by
        // whoever can sign with the matching key, so a stolen token is inert
        // without it. Enforced before any database work — it is cheap and it is
        // the strongest signal available.
        const boundJkt = validatedToken.cnf?.jkt || null;

        if (boundJkt) {
            const proofResult = await verifyDpopProof({
                proof: dpopProof,
                method: requestMetadata?.method || 'POST',
                url: requestMetadata?.requestUri || clientUrl,
                accessToken: token,
                expectedJkt: boundJkt
            });

            if (!proofResult.valid) {
                return { error: true, errorCode: `${errorPrefix}::PROOF-REQUIRED::A::p`, reason: proofResult.reason };
            }
        }

        // Account state gate — applies to EVERY tier, including stateless tier 1.
        //
        // Deleting token rows cannot express "this user's sessions are over" for
        // tier 1, and it also cannot express "this account is disabled" for any
        // tier, because validation never used to read the user at all. Both are
        // resolved here: a disabled/deleted user is refused outright, and any
        // token issued before the user's invalidation watermark is dead even if
        // its signature and expiry are still good.
        const accountState = await UserModel.getUserByUid(validatedToken.uid);

        if (!accountState) {
            return { error: true, errorCode: `${errorPrefix}::VALIDATION-FAILED::A::p` };
        }

        if (accountState.disabled) {
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-DISABLED::A::p' };
        }

        const validFrom = accountState.sessions_valid_from ? Math.floor(new Date(accountState.sessions_valid_from).getTime() / 1000) : 0;

        // `iat` is stamped by jwt.sign and survives the field-map round trip.
        if (validFrom > 0 && typeof validatedToken.iat === 'number' && validatedToken.iat < validFrom) {
            return { error: true, errorCode: `${errorPrefix}::SESSION-INVALIDATED::A::p` };
        }

        // Tier 1: stateless — signature, the account gate above, and the
        // revocation denylist are the whole story.
        if (securityTier === 1) {
            if (validatedToken.jti && (await isJtiRevoked(validatedToken.jti))) {
                return { error: true, errorCode: `${errorPrefix}::SESSION-INVALIDATED::A::p` };
            }

            return { error: false, valid: true, data: validatedToken };
        }

        // Tiers 2-4: stateful validation against the stored row.
        // The account row fetched above is handed to the hook so refresh does not
        // re-query the same user just to resolve its email.
        if (onStatefulPayload) await onStatefulPayload(validatedToken, accountState);

        const tokenRow = await TokenModel.getToken(validatedToken.tokenData.tokenId);
        if (!tokenRow) {
            return { error: true, errorCode: `${errorPrefix}::TOKEN-ID-NOT-FOUND::A::p` };
        }
        // The row must belong to the subject the signed payload claims. Defence in
        // depth against any future path that can mint or move a row independently.
        if (tokenRow.user_uid !== validatedToken.uid) {
            return { error: true, errorCode: `${errorPrefix}::VALIDATION-FAILED::A::p` };
        }
        if (tokenRow.type !== tokenType) {
            return { error: true, errorCode: `${errorPrefix}::TOKEN-TYPE-MISMATCH::A::p` };
        }

        const risk = await assessTierRisk(securityTier, { fingerprint, ip }, tokenRow);
        if (risk.hardFail) {
            return { error: true, errorCode: `${errorPrefix}::IP-NOT-IN-RANGE::A::p` };
        }
        if (risk.stepUpRequired) {
            return { error: true, errorCode: 'STEP-UP::REQUIRED::A::p', riskScore: risk.riskScore, uid: validatedToken.uid, data: validatedToken };
        }

        recordTokenEvent(auditModule, {
            source,
            functionName,
            ip,
            user: { email: validatedToken.email, uid: validatedToken.uid },
            device: { fingerprint, userAgent: requestMetadata?.userAgent },
            action: `${tokenType}_VALIDATION_SUCCESS`,
            status: 'SUCCESS',
            impact: `${capitalize(label)} token validated successfully (${securityTier})`,
            metadata: {
                authMethod: validatedToken.authMethod,
                role: validatedToken.role,
                tokenId: validatedToken.tokenData.tokenId,
                securityTier
            }
        });

        return { error: false, valid: true, data: validatedToken };
    } catch (e) {
        // Safety net for unexpected failures (decompression, DB errors, …)
        return { error: true, errorCode: `${errorPrefix}::VALIDATION-FAILED::A::p` };
    }
}

export { generateSessionToken, validateSessionToken };
