const { verifyAuthenticationResponse } = require("@simplewebauthn/server");
const { globalAccessPoint } = require("../../../GlobalAccessPoint");
const { tryCatch } = require("../../../TryCatch");

const veryifyAndCompletePasskeyAuthentication = async (authenticationResponse, cookie, email, expectedOrigin, parsedClientURL) => {
    const Function = async (parameters) => {
        const cookie = parameters.cookie ? JSON.parse(parameters.cookie) : undefined;

        if (!cookie) {
            return { error: true , errorCode: "PASSKEY-AUTH-EXPIRED" };
        }

        if (cookie.email !== parameters.email) {
            return { error: true , errorCode: "PASSKEY-AUTH-EMAIL-MISMATCH" }
        }

        let user = await globalAccessPoint.db().getData("Users" , cookie.uid);

        const verification = await verifyAuthenticationResponse({
            response: parameters.authenticationResponse,
            expectedChallenge: cookie.challenge,
            expectedOrigin: parameters.expectedOrigin,
            expectedRPID: parameters.clientURL,
            credential: {
                id: user.data.credentials.passkey.creds.id,
                publicKey: user.data.credentials.passkey.creds.publicKey,
                counter: user.data.credentials.passkey.creds.counter,
                transports: user.data.credentials.passkey.creds.transports,
            }
        })

        if (!verification.verified) {
            return { error: true , errorCode: "PASSKEY-AUTH-FAILED" }
        }

        user.data.credentials.passkey.creds.counter = verification.authenticationInfo.newCounter;

        await globalAccessPoint.db().addData("Users" , cookie.uid, user.data);

        return { error: false , authenticated: true, uid: cookie.uid };
    }

    const parameters = {
        authenticationResponse: authenticationResponse,
        expectedOrigin: expectedOrigin,
        cookie: cookie,
        email: email,
        clientURL: parsedClientURL
    }

    const results = await tryCatch(Function, true , parameters);

    return results;
}

module.exports = { veryifyAndCompletePasskeyAuthentication }