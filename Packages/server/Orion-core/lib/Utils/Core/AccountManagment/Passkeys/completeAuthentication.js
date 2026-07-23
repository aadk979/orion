import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { PasskeyModel, WebAuthnCeremonyModel } from '../../../Databases/models/index.js';
import { tryCatch } from '../../../TryCatch.js';
import { fileURLToPath } from 'url';
import { parseCookieData } from '../../../CookieUtils.js';
import { SafeModuleHandler } from '../../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'completeAuthentication.js');

/**
 * Verifies a WebAuthn authentication assertion against SERVER-HELD ceremony state.
 *
 * The ceremony cookie now carries only an opaque id. Everything the verification
 * depends on — the expected challenge, and which user's credential to check
 * against — is loaded from the row that id names, and that row is consumed
 * atomically so an assertion can be presented exactly once.
 *
 * This closes three gaps at once:
 *   - replay: the challenge is no longer whatever the caller echoes back, so a
 *     captured assertion cannot be resubmitted (previously the only barrier was
 *     the authenticator's signature counter, which synced passkeys report as a
 *     constant zero — meaning no barrier at all for most real credentials);
 *   - subject selection: the uid came from the cookie, so a caller chose which
 *     account's public key their assertion was verified against;
 *   - ceremony confusion: a registration ceremony could be completed as an
 *     authentication, since nothing recorded what a ceremony was for.
 *
 * @param {*} authenticationResponse WebAuthn assertion from the client
 * @param {string} ceremonyCookie    raw PASSKEY-AUTHENTICATION-INFO-STEP-1 cookie
 * @param {string} email             email the caller claims to be authenticating
 * @param {string} expectedOrigin
 * @param {string} parsedClientURL   RP ID
 * @param {string} [ceremonyType]    defaults to 'authentication'; step-up shares this path
 */
const veryifyAndCompletePasskeyAuthentication = async (
    authenticationResponse,
    ceremonyCookie,
    email,
    expectedOrigin,
    parsedClientURL,
    ceremonyType = 'authentication'
) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();

        if (!systemConfig.authMethods.passkey) {
            return { error: true, errorCode: 'PASSKEY::SIGN-IN-DISABLED::A::i' };
        }

        const ceremonyId = parseCookieData(parameters.ceremonyCookie);

        if (!ceremonyId || typeof ceremonyId !== 'string') {
            return { error: true, errorCode: 'PASSKEY::AUTH-EXPIRED::A::p' };
        }

        // Atomic claim. A second submission of the same assertion finds nothing.
        const ceremony = await WebAuthnCeremonyModel.consume(ceremonyId, parameters.ceremonyType);

        if (!ceremony) {
            return { error: true, errorCode: 'PASSKEY::AUTH-EXPIRED::A::p' };
        }

        // The ceremony names its own subject. The caller-supplied email is only
        // cross-checked for consistency — it can no longer select the account.
        if (parameters.email && ceremony.email && ceremony.email.toLowerCase() !== parameters.email.toLowerCase()) {
            return { error: true, errorCode: 'PASSKEY::AUTH-EMAIL-MISMATCH::A::p' };
        }

        if (!ceremony.user_uid) {
            return { error: true, errorCode: 'PASSKEY::AUTH-EXPIRED::A::p' };
        }

        const passkey = await PasskeyModel.getPasskey(ceremony.user_uid);

        if (!passkey) {
            return { error: true, errorCode: 'PASSKEY-AUTH-NO-CREDENTIAL' };
        }

        const publicKeyUint8 = passkey.public_key instanceof Buffer ? new Uint8Array(passkey.public_key) : new Uint8Array(passkey.public_key);

        const verification = await verifyAuthenticationResponse({
            response: parameters.authenticationResponse,
            expectedChallenge: ceremony.challenge,
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
            return { error: true, errorCode: 'PASSKEY::AUTH-FAILED::A::i' };
        }

        await PasskeyModel.updateCounter(passkey.credential_id, verification.authenticationInfo.newCounter);

        return { error: false, authenticated: true, uid: ceremony.user_uid };
    };

    const parameters = {
        authenticationResponse,
        expectedOrigin,
        ceremonyCookie,
        email,
        clientURL: parsedClientURL,
        ceremonyType
    };

    const functionSource = fileURLToPath(import.meta.url);
    const results = await tryCatch(Function, true, parameters, 'veryifyAndCompletePasskeyAuthentication', functionSource);

    return results;
};

export { veryifyAndCompletePasskeyAuthentication };
