/**
 * Signed context for an in-progress device-authorization flow.
 *
 * WHY THIS EXISTS
 *
 * The device-authorization routes — list available 2FA methods, send the
 * authorization email, authorize with TOTP, authorize with passkey — are
 * `requireAuth: false` by necessity: they run before a session exists. They
 * therefore had to learn WHICH account they were acting on from somewhere, and
 * that somewhere was the `deviceAuthEmailOffset` cookie holding a bare email
 * address.
 *
 * A cookie is not an input the server controls. HttpOnly stops page script from
 * writing it; it does nothing about a client that simply sends the header
 * itself. So any unauthenticated caller could name any account and have those
 * four endpoints act on it: enumerate a victim's enrolled factors, send them
 * authorization emails on demand, and submit TOTP guesses at them.
 *
 * The value is now a signed, device-bound token that only the server mints, and
 * only after a sign-in attempt has actually reached the device-authorization
 * gate for that account. Forging one requires the signing key; lifting one from
 * another device fails the binding.
 *
 * WHAT THIS DOES NOT FIX, AND WHY THE CEILING IS THE REAL CONTROL
 *
 * A caller can still OBTAIN a legitimately signed context for any address they
 * know, by POSTing that address to sign-in — the device gate runs before the
 * password is checked, which it must, because an unrecognised device has to be
 * challenged whether or not the password was right. Signing removes forgery and
 * cookie transplant; it does not and cannot remove targeting. The per-account
 * second-factor ceiling (UserModel.recordFailedSecondFactor) is what bounds
 * guessing, and the uniform responses in DeviceAuthorization.js are what stop
 * the flow from confirming whether an address is registered.
 *
 * Bound on the same terms as the step-up tokens: a `cnf.jkt` when the
 * deployment uses proof of possession, IP range / user-agent / fingerprint
 * hashes when it does not. See internals/tierBinding.js for why those three are
 * corroboration rather than a binding once a key is in play.
 */
import { sha256Hash } from '../../CryptoFunctions.js';
import { getFutureUnixTime, getCurrentUnixTime } from '../../Date&Time.js';
import { getIpRange, isIpInRange } from '../../Ip.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { requestContext } from '../../../Server/Middleware/requestContextStore.js';
import { isBindingRequired, resolveIssuanceBinding } from '../TokenManagement/internals/dpopBinding.js';
import { verifyDpopProof } from '../TokenManagement/internals/dpop.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const signatureSecretsManagerModule = new SafeModuleHandler('SignatureSecretsManager(internal)', 'SIGNATURE_SECRETS_MANAGER_internal', 'DeviceAuthContext.js');

const TOKEN_TYPE = 'DEVICE_AUTH_CONTEXT';
const LIFETIME = '15m';

/**
 * Mints a device-authorization context for the account a flow has just been
 * started for.
 *
 * `uid` is null for an address with no account. That is deliberate: the caller
 * must be able to hand back an identical-looking context either way, or the
 * presence of the cookie itself becomes the enumeration oracle this is meant to
 * close.
 *
 * @param {string} email
 * @param {string|null} uid
 * @returns {Promise<string | { error: true, errorCode: string }>}
 */
const generateDeviceAuthContext = async (email, uid = null) => {
    const Function = async parameters => {
        const ssm = signatureSecretsManagerModule.getModule();
        const signingPair = await ssm.getRandomSigningKeyPair();

        if (!signingPair) {
            return { error: true, errorCode: 'SYSTEM::SIGNING-KEY-UNAVAILABLE::A::i' };
        }

        const metadata = requestContext.getStore();

        const binding = await resolveIssuanceBinding();

        if (binding.error) {
            return { error: true, errorCode: binding.errorCode };
        }

        const tokenPayload = JSON.stringify({
            type: TOKEN_TYPE,
            email: parameters.email,
            uid: parameters.uid,
            ipRange: getIpRange(metadata?.ip),
            uaSHA256: sha256Hash(metadata?.userAgent || ''),
            fpSHA256: sha256Hash(metadata?.fingerprint || ''),
            ...(binding.jkt ? { cnf: { jkt: binding.jkt } } : {}),
            exp: getFutureUnixTime(LIFETIME),
            kid: signingPair.keyPairId
        });

        const signature = ssm.sign(tokenPayload, signingPair.keyPairId);

        return `${Buffer.from(tokenPayload).toString('base64url')}.${signature}`;
    };

    const parameters = { email, uid };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'generateDeviceAuthContext', functionSource);
};

/**
 * Validates a device-authorization context presented by a flow route.
 *
 * Device signals come from the in-flight request; every caller runs inside
 * `requestContext.run`.
 *
 * @param {string} token raw cookie value
 * @returns {Promise<{ error: boolean, errorCode?: string, email?: string, uid?: string|null }>}
 */
const validateDeviceAuthContext = async token => {
    const Function = async parameters => {
        const invalid = { error: true, errorCode: 'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p' };

        if (!parameters.token || typeof parameters.token !== 'string') {
            return invalid;
        }

        const dotIndex = parameters.token.indexOf('.');
        if (dotIndex === -1) return invalid;

        const payloadB64 = parameters.token.slice(0, dotIndex);
        const signature = parameters.token.slice(dotIndex + 1);

        let payload;
        try {
            payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        } catch {
            return invalid;
        }

        // `uid` may legitimately be null, so it is not part of the structural
        // requirement — everything else is.
        if (!payload || payload.type !== TOKEN_TYPE || !payload.email || !payload.ipRange || !payload.uaSHA256 || !payload.fpSHA256 || !payload.exp || !payload.kid) {
            return invalid;
        }

        if (getCurrentUnixTime() > payload.exp) return invalid;

        const ssm = signatureSecretsManagerModule.getModule();
        const rawPayloadString = Buffer.from(payloadB64, 'base64url').toString('utf8');

        if (!(await ssm.verify(rawPayloadString, signature, payload.kid))) {
            return invalid;
        }

        const metadata = requestContext.getStore();

        if (isBindingRequired()) {
            if (!payload.cnf?.jkt) return invalid;

            const proofResult = await verifyDpopProof({
                proof: metadata?.dpopProof || null,
                method: metadata?.method || 'POST',
                url: metadata?.requestUri,
                accessToken: null,
                expectedJkt: payload.cnf.jkt,
                requireAth: false
            });

            if (!proofResult.valid) return invalid;
        } else {
            if (!(await isIpInRange(metadata?.ip, payload.ipRange))) return invalid;
            if (sha256Hash(metadata?.userAgent || '') !== payload.uaSHA256) return invalid;
            if (sha256Hash(metadata?.fingerprint || '') !== payload.fpSHA256) return invalid;
        }

        return { error: false, email: payload.email, uid: payload.uid || null };
    };

    const parameters = { token };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'validateDeviceAuthContext', functionSource);
};

export { generateDeviceAuthContext, validateDeviceAuthContext };
