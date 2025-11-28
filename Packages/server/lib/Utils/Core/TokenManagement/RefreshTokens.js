import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { generateId } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, isUnixExpired } from '../../Date&Time.js';
import { timingSafeEqual } from 'crypto';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';

async function generateRefreshToken(uid, email, fingerprint, authMethod, role, ip, userAgent, accessTokenLinkCode) {
    const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
    const requestMetadata = requestContext.getStore();

    const secret = await globalAccessPoint.getValue("tokenSecretsManager").getRandomKeyPair("refresh");
    const expiry = globalAccessPoint.getValue("systemConfig").tokens?.lifespans.refreshTokens || "15m";
    const aud = globalAccessPoint.getValue("allowedClientUrls");
    const iss = globalAccessPoint.getValue("systemConfig").server.urls;

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const tokenData = {
        tokenId: generateId("REFRESH_TOKEN", 15),
        type: "REFRESH_TOKEN",
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
        uid,
        email,
        hashedDeviceFingerprint: hashedFingerprint,
        authMethod,
        role,
        tokenData,
        ipRange,

        // Standard JWT fields
        jti: tokenData.tokenId,
        aud,
        iss,
        sub: uid
    };

    let data = await globalAccessPoint.db().getData("Users", uid);
    let user = data.data;

    user.security.activeTokens.push(dbTokenData);
    user.security.activeTokens = user.security.activeTokens.filter(v => !isUnixExpired(v.exp));

    const storage = await globalAccessPoint.db().addData("Users", uid, user);

    if (storage.error) {
        auditTrail.record({
            user: { email, uid },
            device: { fingerprint, userAgent },
            action: "REFRESH_TOKEN_GENERATION_ATTEMPT",
            status: "FAILED",
            source: "RefreshTokens.js",
            functionName: "generateRefreshToken",
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: "Refresh token generation failed - database error",
            metadata: {
                reason: "DATABASE_ERROR",
                authMethod,
                role
            },
            errorCode: "UNABLE-TO-GENERATE-REFRESH-TOKEN"
        });
        return { error: true, errorCode: "UNABLE-TO-GENERATE-REFRESH-TOKEN" };
    }

    const token = jwt.sign(payload, secret.privateKey, {
        expiresIn: expiry,
        algorithm: "RS256",
        keyid: secret.keyPairId
    });

    auditTrail.record({
        user: { email, uid },
        device: { fingerprint, userAgent },
        action: "REFRESH_TOKEN_GENERATION_SUCCESS",
        status: "SUCCESS",
        source: "RefreshTokens.js",
        functionName: "generateRefreshToken",
        requestId: requestMetadata?.requestId,
        ipAddress: ip,
        impact: "Refresh token generated successfully",
        metadata: {
            authMethod,
            role,
            expiry,
            tokenId: tokenData.tokenId
        }
    });

    return { error: false, token };
}

async function validateRefreshToken(token, fingerprint, ip, clientUrl) {
    const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
    const requestMetadata = requestContext.getStore();

    try {
        if (!token) {
            auditTrail.record({
                user: {},
                device: { fingerprint, userAgent: requestMetadata?.userAgent },
                action: "REFRESH_TOKEN_VALIDATION_ATTEMPT",
                status: "FAILED",
                source: "RefreshTokens.js",
                functionName: "validateRefreshToken",
                requestId: requestMetadata?.requestId,
                ipAddress: ip,
                impact: "Refresh token validation failed - missing token",
                metadata: { reason: "MISSING_TOKEN" },
                errorCode: "MISSING-AUTHENTICATION-TOKEN"
            });
            return { error: true, errorCode: "MISSING-AUTHENTICATION-TOKEN" };
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;
        const secret = await globalAccessPoint
            .getValue("tokenSecretsManager")
            .getKeyPairById(decodedHeader.kid, "refresh");
        const serverUrl = globalAccessPoint.getValue("systemConfig").server.myUrl;

        if (secret.notFound) {
            return { error: true, errorCode: "REFRESH-TOKEN-KEY-NOT-FOUND" }
        }

        const validatedToken = jwt.verify(token, secret.publicKey, { algorithms: ["RS256"] });

        if (!validatedToken.aud.includes(clientUrl) && !globalAccessPoint.getValue("allowedClientUrls").includes(clientUrl)) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-INVALID-AUD" };
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-ISS-NOT-ALLOWED" };
        }

        if (!(await isIpInRange(ip, validatedToken.ipRange))) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE" };
        }

        let data = await globalAccessPoint.db().getData("Users", validatedToken.uid);
        let user = data.data;
        const activeTokens = user.security.activeTokens;

        const tokenData = activeTokens.find(v => v.tokenId === validatedToken.tokenData.tokenId);
        if (!tokenData) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND" };
        }

        if (tokenData.type !== "REFRESH_TOKEN") {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH" };
        }

        if (!timingSafeEqual(Buffer.from(validatedToken.hashedDeviceFingerprint), Buffer.from(tokenData.hashedFingerprint))) {
            const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
            user.security.activeTokens = newArray;
            await globalAccessPoint.db().addData("Users", validatedToken.uid, user);
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1" };
        }

        if ((await verifyHash(fingerprint, tokenData.hashedFingerprint)) === false) {
            const newArray = activeTokens.filter(v => v.tokenId !== validatedToken.tokenData.tokenId);
            user.security.activeTokens = newArray;
            await globalAccessPoint.db().addData("Users", validatedToken.uid, user);
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2" };
        }

        auditTrail.record({
            user: { email: validatedToken.email, uid: validatedToken.uid },
            device: { fingerprint, userAgent: requestMetadata?.userAgent },
            action: "REFRESH_TOKEN_VALIDATION_SUCCESS",
            status: "SUCCESS",
            source: "RefreshTokens.js",
            functionName: "validateRefreshToken",
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: "Refresh token validated successfully",
            metadata: {
                authMethod: validatedToken.authMethod,
                role: validatedToken.role,
                tokenId: validatedToken.tokenData.tokenId
            }
        });

        return { error: false, valid: true, data: validatedToken };
    } catch (e) {
        if (e.message === "jwt expired") {
            auditTrail.record({
                user: {},
                device: { fingerprint, userAgent: requestMetadata?.userAgent },
                action: "REFRESH_TOKEN_VALIDATION_FAILED",
                status: "FAILED",
                source: "RefreshTokens.js",
                functionName: "validateRefreshToken",
                requestId: requestMetadata?.requestId,
                ipAddress: ip,
                impact: "Refresh token expired",
                metadata: { reason: "TOKEN_EXPIRED" },
                errorCode: "REFRESH-TOKEN-EXPIRED"
            });
            return { error: true, errorCode: "REFRESH-TOKEN-EXPIRED" };
        }

        auditTrail.record({
            user: {},
            device: { fingerprint, userAgent: requestMetadata?.userAgent },
            action: "REFRESH_TOKEN_VALIDATION_FAILED",
            status: "FAILED",
            source: "RefreshTokens.js",
            functionName: "validateRefreshToken",
            requestId: requestMetadata?.requestId,
            ipAddress: ip,
            impact: "Unable to validate refresh token",
            metadata: { reason: e.message },
            errorCode: "UNABLE-TO-VALIDATE-REFRESH-TOKEN"
        });

        return { error: true, errorCode: "UNABLE-TO-VALIDATE-REFRESH-TOKEN" };
    }
}

export { generateRefreshToken, validateRefreshToken };