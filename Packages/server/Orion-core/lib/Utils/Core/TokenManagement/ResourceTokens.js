/**
 * Resource Token Management System
 *
 * Handles generation and validation of resource access tokens. Unlike
 * access/refresh tokens, resource tokens are single-purpose grants: they
 * carry their own allow-list of callbacks, a retrieval budget, and are not
 * tier-aware or payload-compressed (they never travel as cookies).
 *
 * NOTE: a fingerprint hash is stored at generation time, but validation does
 * not check it — for the "secure" view type the fingerprint is legitimately
 * absent at retrieval time (e.g. tokens opened outside the issuing browser
 * when sharing is allowed).
 */
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { TokenModel } from '../../Databases/models/index.js';
import { hashString } from '../../CryptoFunctions.js';
import { generateId } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, parseDuration } from '../../Date&Time.js';
import { SUPPORTED_TOKENS } from '../ResourceAccessManagment/configs.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { recordTokenEvent } from './internals/tokenAudit.js';
import { decodeKeyId, signWithKeyPair, verifyWithKeyPair } from './internals/jwtCodec.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'ResourceTokens.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'ResourceTokens.js');
const tokenSecretsManagerResourceModule = new SafeModuleHandler('TokenSecretsManager(resource)', 'TOKEN_SECRETS_MANAGER_resource', 'ResourceTokens.js');

const SOURCE = 'ResourceTokens.js';

// Retrieval budget cap: this many retrievals per hour of token lifetime.
const MAX_FILES_ACCESS_PER_HOUR = 25;
const MS_PER_HOUR = 60 * 60 * 1000;

async function generateResourceToken(
    uid,
    email,
    fingerprint,
    ip,
    userAgent,
    viewType,
    accessibleCallbacks,
    shareAllowed = false,
    maxRetrievals,
    customData = {}
) {
    if (!Array.isArray(accessibleCallbacks) || accessibleCallbacks.length <= 0) {
        return { error: true, errorCode: 'TOKEN-RESOURCE::INVALID-CALLBACKS-ARRAY::A::p' };
    }

    const normalizedViewType = viewType.toUpperCase().trim();

    if (!SUPPORTED_TOKENS.some(val => val.tokenType === normalizedViewType)) {
        return { error: true, errorCode: 'TOKEN-RESOURCE::INVALID-VIEW-TYPE::A::p' };
    }

    if (normalizedViewType === 'PUBLIC') {
        return { error: true, errorCode: 'TOKEN-RESOURCE::VIEW-TYPE-NOT-ACCEPTABLE::A::p' };
    }

    const expiry = systemConfigModule.getModule().tokens?.lifespans.resourceTokens || '1h';

    const lifespanHours = parseDuration(expiry) / MS_PER_HOUR;
    if (maxRetrievals > lifespanHours * MAX_FILES_ACCESS_PER_HOUR) {
        return { error: true, errorCode: 'TOKEN-RESOURCE::MAX-RETRIEVALS-TOO-HIGH::A::p' };
    }

    const secret = await tokenSecretsManagerResourceModule.getModule().getRandomSigningKeyPair();

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const tokenData = {
        tokenId: generateId('RESOURCE_TOKEN', 15),
        type: 'RESOURCE_TOKEN'
    };

    const payload = {
        uid,
        email,
        hashedDeviceFingerprint: hashedFingerprint,
        tokenData,
        ipRange,
        viewType,
        customData,
        accessibleCallbacks,
        shareAllowed,
        maxRetrievals,

        // Standard JWT fields
        jti: tokenData.tokenId,
        aud: globalAccessPoint.allowedClientUrls(),
        iss: systemConfigModule.getModule().server.urls,
        sub: uid
    };

    const storage = await TokenModel.createToken({
        tokenId: tokenData.tokenId,
        uid,
        type: tokenData.type,
        expiry: getFutureUnixTime(expiry),
        userAgent,
        hashedFingerprint,
        viewType,
        maxRetrievals
    });

    if (storage.error) {
        recordTokenEvent(auditTrailSystemModule, {
            source: SOURCE,
            functionName: 'generateResourceToken',
            ip,
            user: { email, uid },
            device: { fingerprint, userAgent },
            action: 'RESOURCE_TOKEN_GENERATION_ATTEMPT',
            status: 'FAILED',
            impact: 'Resource token generation failed - database error',
            metadata: { reason: 'DATABASE_ERROR' },
            errorCode: 'TOKEN-RESOURCE::GENERATION-FAILED::A::i'
        });
        return { error: true, errorCode: 'TOKEN-RESOURCE::GENERATION-FAILED::A::i' };
    }

    const token = signWithKeyPair(secret, payload, expiry);

    recordTokenEvent(auditTrailSystemModule, {
        source: SOURCE,
        functionName: 'generateResourceToken',
        ip,
        user: { email, uid },
        device: { fingerprint, userAgent },
        action: 'RESOURCE_TOKEN_GENERATION_SUCCESS',
        status: 'SUCCESS',
        impact: 'Resource token generated successfully',
        metadata: {
            expiry,
            tokenId: tokenData.tokenId,
            shareAllowed,
            accessibleCallbacks
        }
    });

    return { error: false, token };
}

