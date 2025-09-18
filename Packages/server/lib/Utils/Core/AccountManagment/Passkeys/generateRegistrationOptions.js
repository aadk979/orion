const { generateRegistrationOptions } = require("@simplewebauthn/server");
const { globalAccessPoint } = require("../../../GlobalAccessPoint");
const { sanitizeString } = require("../../../Sanitizer");
const { tryCatch } = require("../../../TryCatch");
const { isValidEmail } = require("../../../Validator");
const {
  respondWithError,
  respondWithSuccess,
} = require("../../../../Server/Response/response");

const generatePasskeyRegistrationOptionsExistingUser = async (
  email,
  clientURL
) => {
  const Function = async (parameters) => {
    const systemConfig = globalAccessPoint.getValue("systemConfig");

    if (!systemConfig.authMethods.passkey) {
      return { error: true, errorCode: "PASSKEY-SIGN-IN-DISABLED" };
    }

    const rpName = "Orion";

    const lowerCaseEmail = parameters.email.toLowerCase();

    const sanitizedEmail = sanitizeString(lowerCaseEmail);

    const emailValid = isValidEmail(sanitizedEmail);

    if (!emailValid) {
      return { error: true, errorCode: "PASSKEY-REG-INVALID-EMAIL" };
    }

    const userLink = await globalAccessPoint
      .db()
      .getData("Users-email", sanitizedEmail);

    if (userLink.data === undefined) {
      return { error: true, errorCode: "PASSKEY-ACC-NO-EXIST" };
    }

    const user = await globalAccessPoint
      .db()
      .getData("Users", userLink.data.uid);

    if (user.data.credentials.passkey.exist) {
      return {
        error: true,
        errorCode: "PASSKEY-REGISTRATION-ACTIVE-PASSKEY-DETECTED",
      };
    }

    console.log(parameters.clientURL);

    const options = await generateRegistrationOptions({
      rpId: parameters.clientURL,
      rpName: rpName,
      userid: Uint8Array.from(user.data.credentials.uid, (c) =>
        c.charCodeAt(0)
      ),
      userName: parameters.email,
      userDisplayName: parameters.email.split("@")[0],
    });

    return {
      error: false,
      options: options,
      cookies: [
        {
          key: "PASSKEY-REGISTRATION-INFO-STEP-1",
          data: {
            uid: user.data.credentials.uid,
            id: options.user.id,
            email: email,
            challenge: options.challenge,
          },
          maxAge: 30 * 1000,
        },
      ],
    };
  };

  const parameters = {
    email,
    clientURL,
  };

  const results = await tryCatch(Function, true, parameters);

  return results;
};

const routeHandlerGeneratePasskeyRegistrationOptionsExistingUser = async (
  request,
  response
) => {
  const email = request.user.email;
  const clientURL = request.get("Origin") || request.get("Referer");

  const parsedClientURL =
    clientURL.split("//")[clientURL.split("//").length - 1];

  const callback = await generatePasskeyRegistrationOptionsExistingUser(
    email,
    parsedClientURL
  );

  if (callback.error) {
    return respondWithError(response, callback.errorCode);
  }

  if (callback.cookies) {
    for (let i = 0; i < callback.cookies.length; i++) {
      const cookie = callback.cookies[i];
      response.cookie(cookie.key, JSON.stringify(cookie.data), {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: cookie.maxAge,
      });
    }
  }

  return respondWithSuccess(response, 200, { options: callback.options });
};

module.exports = { routeHandlerGeneratePasskeyRegistrationOptionsExistingUser };
