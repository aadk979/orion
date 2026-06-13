import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { TokenModel, UserModel } from '../../Databases/models/index.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { generateId, generateRandomNumber } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, isUnixExpired, parseDuration } from '../../Date&Time.js';

import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { toShortPayload, toVerbosePayload } from './tokenFieldMap.js';
import { compressURLs, decompressURLs } from '../../Compressor.js';

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
    const auditTrail = globalAccessPoint.auditTrailSystem();
    const requestMetadata = requestContext.getStore();
    const securityTier = globalAccessPoint.tokenSecurityTier();

    const secret = await globalAccessPoint.TOKEN_SECRETS_MANAGER_refresh().getRandomSigningKeyPair();
    const expiry = globalAccessPoint.systemConfig().tokens?.lifespans.refreshTokens || '15m';

    // Calculate max allowed refreshes on first issuance
    if (maxRefreshes === null) {
        const accessExpiry = globalAccessPoint.systemConfig().tokens?.lifespans.accessTokens || '15m';
        maxRefreshes = Math.floor(parseDuration(expiry) / parseDuration(accessExpiry)) + 3;
    }

    const aud = compressURLs(globalAccessPoint.allowedClientUrls());
    const iss = compressURLs(globalAccessPoint.systemConfig().server.selfUrl);

    let tokenData = null;
    let accessTokenLinkCode = accessTokenLinkCodeExternal;

    // Base payload for all tiers
    const payload = {
        uid: uid,
        authMethod: authMethod,
        role: role,
        securityTier: securityTier,
        accessTokenLinkCode,
        refreshCount: refreshCount,
        maxRefreshes: maxRefreshes,

        // Standard JWT fields
        aud: aud,
        iss: iss
    };

    // Tier 1: Stateless - minimal payload, no DB storage
    if (securityTier === 1) {
        payload.email = email;
        auditTrail.record({
            user: { email: email, uid: uid },
            device: { userAgent: userAgent },
            action: 'REFRESH_TOKEN_GENERATION_SUCCESS',
            status: 'SUCCESS',
            source: 'RefreshTokens.js',
            functionName: 'generateRefreshToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: 'Stateless refresh token generated (Tier 1)',
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
        return { error: false, token: token, securityTier: securityTier };
    }

    delete payload.accessTokenLinkCode;

    // Tiers 2-4: Stateful - require DB storage
    tokenData = {
        tokenId: generateId('REFRESH_TOKEN', 15),
        type: 'REFRESH_TOKEN',
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

    // Store token ref and token row
    await TokenModel.addTokenRef(uid, tokenData.tokenId, dbExpiry);

    const storage = await TokenModel.createToken(dbTokenFields);

    if (storage.error) {
        auditTrail.record({
            user: { email: email, uid: uid },
            device: {
                fingerprint: fingerprint,
                userAgent: userAgent
            },
            action: 'REFRESH_TOKEN_GENERATION_ATTEMPT',
            status: 'FAILED',
            source: 'RefreshTokens.js',
            functionName: 'generateRefreshToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: 'Refresh token generation failed - database error',
            metadata: {
                reason: 'DATABASE_ERROR',
                authMethod: authMethod,
                role: role,
                securityTier: securityTier
            },
            errorCode: 'UNABLE-TO-GENERATE-REFRESH-TOKEN'
        });
        return { error: true, errorCode: 'UNABLE-TO-GENERATE-REFRESH-TOKEN' };
    }

    const shortPayload = toShortPayload(payload);
    const token = jwt.sign(shortPayload, secret._nodePrivateKey, { expiresIn: expiry, algorithm: secret.generationConfig.algorithm, keyid: secret.keyPairId });

    auditTrail.record({
        user: { email: email, uid: uid },
        device: {
            fingerprint: fingerprint,
            userAgent: userAgent
        },
        action: 'REFRESH_TOKEN_GENERATION_SUCCESS',
        status: 'SUCCESS',
        source: 'RefreshTokens.js',
        functionName: 'generateRefreshToken',
        requestId: requestMetadata?.requestId,
        ipAddress: ip,
        impact: `Refresh token generated successfully (${securityTier})`,
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

async function validateRefreshToken(token, fingerprint, ip, clientUrl) {
    const auditTrail = globalAccessPoint.auditTrailSystem();
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
                action: 'REFRESH_TOKEN_VALIDATION_ATTEMPT',
                status: 'FAILED',
                source: 'RefreshTokens.js',
                functionName: 'validateRefreshToken',
                requestId: requestMetadata?.requestId,
                ipAddress: ip,
                impact: 'Refresh token validation failed - missing token',
                metadata: { reason: 'MISSING_TOKEN' },
                errorCode: 'MISSING-AUTHENTICATION-TOKEN'
            });
            return { error: true, errorCode: 'MISSING-AUTHENTICATION-TOKEN' };
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;
        const secret = await globalAccessPoint.TOKEN_SECRETS_MANAGER_refresh().findKeyPair(decodedHeader.kid);
        const serverUrl = globalAccessPoint.systemConfig().server.selfUrl;

        if (!secret) {
            return { error: true, errorCode: 'REFRESH-TOKEN-KEY-NOT-FOUND' };
        }

        const rawDecoded = jwt.verify(token, secret._nodePublicKey, { algorithms: [secret.generationConfig.algorithm] });
        const validatedToken = toVerbosePayload(rawDecoded);

        // Restore compressed URLs to original form
        validatedToken.aud = decompressURLs(validatedToken.aud);
        validatedToken.iss = decompressURLs(validatedToken.iss);

        // Validate audience and issuer for all tiers
        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.allowedClientUrls().includes(clientUrl)) {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-INVALID-AUD' };
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-ISS-NOT-ALLOWED' };
        }

        const securityTier = validatedToken.securityTier;

        if (securityTier !== configuredSecurityTier) {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-TIER-CONFLICT' };
        }

        // Tier 1: Stateless - no additional validation needed
        if (securityTier === 1) {
            return { error: false, valid: true, data: validatedToken };
        }

        // Tiers 2-4: Stateful validation
        const user = await UserModel.getUserByUid(validatedToken.uid);
        validatedToken.email = user?.email;

        const tokenData = await TokenModel.getToken(validatedToken.tokenData.tokenId);

        if (!tokenData) {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND' };
        }

        if (tokenData.type !== 'REFRESH_TOKEN') {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH' };
        }

        // Tier 2: IP validation only
        if (securityTier === 2) {
            if (!(await isIpInRange(ip, validatedToken.ipRange))) {
                return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE' };
            }
        }

        // Tier 3: Fingerprint as advisory risk signal only
        if (securityTier === 3) {
            let riskScore = 0;
            if (!(await verifyHash(fingerprint, tokenData.hashed_fingerprint))) {
                riskScore += 30;
            }
            if (riskScore >= 50) {
                return { error: true, errorCode: 'STEP-UP-AUTH-REQUIRED', riskScore, uid: validatedToken.uid, data: validatedToken };
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
                return { error: true, errorCode: 'STEP-UP-AUTH-REQUIRED', riskScore, uid: validatedToken.uid, data: validatedToken };
            }
        }

        auditTrail.record({
            user: { email: validatedToken.email, uid: validatedToken.uid },
            device: {
                fingerprint: fingerprint,
                userAgent: requestMetadata?.userAgent
            },
            action: 'REFRESH_TOKEN_VALIDATION_SUCCESS',
            status: 'SUCCESS',
            source: 'RefreshTokens.js',
            functionName: 'validateRefreshToken',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: `Refresh token validated successfully (${securityTier})`,
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
            return { error: true, errorCode: 'REFRESH-TOKEN-EXPIRED' };
        }

        return { error: true, errorCode: 'UNABLE-TO-VALIDATE-REFRESH-TOKEN' };
    }
}


export { generateRefreshToken, validateRefreshToken };
