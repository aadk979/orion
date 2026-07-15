import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, TokenModel } from '../../Databases/models/index.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { generateId, generateRandomNumber } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, isUnixExpired, parseDuration } from '../../Date&Time.js';

import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { toShortPayload, toVerbosePayload } from './tokenFieldMap.js';
import { compressURLs, decompressURLs } from '../../Compressor.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'AccessTokens.js');
const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'AccessTokens.js');
const tokenSecretsManagerAccessModule = new SafeModuleHandler('TokenSecretsManager(access)', 'TOKEN_SECRETS_MANAGER_access', 'AccessTokens.js');


async function generateAccessToken(
    uid,
    email,
    fingerprint,
    authMethod,
    role,
    ip,
    userAgent
) {
    const auditTrail = auditTrailSystemModule.getModule();
    const requestMetadata = requestContext.getStore();
    const securityTier = globalAccessPoint.tokenSecurityTier();

    const secret = await tokenSecretsManagerAccessModule.getModule().getRandomSigningKeyPair();
    const expiry = systemConfigModule.getModule().tokens?.lifespans.accessTokens || '15m';

    const accessTokenLinkCode = generateId('AT_LINK', 10);

    const aud = compressURLs(globalAccessPoint.allowedClientUrls());
    const iss = compressURLs(systemConfigModule.getModule().server.urls);

    let tokenData = null;

    // Base payload for all tiers
    const payload = {
        uid: uid,
        email: email,
        authMethod: authMethod,
        role: role,
        securityTier: securityTier,
        accessTokenLinkCode,

        // Standard JWT fields
        aud: aud,
        iss: iss
    };

    // Tier 1: Stateless - minimal payload, no DB storage
    if (securityTier === 1) {
        auditTrail.record({
            user: { email: email, uid: uid },
            device: { userAgent: userAgent },
            action: 'ACCESS_TOKEN_GENERATION_SUCCESS',
            status: 'SUCCESS',
            source: 'AccessTokens.js',
            functionName: 'generateAccessToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: 'Stateless access token generated (Tier 1)',
            metadata: {
                authMethod: authMethod,
                role: role,
                expiry: expiry,
                securityTier: securityTier
            }
        });

        const shortPayload = toShortPayload(payload);
        const token = jwt.sign(shortPayload, secret._nodePrivateKey, {
            expiresIn: expiry,
            algorithm: secret.generationConfig.algorithm,
            keyid: secret.keyPairId
        });
        return { error: false, token: token, accessTokenLinkCode: accessTokenLinkCode, securityTier: securityTier };
    }

    delete payload.accessTokenLinkCode;

    // Tiers 2-4: Stateful - require DB storage
    tokenData = {
        tokenId: generateId('ACCESS_TOKEN', 15),
        type: 'ACCESS_TOKEN',
        accessTokenLinkCode: accessTokenLinkCode
    };

    payload.tokenData = tokenData;

    const dbExpiry = getFutureUnixTime(expiry);

    const dbTokenFields = {
        tokenId: tokenData.tokenId,
        uid: uid,
        type: tokenData.type,
        expiry: dbExpiry,
        userAgent: userAgent,
        linkCode: accessTokenLinkCode,
        securityTier: securityTier
    };

    // Tier 2: IP tracking only
    if (securityTier === 2) {
        const ipRange = getIpRange(ip);
        payload.ipRange = ipRange;
        dbTokenFields.ipRange = ipRange;
    }

    // Tier 3: Fingerprint tracking only
    if (securityTier === 3) {
        const hashedFingerprint = await hashString(fingerprint);
        payload.hashedDeviceFingerprint = hashedFingerprint;
        dbTokenFields.hashedFingerprint = hashedFingerprint;
    }

    // Tier 4: Both IP and fingerprint tracking
    if (securityTier === 4) {
        const hashedFingerprint = await hashString(fingerprint);
        const ipRange = getIpRange(ip);

        payload.hashedDeviceFingerprint = hashedFingerprint;
        payload.ipRange = ipRange;
        dbTokenFields.hashedFingerprint = hashedFingerprint;
        dbTokenFields.ipRange = ipRange;
    }

    // Store token in database for stateful tiers
    await TokenModel.addTokenRef(uid, tokenData.tokenId, dbExpiry);

    const storage = await TokenModel.createToken(dbTokenFields);

    if (storage.error) {
        auditTrail.record({
            user: { email: email, uid: uid },
            device: {
                fingerprint: fingerprint,
                userAgent: userAgent
            },
            action: 'ACCESS_TOKEN_GENERATION_ATTEMPT',
            status: 'FAILED',
            source: 'AccessTokens.js',
            functionName: 'generateAccessToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: 'Access token generation failed - database error',
            metadata: {
                reason: 'DATABASE_ERROR',
                authMethod: authMethod,
                role: role,
                securityTier: securityTier
            },
            errorCode: 'TOKEN-ACCESS::GENERATION-FAILED::A::i'
        });
        return { error: true, errorCode: 'TOKEN-ACCESS::GENERATION-FAILED::A::i' };
    }

    const shortPayload = toShortPayload(payload);
    const token = jwt.sign(shortPayload, secret._nodePrivateKey, { expiresIn: expiry, algorithm: secret.generationConfig.algorithm, keyid: secret.keyPairId });

    auditTrail.record({
        user: { email: email, uid: uid },
        device: {
            fingerprint: fingerprint,
            userAgent: userAgent
        },
        action: 'ACCESS_TOKEN_GENERATION_SUCCESS',
        status: 'SUCCESS',
        source: 'AccessTokens.js',
        functionName: 'generateAccessToken',
        requestId: requestMetadata?.requestId,
        ipAddress: ip,
        impact: `Access token generated successfully (${securityTier})`,
        metadata: {
            authMethod: authMethod,
            role: role,
            expiry: expiry,
            tokenId: tokenData.tokenId,
            securityTier: securityTier
        }
    });

    return { error: false, token: token, accessTokenLinkCode: accessTokenLinkCode, securityTier: securityTier };
}

