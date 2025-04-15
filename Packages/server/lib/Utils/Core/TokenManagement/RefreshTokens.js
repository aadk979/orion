const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { globalAccessPoint } = require('../../GlobalAccessPoint');
const { hashString, generateEncryptionKey, encrypt, decrypt, verifyHash } = require('../../CryptoFunctions');
const { generateChallenge, generateId } = require('../../valueGenerator');
const { getIpRange, isIpInRange } = require('../../Ip');
const { getFutureUnixTime, isUnixExpired } = require('../../Date&Time');

async function generateRefreshToken(uid, email, fingerprint, authMethod, role, ip, cookieData, userAgent) {
    const config = globalAccessPoint.getValue("systemConfig").tokens;
    const secret = config?.secrets.refreshTokens || crypto.randomBytes(256).toString("hex");
    const expiry = config?.lifespans.refreshTokens || "15m";
    const encryptionKey = config?.encryptionKeys.refreshTokens || generateEncryptionKey();

    const hashedFingerprint = await hashString(fingerprint);
    const ipRange = getIpRange(ip);

    const tokenData = {
        tokenId: generateId("REFRESH_TOKEN", 15),
        challenge: generateChallenge(32),
        type: "REFRESH_TOKEN"
    };

    const dbTokenData = {
        tokenId: tokenData.tokenId,
        challenge: await hashString(tokenData.challenge),
        exp: getFutureUnixTime(expiry),
        type: tokenData.type,
        userAgent: userAgent
    };

    const payload = {
        uid: uid,
        email: email,
        hashedDeviceFingerprint: hashedFingerprint,
        authMethod: authMethod,
        role: role,
        tokenData,
        cookieKey: cookieData.key,
        ipRange
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

    const token = jwt.sign(payload, secret, { expiresIn: expiry });
    const encryptedToken = await encrypt(token, encryptionKey);

    return { error: false, token: encryptedToken };
}

async function validateRefreshToken(token, fingerprint, ip) {
    const config = globalAccessPoint.getValue("systemConfig").tokens;
    const secret = config.secrets.refreshTokens || crypto.randomBytes(256).toString("hex");
    const encryptionKey = config.encryptionKeys.refreshTokens || generateEncryptionKey();

    try {
        const decryptedToken = await decrypt(token, encryptionKey);
        const validatedToken = jwt.verify(decryptedToken, secret);

        if (!isIpInRange(ip, validatedToken.ipRange)) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-IP-NOT-IN-RANGE" };
        }

        if ((await verifyHash(fingerprint, validatedToken.hashedDeviceFingerprint)) === false) {
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-DEVICE-FINGERPRINT-MISMATCH" };
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

        if ((await verifyHash(validatedToken.tokenData.challenge, tokenData.challenge)) === false) {
            const newArray = activeTokens.filter(value => value.tokenId !== validatedToken.tokenData.tokenId);
            user.security.activeTokens = newArray;
            await globalAccessPoint.db().addData("Users", validatedToken.uid, user);
            return { error: true, errorCode: "INVALID-REFRESH-TOKEN-TOKEN-CHALLENGE-MISMATCH" };
        }

        return { error: false, valid: true, data: validatedToken };
    } catch (e) {
        if (e.message === "jwt expired") {
            return { error: true, errorCode: "REFRESH-TOKEN-EXPIRED" };
        }

        return { error: true, errorCode: "UNABLE-TO-VALIDATE-REFRESH-TOKEN" };
    }
}

module.exports = { generateRefreshToken, validateRefreshToken };