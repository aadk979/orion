import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { globalAccessPoint } from '../../../GlobalAccessPoint.js';
import { PasskeyModel } from '../../../Databases/models/index.js';
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

        const passkey = await PasskeyModel.getPasskey(cookie.uid);

        if (!passkey) {
            return { error: true, errorCode: 'PASSKEY-AUTH-NO-CREDENTIAL' };
        }

        const publicKeyUint8 = passkey.public_key instanceof Buffer
            ? new Uint8Array(passkey.public_key)
            : new Uint8Array(passkey.public_key);

        const verification = await verifyAuthenticationResponse({
            response: parameters.authenticationResponse,
            expectedChallenge: cookie.challenge,
            expectedOrigin: parameters.expectedOrigin,
            expectedRPID: parameters.clientURL,
            credential: {
                id: passkey.credential_id,
                publicKey: publicKeyUint8,
                counter: passkey.counter,
                transports: passkey.transports
            }
        });

        if (!verification.verified) {
            return { error: true, errorCode: 'PASSKEY-AUTH-FAILED' };
        }

        await PasskeyModel.updateCounter(passkey.credential_id, verification.authenticationInfo.newCounter);

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
