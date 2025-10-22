import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { generateId } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, isUnixExpired } from '../../Date&Time.js';
import { timingSafeEqual } from 'crypto';

async function generateRefreshToken(uid, email, fingerprint, authMethod, role, ip, userAgent, accessTokenLinkCode) {
    const secret = await await globalAccessPoint.getValue("tokenSecretsManager").getRandomKeyPair("refresh");
    const expiry = globalAccessPoint.getValue("systemConfig").tokens?.lifespans.refreshTokens || "15m";
    const aud = globalAccessPoint.getValue("systemConfig").client.urls;
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

    let data = await globalAccessPoint.db().getData("Users", uid);

    let user = data.data;

    user.security.activeTokens.push(dbTokenData);

    const filteredArray = user.security.activeTokens.filter(value => isUnixExpired(value.exp) === false);
    user.security.activeTokens = filteredArray;

    const storage = await globalAccessPoint.db().addData("Users", uid, user);

    if (storage.error) {
        return { error: true, errorCode: "UNABLE-TO-GENERATE-REFRESH-TOKEN" };
    }

    const token = jwt.sign(payload, secret.privateKey, { expiresIn: expiry, algorithm: "RS256" , keyid: secret.keyPairId });

    return { error: false, token: token };
}

async function validateRefreshToken(token, fingerprint, ip, clientUrl) {
    try {
        
        if (!token) {
            return { error: true, errorCode: "MISSING-AUTHENTICATION-TOKEN" }
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;

        const secret = await globalAccessPoint.getValue("tokenSecretsManager").getKeyPairById(decodedHeader.kid, "refresh");
        const serverUrl = globalAccessPoint.getValue("systemConfig").server.myUrl;

        const validatedToken = jwt.verify(token, secret.publicKey, { algorithms: ['RS256'] });

        if (!validatedToken.aud.includes(clientUrl)) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-INVALID-AUD" }
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-ISS-NOT-ALLOWED" }
        }

        if (! (await isIpInRange(ip, validatedToken.ipRange))) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE" };
        }

        let data = await globalAccessPoint.db().getData("Users", validatedToken.uid);

        let user = data.data;

        const activeTokens = user.security.activeTokens;
        const tokenData = activeTokens.find(value => value.tokenId === validatedToken.tokenData.tokenId);

        if (!tokenData) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-ID-NOT-FOUND" };
        }

        if (tokenData.type !== "REFRESH_TOKEN") {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-TYPE-MISMATCH" };
        }

        if (!timingSafeEqual(Buffer.from(validatedToken.hashedDeviceFingerprint), Buffer.from(tokenData.hashedFingerprint))) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1" }
        }

        if ((await verifyHash(fingerprint, tokenData.hashedFingerprint)) === false) {
            const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
            user.security.activeTokens = newArray;
            await globalAccessPoint.db().addData("Users", validatedToken.uid, user);
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2" }
        }

        return { error: false, valid: true, data: validatedToken };
    } catch (e) {
        if (e.message === "jwt expired") {
            return { error: true, errorCode: "REFRESH-TOKEN-EXPIRED" };
        }

        return { error: true, errorCode: "UNABLE-TO-VALIDATE-REFRESH-TOKEN" };
    }
}

export { generateRefreshToken, validateRefreshToken };