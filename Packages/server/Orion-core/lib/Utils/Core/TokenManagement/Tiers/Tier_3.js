/**
 * Orion Token Tier System
 * 
 * Tier: 3
 * 
 * Tier 3 uses a statefull design where the token is tracked in the db, it tracks and verifies network ips and device fingerprints.
 * It is intended for use in applications where high security is required.
 */

import { getFutureUnixTime, isUnixExpired } from "../../../Date&Time";
import { globalAccessPoint } from "../../../GlobalAccessPoint";
import { getIpRange } from "../../../Ip";
import { generateId, generateRandomNumber } from "../../../valueGenerator";

const generateTier3Token = async (config) => {
    const { fingerprint, ip, accessTokenLinkCodeExternal, tokenType, expiry, uid, email, authMethod, role, aud, iss, userAgent, auditTrail, secret } = config;

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const accessTokenLinkCode = accessTokenLinkCodeExternal || generateRandomNumber(45);

    const tokenData = {
        tokenId: generateId(tokenType, 15),
        type: tokenType,
        accessTokenLinkCode: accessTokenLinkCode
    };

    const dbTokenData = {
        tokenId: tokenData.tokenId,
        exp: getFutureUnixTime(expiry),
        type: tokenData.type,
        userAgent: userAgent,
        accessTokenLinkCode: accessTokenLinkCode,
        hashedFingerprint
    };

    const payload = {
        uid: uid,
        email: email,
        hashedDeviceFingerprint: hashedFingerprint,
        authMethod: authMethod,
        role: role,
        tokenData,
        ipRange,

        // Standard JWT fields
        jti: tokenData.tokenId,
        aud: aud,
        iss: iss,
        sub: uid
    };

    let data = await globalAccessPoint.db().getData('Users', uid);

    let user = data.data;

    user.security.activeTokens.push(dbTokenData);

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
            action: `${tokenType}_GENERATION_ATTEMPT`,
            status: 'FAILED',
            source: 'Tier_3.js',
            functionName: 'generateTier3Token',
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: 'Tier 3 token generation failed - database error',
            metadata: {
                reason: 'DATABASE_ERROR',
                authMethod: authMethod,
                role: role,
                tokenType
            },
            errorCode: 'UNABLE-TO-GENERATE-TOKEN'
        });
        return { error: true, errorCode: 'UNABLE-TO-GENERATE-TOKEN' };
    }

    const token = jwt.sign(payload, secret.privateKey, { expiresIn: expiry, algorithm: 'RS256', keyid: secret.keyPairId });

    auditTrail.record({
        user: { email: email, uid: uid },
        device: {
            fingerprint: fingerprint,
            userAgent: userAgent
        },
        action: `${tokenType}_GENERATION_SUCCESS`,
        status: 'SUCCESS',
        source: 'Tier_3.js',
        functionName: 'generateTier3Token',
        requestId: requestMetadata?.requestId,
        ipAddress: ip,
        impact: 'Tier 3 token generated successfully',
        metadata: {
            authMethod: authMethod,
            role: role,
            expiry: expiry,
            tokenId: tokenData.tokenId,
            tokenType
        }
    });

    return { error: false, token: token, accessTokenLinkCode: accessTokenLinkCode };
}

const validateTier3Token = async () => {
    
}