async function validateAccessToken(token, fingerprint, ip, clientUrl) {
    const auditTrail = auditTrailSystemModule.getModule();
    const requestMetadata = requestContext.getStore();
    const configuredSecurityTier = globalAccessPoint.tokenSecurityTier();

    try {
        if (!token) {
            auditTrail.record({
                user: {},
                device: {
                    fingerprint: fingerprint,
                    userAgent: requestMetadata?.userAgent
                },
                action: 'ACCESS_TOKEN_VALIDATION_ATTEMPT',
                status: 'FAILED',
                source: 'AccessTokens.js',
                functionName: 'validateAccessToken',
                requestId: requestMetadata?.requestId,
                ipAddress: ip,
                impact: 'Access token validation failed - missing token',
                metadata: { reason: 'MISSING_TOKEN' },
                errorCode: 'AUTH::MISSING-TOKEN::A::p'
            });
            return { error: true, errorCode: 'AUTH::MISSING-TOKEN::A::p' };
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;
        const secret = await tokenSecretsManagerAccessModule.getModule().findKeyPair(decodedHeader.kid);
        const serverUrl = systemConfigModule.getModule().server.selfUrl;

        if (!secret) {
            return { error: true, errorCode: 'TOKEN-ACCESS::KEY-NOT-FOUND::A::i' };
        }

        const rawDecoded = jwt.verify(token, secret._nodePublicKey, { algorithms: [secret.generationConfig.algorithm] });
        const validatedToken = toVerbosePayload(rawDecoded);

        // Restore compressed URLs to original form
        validatedToken.aud = decompressURLs(validatedToken.aud);
        validatedToken.iss = decompressURLs(validatedToken.iss);

        // Validate audience and issuer for all tiers
        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.allowedClientUrls().includes(clientUrl)) {
            return { error: true, errorCode: 'TOKEN-ACCESS::INVALID-AUD::A::p' };
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: 'TOKEN-ACCESS::ISS-NOT-ALLOWED::A::p' };
        }

        const securityTier = validatedToken.securityTier;

        if (securityTier !== configuredSecurityTier) {
            return { error: true, errorCode: 'TOKEN-ACCESS::TIER-CONFLICT::A::i' };
        }

        // Tier 1: Stateless - no additional validation needed
        if (securityTier === 1) {
            return { error: false, valid: true, data: validatedToken };
        }

        // Tiers 2-4: Stateful validation
        const tokenData = await TokenModel.getToken(validatedToken.tokenData.tokenId);

        if (!tokenData) {
            return { error: true, errorCode: 'TOKEN-ACCESS::TOKEN-ID-NOT-FOUND::A::p' };
        }

        if (tokenData.type !== 'ACCESS_TOKEN') {
            return { error: true, errorCode: 'TOKEN-ACCESS::TOKEN-TYPE-MISMATCH::A::p' };
        }

        // Tier 2: IP validation only
        if (securityTier === 2) {
            if (!(await isIpInRange(ip, validatedToken.ipRange))) {
                return { error: true, errorCode: 'TOKEN-ACCESS::IP-NOT-IN-RANGE::A::p' };
            }
        }

        // Tier 3: Fingerprint as advisory risk signal only
        if (securityTier === 3) {
            let riskScore = 0;
            if (!(await verifyHash(fingerprint, tokenData.hashed_fingerprint))) {
                riskScore += 30;
            }
            if (riskScore >= 50) {
                return { error: true, errorCode: 'STEP-UP::REQUIRED::A::p', riskScore, uid: validatedToken.uid, data: validatedToken };
            }
        }

        // Tier 4: IP and fingerprint as combined risk signals
        if (securityTier === 4) {
            let riskScore = 0;
            if (!(await verifyHash(fingerprint, tokenData.hashed_fingerprint))) {
                riskScore += 30;
            }
            if (!(await isIpInRange(ip, tokenData.ip_range))) {
                riskScore += 40;
            }
            if (riskScore >= 50) {
                return { error: true, errorCode: 'STEP-UP::REQUIRED::A::p', riskScore, uid: validatedToken.uid, data: validatedToken };
            }
        }

        auditTrail.record({
            user: { email: validatedToken.email, uid: validatedToken.uid },
            device: {
                fingerprint: fingerprint,
                userAgent: requestMetadata?.userAgent
            },
            action: 'ACCESS_TOKEN_VALIDATION_SUCCESS',
            status: 'SUCCESS',
            source: 'AccessTokens.js',
            functionName: 'validateAccessToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: `Access token validated successfully (${securityTier})`,
            metadata: {
                authMethod: validatedToken.authMethod,
                role: validatedToken.role,
                tokenId: validatedToken.tokenData.tokenId,
                securityTier: securityTier
            }
        });

        return { error: false, valid: true, data: validatedToken };
    } catch (e) {
        if (e.message === 'jwt expired') {
            return { error: true, errorCode: 'TOKEN-ACCESS::EXPIRED::A::p' };
        }

        return { error: true, errorCode: 'TOKEN-ACCESS::VALIDATION-FAILED::A::p' };
    }
}

export { generateAccessToken, validateAccessToken };
