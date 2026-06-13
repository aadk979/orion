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
        return { error: true, errorCode: 'RESOURCE-TOKENS-INVALID-ACCESSIBLE-CALLBACKS-ARRAY' };
    }

    if (!SUPPORTED_TOKENS.find(val => val.tokenType === viewType.toUpperCase().trim())) {
        return { error: true, errorCode: 'RESOURCE-TOKENS-INVALID-VIEW-TYPE' };
    }

    if (viewType.toUpperCase().trim() === 'PUBLIC') {
        return { error: true, errorCode: 'RESOURCE-TOKENS-VIEW-TYPE-NOT-ACCEPTABLE' };
    }

    if (
        Math.floor((parseDuration(globalAccessPoint.systemConfig().tokens?.lifespans.resourceTokens || '1h') / 1) * 60 * 60 * 1000) *
        MAX_FILES_ACCESS_PER_HOUR <
        maxRetrievals
    ) {
        return { error: true, errorCode: 'RESOURCE-TOKENS-MAX-RETRIEVALS-TOO-HIGH' };
    }

    const auditTrail = globalAccessPoint.auditTrailSystem();
    const requestMetadata = requestContext.getStore();

    const secret = await globalAccessPoint.tokenSecretsManager().getRandomKeyPair('resource_access');
    const expiry = globalAccessPoint.systemConfig().tokens?.lifespans.resourceAccessTokens || '1h';
    const aud = globalAccessPoint.allowedClientUrls();
    const iss = globalAccessPoint.systemConfig().server.urls;

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
            errorCode: 'UNABLE-TO-GENERATE-RESOURCE-TOKEN'
        });
        return { error: true, errorCode: 'UNABLE-TO-GENERATE-RESOURCE-TOKEN' };
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
    const auditTrail = globalAccessPoint.auditTrailSystem();
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
                errorCode: 'MISSING-RESOURCE-TOKEN'
            });
            return { error: true, errorCode: 'MISSING-RESOURCE-TOKEN' };
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;
        const secret = await globalAccessPoint.tokenSecretsManager().getKeyPairById(decodedHeader.kid, 'resource_access');

        if (secret.notFound) {
            return { error: true, errorCode: 'RESOURCE-TOKEN-KEY-NOT-FOUND' };
        }

        const serverUrl = globalAccessPoint.systemConfig().server.selfUrl;

        const validatedToken = jwt.verify(token, secret.publicKey, { algorithms: ['RS256'] });

        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.allowedClientUrls().includes(clientUrl)) {
            return { error: true, errorCode: 'INVALID-RESOURCE-TOKEN-INVALID-AUD' };
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: 'INVALID-RESOURCE-TOKEN-ISS-NOT-ALLOWED' };
        }

        if (!(await isIpInRange(ip, validatedToken.ipRange)) && !validatedToken.shareAllowed) {
            return { error: true, errorCode: 'INVALID-RESOURCE-TOKEN-IP-NOT-IN-RANGE' };
        }

        const tokenData = await TokenModel.getToken(validatedToken.tokenData.tokenId);

        if (!tokenData) {
            return { error: true, errorCode: 'INVALID-RESOURCE-TOKEN-TOKEN-ID-NOT-FOUND' };
        }

        if (tokenData.type !== 'RESOURCE_TOKEN') {
            return { error: true, errorCode: 'INVALID-RESOURCE-TOKEN-TOKEN-TYPE-MISMATCH' };
        }

        if (tokenData.retrieval_count >= tokenData.max_retrievals) {
            await TokenModel.deleteToken(validatedToken.tokenData.tokenId);
            await TokenModel.removeTokenRef(validatedToken.uid, validatedToken.tokenData.tokenId);
            return { error: true, errorCode: 'MAX-RESOURCE-RETRIEVALS-HIT' };
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
            return { error: true, errorCode: 'RESOURCE-TOKEN-EXPIRED' };
        }

        return { error: true, errorCode: 'UNABLE-TO-VALIDATE-RESOURCE-TOKEN' };
    }
}

export { generateResourceToken, validateResourceToken };
