const { generateAuthenticationOptions } = require("@simplewebauthn/server");
const { globalAccessPoint } = require("../../../GlobalAccessPoint");
const { sanitizeString } = require("../../../Sanitizer");
const { tryCatch } = require("../../../TryCatch");
const { isValidEmail } = require("../../../Validator");
const {
  respondWithError,
  respondWithSuccess,
} = require("../../../../Server/Response/response");

const generatePasskeyAuthenticationOptionsExistingUser = async (
  email,
  clientURL
) => {
  const Function = async (parameters) => {
    const lowerCaseEmail = parameters.email.toLowerCase();

    const sanitizedEmail = sanitizeString(lowerCaseEmail);

    const emailValid = isValidEmail(sanitizedEmail);

    if (!emailValid) {
      return { error: true, errorCode: "PASSKEY-AUTH-INVALID-EMAIL" };
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

    if (!user.data.credentials.passkey.exist) {
      return {
        error: true,
        errorCode: "PASSKEY-AUTH-NO-ACTIVE-PASSKEY",
      };
    }

    const options = await generateAuthenticationOptions({
      rpId: parameters.clientURL,
      allowCredentials: [
        {
          id: user.data.credentials.passkey.creds.id,
          type: "public-key",
          transports: user.data.credentials.passkey.creds.transports,
        },
      ],
    });

    return {
      error: false,
      options: options,
      cookies: [
        {
          key: "PASSKEY-AUTHENTICATION-INFO-STEP-1",
          data: {
            uid: user.data.credentials.uid,
            id: options.id,
            email: lowerCaseEmail,
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

const routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser = async (
  request,
  response
) => {
  const email = request.body.packet.email;
  const clientURL = request.get("Origin") || request.get("Referer");

  const parsedClientURL =
    clientURL.split("//")[clientURL.split("//").length - 1];

  const callback = await generatePasskeyAuthenticationOptionsExistingUser(
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

module.exports = {
  routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser,
};
