/**
 * Resource Token Management System
 *
 * Handles generation and validation of resource access tokens. During token
 * generation, both user context and device identity fingerprints are present.
 *
 * NOTE: For the "secure" view type, device fingerprint values may not be
 * present, so the system will not validate the device fingerprint for this
 * view type.
 */

import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { TokenModel } from '../../Databases/models/index.js';
import { hashString } from '../../CryptoFunctions.js';
import { generateId } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, isUnixExpired, parseDuration } from '../../Date&Time.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { SUPPORTED_TOKENS } from '../ResourceAccessManagment/configs.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'ResourceTokens.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'ResourceTokens.js');
const tokenSecretsManagerModule = new SafeModuleHandler('TokenSecretsManager', 'tokenSecretsManager', 'ResourceTokens.js');


const MAX_FILES_ACCESS_PER_HOUR = 25;

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
    if (!accessibleCallbacks || !Array.isArray(accessibleCallbacks) || accessibleCallbacks.length <= 0) {
        return { error: true, errorCode: 'TOKEN-RESOURCE::INVALID-CALLBACKS-ARRAY::A::p' };
    }

    if (!SUPPORTED_TOKENS.find(val => val.tokenType === viewType.toUpperCase().trim())) {
        return { error: true, errorCode: 'TOKEN-RESOURCE::INVALID-VIEW-TYPE::A::p' };
    }

    if (viewType.toUpperCase().trim() === 'PUBLIC') {
        return { error: true, errorCode: 'TOKEN-RESOURCE::VIEW-TYPE-NOT-ACCEPTABLE::A::p' };
    }

    if (
        Math.floor((parseDuration(systemConfigModule.getModule().tokens?.lifespans.resourceTokens || '1h') / 1) * 60 * 60 * 1000) *
        MAX_FILES_ACCESS_PER_HOUR <
        maxRetrievals
    ) {
        return { error: true, errorCode: 'TOKEN-RESOURCE::MAX-RETRIEVALS-TOO-HIGH::A::p' };
    }

    const auditTrail = auditTrailSystemModule.getModule();
    const requestMetadata = requestContext.getStore();

    const secret = await tokenSecretsManagerModule.getModule().getRandomKeyPair('resource_access');
    const expiry = systemConfigModule.getModule().tokens?.lifespans.resourceAccessTokens || '1h';
    const aud = globalAccessPoint.allowedClientUrls();
    const iss = systemConfigModule.getModule().server.urls;

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const tokenData = {
        tokenId: generateId('RESOURCE_TOKEN', 15),
        type: 'RESOURCE_TOKEN'
    };

    const dbExpiry = getFutureUnixTime(expiry);

    const payload = {
        uid: uid,
        email: email,
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
        aud: aud,
        iss: iss,
        sub: uid
    };

    // Store token ref and token row
    await TokenModel.addTokenRef(uid, tokenData.tokenId, dbExpiry);

    const storage = await TokenModel.createToken({
        tokenId: tokenData.tokenId,
        uid: uid,
        type: tokenData.type,
        expiry: dbExpiry,
        userAgent: userAgent,
        hashedFingerprint,
        viewType,
        maxRetrievals
    });

    if (storage.error) {
        auditTrail.record({
            user: { email: email, uid: uid },
            device: {
                fingerprint: fingerprint,
                userAgent: userAgent
            },
            action: 'RESOURCE_TOKEN_GENERATION_ATTEMPT',
            status: 'FAILED',
            source: 'resourceTokens.js',
            functionName: 'generateResourceToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: 'Resource token generation failed - database error',
            metadata: {
                reason: 'DATABASE_ERROR'
            },
            errorCode: 'TOKEN-RESOURCE::GENERATION-FAILED::A::i'
        });
        return { error: true, errorCode: 'TOKEN-RESOURCE::GENERATION-FAILED::A::i' };
    }

    const token = jwt.sign(payload, secret.privateKey, { expiresIn: expiry, algorithm: 'RS256', keyid: secret.keyPairId });

    auditTrail.record({
        user: { email: email, uid: uid },
        device: {
            fingerprint: fingerprint,
            userAgent: userAgent
        },
        action: 'ACCESS_TOKEN_GENERATION_SUCCESS',
        status: 'SUCCESS',
        source: 'resourceTokens.js',
        functionName: 'generateResourceToken',
        requestId: requestMetadata?.requestId,
        ipAddress: ip,
        impact: 'Resource token generated successfully',
        metadata: {
            expiry: expiry,
            tokenId: tokenData.tokenId,
            shareAllowed,
            accessibleCallbacks
        }
    });

    return { error: false, token: token };
}

