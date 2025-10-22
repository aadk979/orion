// Orion JWT System – Version 2
// It transitions from symmetric signing to asymmetric signing, providing stronger security
// and enabling easier key distribution via JWKs.

import jwt from 'jsonwebtoken';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { generateId, generateRandomNumber } from '../../valueGenerator.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { getFutureUnixTime, isUnixExpired } from '../../Date&Time.js';
import { timingSafeEqual } from 'crypto';

async function generateAccessToken(uid, email, fingerprint, authMethod, role, ip, userAgent , accessTokenLinkCodeExternal) {
    const secret = await globalAccessPoint.getValue("tokenSecretsManager").getRandomKeyPair("access");
    const expiry = globalAccessPoint.getValue("systemConfig").tokens?.lifespans.accessTokens || "15m";
    const aud = globalAccessPoint.getValue("systemConfig").client.urls;
    const iss = globalAccessPoint.getValue("systemConfig").server.urls;

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const accessTokenLinkCode = accessTokenLinkCodeExternal || generateRandomNumber(45);

    const tokenData = {
        tokenId: generateId("ACCESS_TOKEN", 15),
        type: "ACCESS_TOKEN",
        accessTokenLinkCode: accessTokenLinkCode
    }

    const dbTokenData = {
        tokenId: tokenData.tokenId,
        exp: getFutureUnixTime(expiry),
        type: tokenData.type,
        userAgent: userAgent,
        accessTokenLinkCode: accessTokenLinkCode,
        hashedFingerprint
    }

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
    }

    let data = await globalAccessPoint.db().getData("Users", uid);

    let user = data.data;

    user.security.activeTokens.push(dbTokenData);

    const filteredArray = user.security.activeTokens.filter(value => isUnixExpired(value.exp) === false);

    user.security.activeTokens = filteredArray;

    const storage = await globalAccessPoint.db().addData("Users", uid, user);

    if (storage.error) {
        return { error: true, errorCode: "UNABLE-TO-GENERATE-ACCESS-TOKEN" }
    }

    const token = jwt.sign(payload, secret.privateKey, { expiresIn: expiry, algorithm: "RS256" , keyid: secret.keyPairId });

    return { error: false, token: token, accessTokenLinkCode: accessTokenLinkCode };
}

async function validateAccessToken(token, fingerprint, ip, clientUrl) {
    try {
        console.log(clientUrl)
        
        if (!token) {
            return { error: true, errorCode: "MISSING-AUTHENTICATION-TOKEN" }
        }

        const decodedHeader = jwt.decode(token, { complete: true }).header;

        const secret = await globalAccessPoint.getValue("tokenSecretsManager").getKeyPairById(decodedHeader.kid, "access");
        const serverUrl = globalAccessPoint.getValue("systemConfig").server.myUrl;

        const validatedToken = jwt.verify(token, secret.publicKey, { algorithms: ['RS256'] });

        if (!validatedToken.aud.includes(clientUrl)) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-INVALID-AUD" }
        }

        if (!validatedToken.iss.includes(serverUrl)) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-ISS-NOT-ALLOWED" }
        }

        if (! (await isIpInRange(ip, validatedToken.ipRange))) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE" }
        }

        let data = await globalAccessPoint.db().getData("Users", validatedToken.uid);

        let user = data.data;
        
        const activeTokens = user.security.activeTokens;

        const tokenData = activeTokens.find(value => value.tokenId === validatedToken.tokenData.tokenId);
        
        if (!tokenData) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-TOKEN-ID-NOT-FOUND" }
        }

        if (tokenData.type !== "ACCESS_TOKEN") {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-TOKEN-TYPE-MISMATCH" }
        }

        if (!timingSafeEqual(Buffer.from(validatedToken.hashedDeviceFingerprint), Buffer.from(tokenData.hashedFingerprint))) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-1" }
        }

        if ((await verifyHash(fingerprint, tokenData.hashedFingerprint)) === false) {
            const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
            user.security.activeTokens = newArray;
            await globalAccessPoint.db().addData("Users", validatedToken.uid, user);
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-TOKEN-DEVICE-FINGERPRINT-MISMATCH-TYPE-2" }
        }

        return { error: false, valid: true, data: validatedToken }

    } catch (e) {
        if (e.message === "jwt expired") {
            return { error: true, errorCode: "ACCESS-TOKEN-EXPIRED" }
        }

        console.error(e)
        return { error: true, errorCode: "UNABLE-TO-VALIDATE-ACCESS-TOKEN" }
    }
}

export { generateAccessToken, validateAccessToken };