// This is functionaly the same code as Api.js but a secondary one was created to prevent ciruclar dependency in some modules

import {
  encryptAESGCM,
  encryptPublic,
  exportKeyBase64,
  generateAES256Key,
  generateHmac,
} from "./CryptoModule.js";
import { getDeviceFingerprint } from "./DevicePrint.js";
import { generateNonce } from "./Utils.js";

class ApiInterface {
  constructor(baseUrl, nameSpace, slug) {
    this.baseUrl = baseUrl;
    this.nameSpace = nameSpace;
    this.slug = slug;
  }

  async fetch(endpoint, method, authorization, body = {}, dip, encryption) {
    const url = `${this.baseUrl}${this.slug !== "" ? "/" + this.slug : ""}${endpoint}`;

    const response = await fetch(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        "orion-fingerprint": await getDeviceFingerprint(),
        "orion-user-agent": navigator.userAgent,
        "orion-dip-state": dip ? dip?.dipState : "NO DATA",
        "orion-dip-id": dip ? dip?.dipId : "DEFAULT NONE",
        "orion-dip-signature": dip ? dip?.dipSignature : "DEFAULT NONE",
        "orion-dip-salt": dip ? dip?.salt : "DEFAULT NONE",
        "orion-dip-timestamp": dip ? dip?.timestamp : "DEFAULT NONE",
        "orion-encryption-status": encryption
          ? encryption.encryptionStatus
          : "NONE",
        "orion-encryption-request-id": encryption
          ? encryption.encryptionRequestId
          : "NONE",
        "orion-api-system-version": "1.0.0[BETA]",
        Origin: window.location.origin,
        Authorization: authorization,
      },
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });

    const refresh = response.headers.get("orion-response-refresh") || response.headers.get("Orion-Response-Refresh");

    if (refresh) {

      if (String(refresh) === "true") {
        window.location.reload();
      }
      
    }

    return response;
  }

  async prepareDataForEncryption(data) {
    const key = await this.fetch(
      `/${this.nameSpace}/api/v1/request/encryption-request-key`,
      "POST",
      "NO_AUTH_BEARER"
    );

    if (!key.ok) {
      return { error: true, errorCode: "CLIENT-UNABLE-TO-GET-KEY" };
    }

    const dataServer = await key.json();

    const pubKey = dataServer.data.publicKey;

    const secureTransportEncryptionKey = await generateAES256Key();

    const str = JSON.stringify(data);

    const encryptedClientPayload = await encryptAESGCM(
      str,
      secureTransportEncryptionKey
    );

    const exportableKey = exportKeyBase64(secureTransportEncryptionKey);

    const encryptedSecureTransportEncryptionKey = await encryptPublic(
      exportableKey,
      pubKey
    );

    const compressedPayload = JSON.stringify({
      payload: encryptedClientPayload,
      encryptedSecureTransportEncryptionKey:
        encryptedSecureTransportEncryptionKey,
    });

    return {
      encryptedString: compressedPayload,
      encryption: {
        encryptionStatus: "ENCRYPTED",
        encryptionRequestId: dataServer.data.requestId,
      },
    };
  }

  async prepareDataForDIP(data, dipConfig) {
    if (dipConfig?.disabled) {
      return { disabled: true }
    }
    
    const stringData = JSON.stringify(data);

    const saltArray = new Uint8Array(16); // 16 bytes = 128 bits
    window.crypto.getRandomValues(saltArray);
    const salt = Array.from(saltArray)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const date = new Date();

    const deviceFingerprint = await getDeviceFingerprint();

    const pad = (n, width = 2) => n.toString().padStart(width, "0");
    const timestamp = `UTC|${date.getUTCFullYear()}-${pad(
      date.getUTCMonth() + 1
    )}-${pad(date.getUTCDate())}|${pad(date.getUTCHours())}:${pad(
      date.getUTCMinutes()
    )}:${pad(date.getUTCSeconds())}.${pad(
      date.getUTCMilliseconds(),
      3
    )}|Epoch:${date.getTime()}`;

    const nonceFn = generateNonce();

    const nonce = nonceFn();

    const randomBits = crypto.getRandomValues(new Uint32Array(1))[0];
    const fullTimestamp = `${timestamp}|Rand:${randomBits}|Nonce:${nonce}`;

    const signature = await generateHmac(
      stringData +
        salt +
        fullTimestamp +
        navigator.userAgent +
        deviceFingerprint,
      dipConfig.signatureKey
    );

    return { dipSignature: signature, salt: salt, timestamp: fullTimestamp };
  }
}

export { ApiInterface };