async function validateResourceToken(token, fingerprint = 'NO_FINGERPRINT', ip, clientUrl) {
    const auditTrail = auditTrailSystemModule.getModule();
    const requestMetadata = requestContext.getStore();

    try {
        if (!token) {
            auditTrail.record({
                user: {},
                device: { fingerprint, userAgent: requestMetadata?.userAgent },
                action: 'RESOURCE_TOKEN_VALIDATION_ATTEMPT',
                status: 'FAILED',
                source: 'resourceTokens.js',
                functionName: 'validateResourceToken',
                requestId: requestMetadata?.requestId,
                ipAddress: ip,
                impact: 'Resource token validation failed - missing token',
                metadata: { reason: 'MISSING_TOKEN' },
                errorCode: 'TOKEN-RESOURCE::MISSING::A::p'
            });
            return { error: true, errorCode: 'TOKEN-RESOURCE::MISSING::A::p' };
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;
        const secret = await tokenSecretsManagerModule.getModule().getKeyPairById(decodedHeader.kid, 'resource_access');

        if (secret.notFound) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::KEY-NOT-FOUND::A::i' };
        }

        const serverUrl = systemConfigModule.getModule().server.selfUrl;

        const validatedToken = jwt.verify(token, secret.publicKey, { algorithms: ['RS256'] });

        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.allowedClientUrls().includes(clientUrl)) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::INVALID-AUD::A::p' };
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::ISS-NOT-ALLOWED::A::p' };
        }

        if (!(await isIpInRange(ip, validatedToken.ipRange)) && !validatedToken.shareAllowed) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::IP-NOT-IN-RANGE::A::p' };
        }

        const tokenData = await TokenModel.getToken(validatedToken.tokenData.tokenId);

        if (!tokenData) {
            return { error: true, errorCode: 'TOKEN-RESOURCE::TOKEN-ID-NOT-FOUND::A::p' };
        }

        if (tokenData.type !== 'RESOURCE_TOKEN') {
            return { error: true, errorCode: 'TOKEN-RESOURCE::TOKEN-TYPE-MISMATCH::A::p' };
        }

        if (tokenData.retrieval_count >= tokenData.max_retrievals) {
            await TokenModel.deleteToken(validatedToken.tokenData.tokenId);
            await TokenModel.removeTokenRef(validatedToken.uid, validatedToken.tokenData.tokenId);
            return { error: true, errorCode: 'TOKEN-RESOURCE::MAX-RETRIEVALS-HIT::A::p' };
        }

        await TokenModel.updateToken(validatedToken.tokenData.tokenId, {
            retrieval_count: tokenData.retrieval_count + 1
        });

        auditTrail.record({
            user: { email: validatedToken.email, uid: validatedToken.uid },
            device: { fingerprint, userAgent: requestMetadata?.userAgent },
            action: 'RESOURCE_TOKEN_VALIDATION_SUCCESS',
            status: 'SUCCESS',
            source: 'resourceTokens.js',
            functionName: 'validateResourceToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: 'Resource token validated successfully',
            metadata: {
                tokenId: validatedToken.tokenData.tokenId,
                viewType: tokenData.view_type
            }
        });

        return { error: false, valid: true, data: validatedToken, customData: validatedToken.customData };
    } catch (e) {
        if (e.message === 'jwt expired') {
            return { error: true, errorCode: 'TOKEN-RESOURCE::EXPIRED::A::p' };
        }

        return { error: true, errorCode: 'TOKEN-RESOURCE::VALIDATION-FAILED::B::p' };
    }
}

export { generateResourceToken, validateResourceToken };