async function validateResourceToken(token, fingerprint = 'NO_FINGERPRINT', ip, clientUrl) {
    const requestMetadata = requestContext.getStore();

    try {
        if (!token) {
            recordTokenEvent(auditTrailSystemModule, {
                source: SOURCE,
                functionName: 'validateResourceToken',
                ip,
                user: {},
                device: { fingerprint, userAgent: requestMetadata?.userAgent },
                action: 'RESOURCE_TOKEN_VALIDATION_ATTEMPT',
                status: 'FAILED',
                impact: 'Resource token validation failed - missing token',
                metadata: { reason: 'MISSING_TOKEN' },
                errorCode: 'TOKEN-RESOURCE::MISSING::A::p'
            });
            return { error: true, errorCode: 'TOKEN-RESOURCE::MISSING::A::p' };
        }

        const keyId = decodeKeyId(token);
        if (!keyId) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::VALIDATION-FAILED::B::p' };
        }

        const secret = await tokenSecretsManagerResourceModule.getModule().findKeyPair(keyId);
        if (!secret) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::KEY-NOT-FOUND::A::i' };
        }

        const verification = verifyWithKeyPair(token, secret);
        if (!verification.valid) {
            return {
                error: true,
                errorCode: verification.expired ? 'TOKEN-RESOURCE::EXPIRED::A::p' : 'TOKEN-RESOURCE::VALIDATION-FAILED::B::p'
            };
        }

        const validatedToken = verification.payload;

        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.allowedClientUrls().includes(clientUrl)) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::INVALID-AUD::A::p' };
        }

        const serverUrl = systemConfigModule.getModule().server.selfUrl;
        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::ISS-NOT-ALLOWED::A::p' };
        }

        // Shareable tokens may travel to other networks; non-shareable ones
        // stay pinned to the requester's IP range.
        if (!(await isIpInRange(ip, validatedToken.ipRange)) && !validatedToken.shareAllowed) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::IP-NOT-IN-RANGE::A::p' };
        }

        const tokenRow = await TokenModel.getToken(validatedToken.tokenData.tokenId);
        if (!tokenRow) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::TOKEN-ID-NOT-FOUND::A::p' };
        }
        if (tokenRow.type !== 'RESOURCE_TOKEN') {
            return { error: true, errorCode: 'TOKEN-RESOURCE::TOKEN-TYPE-MISMATCH::A::p' };
        }

        // Claim a retrieval atomically. Checking the count and then writing
        // count+1 as a literal let N concurrent requests all read the same value,
        // all pass the check, and all write the same increment — so a
        // max_retrievals:1 token could be redeemed as many times as the caller
        // could fire requests at once. The predicate now lives in the UPDATE, so
        // exactly one of N racing requests can win.
        const claimed = await TokenModel.claimRetrieval(validatedToken.tokenData.tokenId);

        if (!claimed) {
            await TokenModel.deleteToken(validatedToken.tokenData.tokenId);
            return { error: true, errorCode: 'TOKEN-RESOURCE::MAX-RETRIEVALS-HIT::A::p' };
        }

        recordTokenEvent(auditTrailSystemModule, {
            source: SOURCE,
            functionName: 'validateResourceToken',
            ip,
            user: { email: validatedToken.email, uid: validatedToken.uid },
            device: { fingerprint, userAgent: requestMetadata?.userAgent },
            action: 'RESOURCE_TOKEN_VALIDATION_SUCCESS',
            status: 'SUCCESS',
            impact: 'Resource token validated successfully',
            metadata: {
                tokenId: validatedToken.tokenData.tokenId,
                viewType: tokenRow.view_type
            }
        });

        return { error: false, valid: true, data: validatedToken, customData: validatedToken.customData };
    } catch (e) {
        return { error: true, errorCode: 'TOKEN-RESOURCE::VALIDATION-FAILED::B::p' };
    }
}

export { generateResourceToken, validateResourceToken };
