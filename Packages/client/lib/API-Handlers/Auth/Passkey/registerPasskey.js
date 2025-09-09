import { startRegistration } from "../../../External-Scripts/webAuthn.js";

async function registerPasskey({ Api, getAuthHeader, dipConfig, This }) {
  const authHeader = await getAuthHeader(true, "ACCESS_BEARER");

  const res = await Api.fetch(
    `/${This.systemConfig.nameSpace}/api/v1/action/generate-passkey-registration-options`,
    "POST",
    authHeader.authHead,
    {},
    null,
    null
  );

  const data = await res.json();
  
  if (data.error) return { error: true, errorCode: "CLIENT-PASSKEY-REG-OPTIONS-FAILED" };

  const passkeyRegistration = await startRegistration({ optionsJSON: data.data.options });

  const encryptedPayload = await Api.prepareDataForEncryption({ registrationResponse: passkeyRegistration });

  const postEncryptionPayload = {
    packet: { encryptedString: encryptedPayload.encryptedString }
  };

  const dipSignature = await Api.prepareDataForDIP(postEncryptionPayload, dipConfig);

  const dipOptions = {
    ...dipConfig,
    dipState: "ACTIVE",
    dipSignature: dipSignature.dipSignature,
    salt: dipSignature.salt,
    timestamp: dipSignature.timestamp
  };

  const finalRes = await Api.fetch(
    `/${This.systemConfig.nameSpace}/api/v1/action/complete-passkey-registration`,
    "POST",
    authHeader.authHead,
    postEncryptionPayload,
    dipOptions,
    encryptedPayload.encryption
  );

  const data2 = await finalRes.json();
  if (data2.error) return { error: true, errorCode: "CLIENT-UNABLE-TO-REGISTER-PASSKEY" };

  return { error: false, complete: true };
}

export { registerPasskey };