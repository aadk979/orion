// This file contains crypto functions for client to server encryption

const crypto = require("crypto");

async function generateKeyPairDedicated(length) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: length || 4096,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    return { publicKey , privateKey };
}

async function encryptPublic(data, publicKey) {
    try {
        const encryptedData = crypto.publicEncrypt(
            {
                key: publicKey,
                padding: crypto.constants.RSA_OAEP_PADDING,
                oaepHash: "sha256",
            },
            Buffer.from(data, "utf-8")
        );

        return encryptedData.toString("base64");
    } catch (e) {
        return { error: true, context: e.message };
    }
}

async function decryptPrivate(encryptedData , privateKey) {
    try{
        const decryptedData = crypto.privateDecrypt(
            {
              key: privateKey,
              padding: crypto.constants.RSA_OAEP_PADDING,
              oaepHash: "sha256",
            },
            Buffer.from(encryptedData, "base64")
        );

        return decryptedData.toString();
    }
    catch(e){
        return { error: true , context: e.message }
    }
}

module.exports = {
  generateKeyPairDedicated ,
  encryptPublic ,
  decryptPrivate
}