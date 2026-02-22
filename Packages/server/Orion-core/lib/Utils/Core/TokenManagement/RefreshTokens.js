import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { generateId, generateRandomNumber } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, isUnixExpired } from '../../Date&Time.js';
import { timingSafeEqual } from 'crypto';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';

const domain = "refresh";

const refreshKey = `TOKEN_SECRETS_MANAGER_${domain}`;

async function generateRefreshToken(uid, email, fingerprint, authMethod, role, ip, userAgent, accessTokenLinkCodeExternal) {
    const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
    const requestMetadata = requestContext.getStore();
    const securityTier = globalAccessPoint.getValue("token_security_tier");

    const secret = await globalAccessPoint.getValue(refreshKey).getRandomSigningKeyPair();
    const expiry = globalAccessPoint.getValue('systemConfig').tokens?.lifespans.refreshTokens || '15m';
    const aud = globalAccessPoint.getValue('allowedClientUrls');
    const iss = globalAccessPoint.getValue('systemConfig').server.urls;

    let tokenData = null;
    let accessTokenLinkCode =  accessTokenLinkCodeExternal;

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
        iss: iss,
        sub: uid
    };

    // Tier 1: Stateless - minimal payload, no DB storage
    if (securityTier === 'TIER_1') {
        payload.jti = generateId('REFRESH_TOKEN', 15);
        
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

        const token = jwt.sign(payload, secret._nodePrivateKey, { expiresIn: expiry, algorithm: secret.generationConfig.algorithm, keyid: secret.keyPairId });
        return { error: false, token: token, securityTier: securityTier };
    }

    delete payload.accessTokenLinkCode;

    // Tiers 2-4: Stateful - require DB storage
    tokenData = {
        tokenId: generateId('REFRESH_TOKEN', 15),
        type: 'REFRESH_TOKEN',
        accessTokenLinkCode: accessTokenLinkCode,
        securityTier: securityTier
    };

    payload.tokenData = tokenData;
    payload.jti = tokenData.tokenId;

    const dbTokenData = {
        tokenId: tokenData.tokenId,
        exp: getFutureUnixTime(expiry),
        type: tokenData.type,
        userAgent: userAgent,
        accessTokenLinkCode: accessTokenLinkCode,
        securityTier: securityTier
    };

    // Tier 2: IP tracking only
    if (securityTier === 'TIER_2') {
        const ipRange = getIpRange(ip);
        payload.ipRange = ipRange;
        dbTokenData.ipRange = ipRange;
    }

    // Tier 3: Fingerprint tracking only
    if (securityTier === 'TIER_3') {
        const hashedFingerprint = await hashString(fingerprint);
        payload.hashedDeviceFingerprint = hashedFingerprint;
        dbTokenData.hashedFingerprint = hashedFingerprint;
    }

    // Tier 4: Both IP and fingerprint tracking
    if (securityTier === 'TIER_4') {
        const hashedFingerprint = await hashString(fingerprint);
        const ipRange = getIpRange(ip);
        
        payload.hashedDeviceFingerprint = hashedFingerprint;
        payload.ipRange = ipRange;
        dbTokenData.hashedFingerprint = hashedFingerprint;
        dbTokenData.ipRange = ipRange;
    }

    // Store token in database for stateful tiers
    let data = await globalAccessPoint.db().getData('Users', uid);
    let user = data.data;

    user.security.activeTokens.push(dbTokenData);

    // Clean up expired tokens
    const filteredArray = user.security.activeTokens.filter(value => isUnixExpired(value.exp) === false);
    user.security.activeTokens = filteredArray;

    const storage = await globalAccessPoint.db().addData('Users', uid, user);

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

    const token = jwt.sign(payload, secret._nodePrivateKey, { expiresIn: expiry, algorithm: secret.generationConfig.algorithm, keyid: secret.keyPairId });

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
    const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
    const requestMetadata = requestContext.getStore();
    const configuredSecurityTier = globalAccessPoint.getValue("token_security_tier");

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
        const secret = await globalAccessPoint.getValue(refreshKey).findKeyPair(decodedHeader.kid);
        const serverUrl = globalAccessPoint.getValue('systemConfig').server.myUrl;

        if (!secret) {
            return { error: true, errorCode: 'REFRESH-TOKEN-KEY-NOT-FOUND' };
        }

        const validatedToken = jwt.verify(token, secret._nodePublicKey, { algorithms: [secret.generationConfig.algorithm] });

        // Validate audience and issuer for all tiers
        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.getValue('allowedClientUrls').includes(clientUrl)) {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-INVALID-AUD' };
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-ISS-NOT-ALLOWED' };
        }

        const securityTier = validatedToken.securityTier || 'NONE';

        if (securityTier !== configuredSecurityTier) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TIER-CONFLICT" }
        }

        // Tier 1: Stateless - no additional validation needed
        if (securityTier === 'TIER_1') {
            return { error: false, valid: true, data: validatedToken };
        }

        // Tiers 2-4: Stateful validation
        let data = await globalAccessPoint.db().getData('Users', validatedToken.uid);
        let user = data.data;
        const activeTokens = user.security.activeTokens;
        const tokenData = activeTokens.find(value => value.tokenId === validatedToken.tokenData.tokenId);

        if (!tokenData) {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND' };
        }

        if (tokenData.type !== 'REFRESH_TOKEN') {
            return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH' };
        }

        // Tier 2: IP validation only
        if (securityTier === 'TIER_2') {
            if (!(await isIpInRange(ip, validatedToken.ipRange))) {
                return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE' };
            }
        }

        // Tier 3: Fingerprint validation only
        if (securityTier === 'TIER_3') {
            if (!timingSafeEqual(Buffer.from(validatedToken.hashedDeviceFingerprint), Buffer.from(tokenData.hashedFingerprint))) {
                const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
                user.security.activeTokens = newArray;
                await globalAccessPoint.db().addData('Users', validatedToken.uid, user);
                return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1' };
            }

            if ((await verifyHash(fingerprint, tokenData.hashedFingerprint)) === false) {
                const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
                user.security.activeTokens = newArray;
                await globalAccessPoint.db().addData('Users', validatedToken.uid, user);
                return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2' };
            }
        }

        // Tier 4: Both IP and fingerprint validation
        if (securityTier === 'TIER_4') {
            if (!(await isIpInRange(ip, validatedToken.ipRange))) {
                return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE' };
            }

            if (!timingSafeEqual(Buffer.from(validatedToken.hashedDeviceFingerprint), Buffer.from(tokenData.hashedFingerprint))) {
                const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
                user.security.activeTokens = newArray;
                await globalAccessPoint.db().addData('Users', validatedToken.uid, user);
                return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1' };
            }

            if ((await verifyHash(fingerprint, tokenData.hashedFingerprint)) === false) {
                const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
                user.security.activeTokens = newArray;
                await globalAccessPoint.db().addData('Users', validatedToken.uid, user);
                return { error: true, errorCode: 'INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2' };
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