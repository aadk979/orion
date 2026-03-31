import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { generateId, generateRandomNumber } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime } from '../../Date&Time.js';

import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { toShortPayload, toVerbosePayload } from './tokenFieldMap.js';
import { compressURLs, decompressURLs } from '../../Compressor.js';
import { cleanUpTokens } from './TokenCleanup.js';

async function generateAccessToken(uid, email, fingerprint, authMethod, role, ip, userAgent, accessTokenLinkCodeExternal) {
    const auditTrail = globalAccessPoint.auditTrailSystem();
    const requestMetadata = requestContext.getStore();
    const securityTier = globalAccessPoint.token_security_tier();

    const secret = await globalAccessPoint.TOKEN_SECRETS_MANAGER_access().getRandomSigningKeyPair();
    const expiry = globalAccessPoint.systemConfig().tokens?.lifespans.accessTokens || '15m';

    const aud = compressURLs(globalAccessPoint.allowedClientUrls());
    const iss = compressURLs(globalAccessPoint.systemConfig().server.urls);

    let tokenData = null;
    let accessTokenLinkCode = accessTokenLinkCodeExternal || generateRandomNumber(20);

    // Base payload for all tiers
    const payload = {
        uid: uid,
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
        payload.email = email;
        auditTrail.record({
            user: { email: email, uid: uid },
            device: { userAgent: userAgent },
            action: 'ACCESS_TOKEN_GENERATION_SUCCESS',
            status: 'SUCCESS',
            source: 'AccessTokens.js',
            functionName: 'generateAccessToken',
            requestId: requestMetadata?.requestId,
            accessTokenLinkCode,
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
        return { error: false, token: token, securityTier: securityTier, accessTokenLinkCode };
    }

    delete payload.accessTokenLinkCode;

    // Tiers 2-4: Stateful - require DB storage
    tokenData = {
        tokenId: generateId('ACCESS_TOKEN', 15),
        type: 'ACCESS_TOKEN',
        accessTokenLinkCode: accessTokenLinkCode
    };

    payload.tokenData = tokenData;

    const dbTokenData = {
        tokenId: tokenData.tokenId,
        exp: getFutureUnixTime(expiry),
        type: tokenData.type,
        userAgent: userAgent,
        accessTokenLinkCode: accessTokenLinkCode,
        securityTier: securityTier
    };

    // Tier 2: IP tracking only
    if (securityTier === 2) {
        const ipRange = getIpRange(ip);
        payload.ipRange = ipRange;
        dbTokenData.ipRange = ipRange;
    }

    // Tier 3: Fingerprint tracking only
    if (securityTier === 3) {
        const hashedFingerprint = await hashString(fingerprint);
        payload.hashedDeviceFingerprint = hashedFingerprint;
        dbTokenData.hashedFingerprint = hashedFingerprint;
    }

    // Tier 4: Both IP and fingerprint tracking
    if (securityTier === 4) {
        const hashedFingerprint = await hashString(fingerprint);
        const ipRange = getIpRange(ip);

        payload.hashedDeviceFingerprint = hashedFingerprint;
        payload.ipRange = ipRange;
        dbTokenData.hashedFingerprint = hashedFingerprint;
        dbTokenData.ipRange = ipRange;
    }

    // Store token in database for stateful tiers
    dbTokenData.uid = uid;

    // Asynchronously clean up expired tokens for this user
    cleanUpTokens(uid);

    let data = await globalAccessPoint.db().getData('Users', uid);
    let user = data.data;

    // Push lightweight reference
    user.security.activeTokens.push({ tokenId: dbTokenData.tokenId, exp: dbTokenData.exp });
    await globalAccessPoint.db().addData('Users', uid, user);

    const storage = await globalAccessPoint.db().addData('Tokens', dbTokenData.tokenId, dbTokenData);

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
            errorCode: 'UNABLE-TO-GENERATE-ACCESS-TOKEN'
        });
        return { error: true, errorCode: 'UNABLE-TO-GENERATE-ACCESS-TOKEN' };
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
    const auditTrail = globalAccessPoint.auditTrailSystem();
    const requestMetadata = requestContext.getStore();
    const configuredSecurityTier = globalAccessPoint.token_security_tier();

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
                errorCode: 'MISSING-AUTHENTICATION-TOKEN'
            });
            return { error: true, errorCode: 'MISSING-AUTHENTICATION-TOKEN' };
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;
        const secret = await globalAccessPoint.TOKEN_SECRETS_MANAGER_access().findKeyPair(decodedHeader.kid);
        const serverUrl = globalAccessPoint.systemConfig().server.myUrl;

        if (!secret) {
            return { error: true, errorCode: 'ACCESS-TOKEN-KEY-NOT-FOUND' };
        }

        const rawDecoded = jwt.verify(token, secret._nodePublicKey, { algorithms: [secret.generationConfig.algorithm] });
        const validatedToken = toVerbosePayload(rawDecoded);

        // Restore compressed URLs to original form
        validatedToken.aud = decompressURLs(validatedToken.aud);
        validatedToken.iss = decompressURLs(validatedToken.iss);

        // Validate audience and issuer for all tiers
        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.allowedClientUrls().includes(clientUrl)) {
            return { error: true, errorCode: 'INVALID-ACCESS-TOKEN-INVALID-AUD' };
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: 'INVALID-ACCESS-TOKEN-ISS-NOT-ALLOWED' };
        }

        const securityTier = validatedToken.securityTier;

        if (securityTier !== configuredSecurityTier) {
            return { error: true, errorCode: 'INVALID-ACCESS-TOKEN-TIER-CONFLICT' };
        }

        // Tier 1: Stateless - no additional validation needed
        if (securityTier === 1) {
            return { error: false, valid: true, data: validatedToken };
        }

        // Tiers 2-4: Stateful validation
        let data = await globalAccessPoint.db().getData('Users', validatedToken.uid);
        let user = data.data;
        validatedToken.email = user.credentials.email;

        const tokenDataResponse = await globalAccessPoint.db().getData('Tokens', validatedToken.tokenData.tokenId);
        const tokenData = tokenDataResponse.data;

        if (!tokenData) {
            return { error: true, errorCode: 'INVALID-ACCESS-TOKEN-TOKEN-ID-NOT-FOUND' };
        }

        if (tokenData.type !== 'ACCESS_TOKEN') {
            return { error: true, errorCode: 'INVALID-ACCESS-TOKEN-TOKEN-TYPE-MISMATCH' };
        }

        // Tier 2: IP validation only
        if (securityTier === 2) {
            if (!(await isIpInRange(ip, validatedToken.ipRange))) {
                return { error: true, errorCode: 'INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE' };
            }
        }

        // Tier 3: Fingerprint as advisory risk signal only
        if (securityTier === 3) {
            let riskScore = 0;
            if (!(await verifyHash(fingerprint, tokenData.hashedFingerprint))) {
                riskScore += 30;
            }
            if (riskScore >= 50) {
                // Do NOT revoke the token — the session is cryptographically valid; step-up is a risk gate only
                return { error: true, errorCode: 'STEP-UP-AUTH-REQUIRED', riskScore, uid: validatedToken.uid, data: validatedToken };
            }
        }

        // Tier 4: IP and fingerprint as combined risk signals
        if (securityTier === 4) {
            let riskScore = 0;
            if (!(await verifyHash(fingerprint, tokenData.hashedFingerprint))) {
                riskScore += 30;
            }
            if ((await isIpInRange(ip, tokenData.ipRange))) {
                riskScore += 40;
            }
            if (riskScore >= 50) {
                // Do NOT revoke the token — the session is cryptographically valid; step-up is a risk gate only
                return { error: true, errorCode: 'STEP-UP-AUTH-REQUIRED', riskScore, uid: validatedToken.uid, data: validatedToken };
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
            return { error: true, errorCode: 'ACCESS-TOKEN-EXPIRED' };
        }

        return { error: true, errorCode: 'UNABLE-TO-VALIDATE-ACCESS-TOKEN' };
    }
}

export { generateAccessToken, validateAccessToken };
