import { sanitizeInput, isValidEmail } from "../../Utils/Utils.js";

async function signInUser({ Api, orionVault, email, password, dipConfig, getAuthHeader, This}) {
  if (!email || !password) return { error: true, errorCode: "CLIENT-MISSING-DATA" };

  const cleanedEmail = sanitizeInput(email);
  const cleanedPassword = sanitizeInput(password);

  if (!isValidEmail(cleanedEmail)) return { error: true, errorCode: "CLIENT-INVALID-EMAIL" };
  if (cleanedPassword.length < 8) return { error: true, errorCode: "CLIENT-PASSWORD-TOO-SHORT" };

  const encryptedPayload = await Api.prepareDataForEncryption({ email: cleanedEmail, password: cleanedPassword });
  const authHeader = await getAuthHeader(false, "NO_AUTH_BEARER");

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

  const request = await Api.fetch(
    `/${This.systemConfig.nameSpace}/api/v1/action/sign-in-user`,
    "POST",
    authHeader.authHead,
    postEncryptionPayload,
    dipOptions,
    encryptedPayload.encryption
  );

  const data = await request.json();
  if (data.error) return data.errorData;

  await orionVault.setItem("USER_EMAIL", cleanedEmail);

  This.setUserSignedInState(true);
  This.setUser(cleanedEmail)

  return { error: false, complete: true };
}

export { signInUser };