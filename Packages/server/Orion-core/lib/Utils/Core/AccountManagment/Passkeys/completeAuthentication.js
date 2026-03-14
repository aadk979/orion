import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { tryCatch } from '../../../TryCatch.js';
import { fileURLToPath } from 'url';

const veryifyAndCompletePasskeyAuthentication = async (authenticationResponse, cookie, email, expectedOrigin, parsedClientURL) => {
    const Function = async parameters => {
        const systemConfig = globalAccessPoint.systemConfig();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY-SIGN-IN-DISABLED' };
        }

        const cookie = parameters.cookie ? JSON.parse(parameters.cookie) : undefined;

        if (!cookie) {
            return { error: true, errorCode: 'PASSKEY-AUTH-EXPIRED' };
        }

        if (cookie.email !== parameters.email) {
            return { error: true, errorCode: 'PASSKEY-AUTH-EMAIL-MISMATCH' };
        }

        let user = await globalAccessPoint.db().getData('Users', cookie.uid);

        // MongoDB stores the publicKey as a Binary object, but @simplewebauthn expects a Uint8Array
        const storedPublicKey = user.data.credentials.passkey.creds.publicKey;
        const publicKeyUint8 = storedPublicKey.buffer
            ? new Uint8Array(storedPublicKey.buffer)
            : new Uint8Array(storedPublicKey);

        const verification = await verifyAuthenticationResponse({
            response: parameters.authenticationResponse,
            expectedChallenge: cookie.challenge,
            expectedOrigin: parameters.expectedOrigin,
            expectedRPID: parameters.clientURL,
            credential: {
                id: user.data.credentials.passkey.creds.id,
                publicKey: publicKeyUint8,
                counter: user.data.credentials.passkey.creds.counter,
                transports: user.data.credentials.passkey.creds.transports
            }
        });

        if (!verification.verified) {
            return { error: true, errorCode: 'PASSKEY-AUTH-FAILED' };
        }

        user.data.credentials.passkey.creds.counter = verification.authenticationInfo.newCounter;

        await globalAccessPoint.db().addData('Users', cookie.uid, user.data);

        return { error: false, authenticated: true, uid: cookie.uid };
    };

    const parameters = {
        authenticationResponse: authenticationResponse,
        expectedOrigin: expectedOrigin,
        cookie: cookie,
        email: email,
        clientURL: parsedClientURL
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'veryifyAndCompletePasskeyAuthentication', functionSource);

    return results;
};

export { veryifyAndCompletePasskeyAuthentication };
