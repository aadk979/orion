const jwt = require('jsonwebtoken');
const { globalAccessPoint } = require('../../GlobalAccessPoint');
const { hashString, generateEncryptionKey, encrypt, decrypt, verifyHash } = require('../../CryptoFunctions');
const { generateChallenge, generateId } = require('../../valueGenerator');
const { getIpRange, isIpInRange } = require('../../Ip');
const { getFutureUnixTime, isUnixExpired } = require('../../Date&Time');

async function generateAccessToken(uid, email, fingerprint, authMethod, role, ip, userAgent) {
    const secret = globalAccessPoint.getValue("systemConfig").tokens?.secrets.accessTokens || crypto.randomBytes(256).toString("hex");
    const expiry = globalAccessPoint.getValue("systemConfig").tokens?.lifespans.accessTokens || "15m";
    const encryptionKey = globalAccessPoint.getValue("systemConfig").tokens?.encryptionKeys.accessTokens || generateEncryptionKey();

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const tokenData = {
        tokenId: generateId("ACCESS_TOKEN", 15),
        challenge: generateChallenge(32),
        type: "ACCESS_TOKEN"
    }

    const dbTokenData = {
        tokenId: tokenData.tokenId,
        challenge: await hashString(tokenData.challenge),
        exp: getFutureUnixTime("15m"),
        type: tokenData.type,
        userAgent: userAgent
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
            maxAge: 1000 * 60 * 16,
        }
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
    const encryptedToken = await encrypt(token, encryptionKey);

    return { error: false, token: encryptedToken, cookies: [storageCookieData] }
}

async function validateAccessToken(token, cookieData, fingerprint, ip) {
    try {
        const secret = globalAccessPoint.getValue("systemConfig").tokens.secrets.accessTokens || crypto.randomBytes(256).toString("hex");
        const encryptionKey = globalAccessPoint.getValue("systemConfig").tokens.encryptionKeys.accessTokens || generateEncryptionKey();

        const decryptedToken = await decrypt(token, encryptionKey);
        const validatedToken = jwt.verify(decryptedToken, secret);
        const cookieDataToken = validatedToken.cookieData;

        if (!isIpInRange(ip, validatedToken.ipRange)) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-IP-NOT-IN-RANGE" }
        }

        if (cookieData.key !== cookieDataToken.key) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-COOKIE-KEY-MISMATCH" }
        }

        if ((await verifyHash(cookieDataToken.challenge, cookieData.data.challenge)) === false) {
            return { error: true, errorCode: "INVALID-ACCESS-TOKEN-COOKIE-CHALLENGE-MISMATCH" }
        }

        if ((await verifyHash(fingerprint, cookieData.data.hashedDeviceFingerprint)) === false) {
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
        return { error: true, errorCode: "UNABLE-TO-VALIDATE-ACCESS-TOKEN" }
    }
}

module.exports = { generateAccessToken, validateAccessToken };
