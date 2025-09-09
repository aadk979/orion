const jwt = require('jsonwebtoken');
const { globalAccessPoint } = require('../../GlobalAccessPoint');
const { hashString, encrypt, decrypt, verifyHash, importKeyFromBase64 } = require('../../CryptoFunctions');
const { generateChallenge, generateId, generateRandomNumber } = require('../../valueGenerator');
const { getIpRange, isIpInRange } = require('../../Ip');
const { getFutureUnixTime, isUnixExpired, parseDuration } = require('../../Date&Time');
const { logger } = require('../../logger');

async function generateAccessToken(uid, email, fingerprint, authMethod, role, ip, userAgent , accessTokenLinkCodeExternal) {
    const secret = globalAccessPoint.getValue("systemConfig").tokens?.secrets.accessTokens || undefined;
    const expiry = globalAccessPoint.getValue("systemConfig").tokens?.lifespans.accessTokens || "15m";
    const encryptionKey = importKeyFromBase64(globalAccessPoint.getValue("systemConfig").tokens?.encryptionKeys.accessTokens) || undefined;

    if (!secret || !encryptionKey) {
        logger.error("CRITICAL: Access token secret or encryption key is not set in the system config.");
        return { error: true, errorCode: "UNABLE-TO-GENERATE-ACCESS-TOKEN" };
    }

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const accessTokenLinkCode = accessTokenLinkCodeExternal || generateRandomNumber(45);

    const tokenData = {
        tokenId: generateId("ACCESS_TOKEN", 15),
        challenge: generateChallenge(32),
        type: "ACCESS_TOKEN",
        accessTokenLinkCode: accessTokenLinkCode
    }

    const dbTokenData = {
        tokenId: tokenData.tokenId,
        challenge: await hashString(tokenData.challenge),
        exp: getFutureUnixTime(expiry),
        type: tokenData.type,
        userAgent: userAgent,
        accessTokenLinkCode: accessTokenLinkCode
    }

    const cookieData = {
        key: generateId("COOKIE_KEY", 15),
        challenge: generateChallenge(32)
    }

    const storageCookieData = {
        key: cookieData.key,
        data: {
            challenge: await hashString(cookieData.challenge),
            hashedDeviceFingerprint: hashedFingerprint,
        },
        maxAge: parseDuration(expiry) + parseDuration("15m"),
    }

    const payload = {
        uid: uid,
        email: email,
        hashedDeviceFingerprint: hashedFingerprint,
        authMethod: authMethod,
        role: role,
        tokenData,
        cookieData,
        ipRange
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

    const token = jwt.sign(payload, secret, { expiresIn: expiry });
    const encryptedToken = encrypt(token, encryptionKey);

    return { error: false, token: encryptedToken, cookies: [storageCookieData] , accessTokenLinkCode: accessTokenLinkCode };
}

async function validateAccessToken(token, cookies, fingerprint, ip) {
    const secret = globalAccessPoint.getValue("systemConfig").tokens.secrets.accessTokens || undefined;
    const encryptionKey = importKeyFromBase64(globalAccessPoint.getValue("systemConfig").tokens?.encryptionKeys.accessTokens) || undefined;

    if (!secret || !encryptionKey) {
        logger.error("CRITICAL: Access token secret or encryption key is not set in the system config.");
        return { error: true, errorCode: "UNABLE-TO-VALIDATE-ACCESS-TOKEN" }
    }

    try {

        if (!token) {
            return { error: true, errorCode: "MISSING-AUTHENTICATION-TOKEN" }
        }

        const decryptedToken = decrypt(token, encryptionKey);
        const validatedToken = jwt.verify(decryptedToken, secret);
        const cookieDataToken = validatedToken.cookieData;

        if (!isIpInRange(ip, validatedToken.ipRange)) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE" }
        }

        const cookieData = cookies[cookieDataToken.key] ? JSON.parse(cookies[cookieDataToken.key]) : undefined;

        if (!cookieData) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-COOKIE-NOT-FOUND" };
        }

        if ((await verifyHash(cookieDataToken.challenge, cookieData.challenge)) === false) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-COOKIE-CHALLENGE-MISMATCH" }
        }

        if ((await verifyHash(fingerprint, cookieData.hashedDeviceFingerprint)) === false) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-COOKIE-DEVICE-FINGERPRINT-MISMATCH" }
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

        if ((await verifyHash(validatedToken.tokenData.challenge, tokenData.challenge)) === false) {
            const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
            user.security.activeTokens = newArray;
            await globalAccessPoint.db().addData("Users", validatedToken.uid, user);
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-TOKEN-CHALLENGE-MISMATCH" }
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

module.exports = { generateAccessToken, validateAccessToken };
