import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { hashString, verifyHash, sha256Hash } from '../../CryptoFunctions.js';
import { getFutureUnixTime, getCurrentUnixTime } from '../../Date&Time.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, PasskeyModel, TOTPModel, RequestModel } from '../../Databases/models/index.js';
import { getIp, getIpRange, isIpInRange } from '../../Ip.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateRandomNumber, generateRequestId, generateChallenge } from '../../valueGenerator.js';
import { generateAndSendMail } from '../../Mail/sendMail.js';
import { cronScheduler } from '../../Cron.js';
import { parseCookieData, setManagedCookie, clearManagedCookie } from '../../CookieUtils.js';
import { verifyTOTPToken } from '../AccountManagment/TOTP.js';
import { veryifyAndCompletePasskeyAuthentication } from '../AccountManagment/Passkeys/completeAuthentication.js';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { getDeviceDetails } from '../../Device.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'StepUpAuth.js');
const signatureSecretsManagerModule = new SafeModuleHandler('SignatureSecretsManager(internal)', 'SIGNATURE_SECRETS_MANAGER_internal', 'StepUpAuth.js');

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL TOKEN HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a Step-Up Auth Token (5-hour lifetime, device-bound).
 *
 * Token format: base64url(jsonPayload).signature
 *
 * Payload is cryptographically signed and bound to the requesting device's IP
 * range, user-agent (SHA-256), and fingerprint (SHA-256) so the token cannot
 * be lifted and replayed from a different device or network.
 *
 * Not exported — always called from inside already-tryCatch-wrapped functions.
 *
 * @param {string} uid
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} fingerprint
 * @returns {Promise<string>} Signed token string
 */
const generateStepUpToken = async (uid, ip, userAgent, fingerprint) => {
    const ssm = signatureSecretsManagerModule.getModule();
    const signingPair = await ssm.getRandomSigningKeyPair();

    if (!signingPair) {
        throw new Error('SYSTEM::SIGNING-KEY-UNAVAILABLE::A::i');
    }

    const exp = getFutureUnixTime('5h');

    const tokenPayload = JSON.stringify({
        type: 'STEP_UP_AUTH_TOKEN',
        uid,
        ipRange: getIpRange(ip),
        uaSHA256: sha256Hash(userAgent),
        fpSHA256: sha256Hash(fingerprint),
        exp,
        kid: signingPair.keyPairId
    });

    const signature = ssm.sign(tokenPayload, signingPair.keyPairId);
    const payloadB64 = Buffer.from(tokenPayload).toString('base64url');

    return `${payloadB64}.${signature}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE STEP-UP AUTH TOKEN  (exported — used by middleware / protected routes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a Step-Up Auth Token issued by `generateStepUpToken`.
 *
 * Performs structural checks, expiry, cryptographic signature verification,
 * and per-request device-binding checks (IP range, UA hash, fingerprint hash).
 *
 * @param {string} token
 * @param {string} ip        Current request IP
 * @param {string} userAgent Current request user-agent (orion-user-agent header)
 * @param {string} fingerprint Current request fingerprint (orion-fingerprint header)
 * @returns {Promise<{ error: boolean, valid?: boolean, uid?: string }>}
 */
const validateStepUpToken = async (token, ip, userAgent, fingerprint) => {
    const Function = async parameters => {
        // ── 1. Split token into payload + signature ───────────────────────────
        const dotIndex = parameters.token.indexOf('.');
        if (dotIndex === -1) {
            return { error: true, valid: false };
        }

        const payloadB64 = parameters.token.slice(0, dotIndex);
        const signature = parameters.token.slice(dotIndex + 1);

        // ── 2. Decode and parse payload ───────────────────────────────────────
        let payload;
        try {
            payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        } catch {
            return { error: true, valid: false };
        }

        // ── 3. Structural check — all required fields must be present ─────────
        if (
            !payload ||
            payload.type !== 'STEP_UP_AUTH_TOKEN' ||
            !payload.uid ||
            !payload.ipRange ||
            !payload.uaSHA256 ||
            !payload.fpSHA256 ||
            !payload.exp ||
            !payload.kid
        ) {
            return { error: true, valid: false };
        }

        // ── 4. Expiry check ───────────────────────────────────────────────────
        if (getCurrentUnixTime() > payload.exp) {
            return { error: true, valid: false };
        }

        // ── 5. Cryptographic signature verification ───────────────────────────
        // We pass the raw decoded JSON string — exactly what was signed during
        // generation — so any payload tampering will invalidate the signature.
        const ssm = signatureSecretsManagerModule.getModule();
        const rawPayloadString = Buffer.from(payloadB64, 'base64url').toString('utf8');
        const signatureValid = await ssm.verify(rawPayloadString, signature, payload.kid);

        if (!signatureValid) {
            return { error: true, valid: false };
        }

        // ── 6. IP binding check ───────────────────────────────────────────────
        if (!(await isIpInRange(parameters.ip, payload.ipRange))) {
            return { error: true, valid: false };
        }

        // ── 7. User-agent binding check ───────────────────────────────────────
        if (sha256Hash(parameters.userAgent) !== payload.uaSHA256) {
            return { error: true, valid: false };
        }

        // ── 8. Fingerprint binding check ──────────────────────────────────────
        if (sha256Hash(parameters.fingerprint) !== payload.fpSHA256) {
            return { error: true, valid: false };
        }

        return { error: false, valid: true, uid: payload.uid };
    };

    const parameters = { token, ip, userAgent, fingerprint };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'validateStepUpToken', functionSource);
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP-UP CONTEXT TOKEN  (exported — issued when a session is risk-flagged)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a short-lived Step-Up Context Token (10-minute lifetime).
 *
 * Stored as the `stepUpContext` cookie.  Its sole purpose is to identify the
 * user across step-up flow routes where the full session token may be
 * risk-flagged and therefore unavailable.
 *
 * @param {string} uid
 * @returns {Promise<string | { error: true, errorCode: string }>}
 *   Returns the signed token string on success, or an error object on failure.
 */
const generateStepUpContextToken = async uid => {
    const Function = async parameters => {
        const ssm = signatureSecretsManagerModule.getModule();
        const signingPair = await ssm.getRandomSigningKeyPair();

        if (!signingPair) {
            return { error: true, errorCode: 'SYSTEM::SIGNING-KEY-UNAVAILABLE::A::i' };
        }

        const exp = getFutureUnixTime('10m');

        const tokenPayload = JSON.stringify({
            type: 'STEP_UP_CONTEXT',
            uid: parameters.uid,
            exp,
            kid: signingPair.keyPairId
        });

        const signature = ssm.sign(tokenPayload, signingPair.keyPairId);
        const payloadB64 = Buffer.from(tokenPayload).toString('base64url');

        return `${payloadB64}.${signature}`;
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'generateStepUpContextToken', functionSource);
};

/**
 * Validates a Step-Up Context Token.
 *
 * Called at the top of every step-up route handler to authenticate the
 * in-progress step-up session.
 *
 * @param {string} token
 * @returns {Promise<{ error: boolean, errorCode?: string, uid?: string }>}
 */
const validateStepUpContextToken = async token => {
    const Function = async parameters => {
        // ── 1. Split token ────────────────────────────────────────────────────
        const dotIndex = parameters.token.indexOf('.');
        if (dotIndex === -1) {
            return { error: true, errorCode: 'STEP-UP::SESSION-EXPIRED::A::p' };
        }

        const payloadB64 = parameters.token.slice(0, dotIndex);
        const signature = parameters.token.slice(dotIndex + 1);

        // ── 2. Decode and parse payload ───────────────────────────────────────
        let payload;
        try {
            payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        } catch {
            return { error: true, errorCode: 'STEP-UP::SESSION-EXPIRED::A::p' };
        }

        // ── 3. Structural check ───────────────────────────────────────────────
        if (!payload || payload.type !== 'STEP_UP_CONTEXT' || !payload.uid || !payload.exp || !payload.kid) {
            return { error: true, errorCode: 'STEP-UP::SESSION-EXPIRED::A::p' };
        }

        // ── 4. Expiry check ───────────────────────────────────────────────────
        if (getCurrentUnixTime() > payload.exp) {
            return { error: true, errorCode: 'STEP-UP::SESSION-EXPIRED::A::p' };
        }

        // ── 5. Cryptographic signature verification ───────────────────────────
        const ssm = signatureSecretsManagerModule.getModule();
        const rawPayloadString = Buffer.from(payloadB64, 'base64url').toString('utf8');
        const signatureValid = await ssm.verify(rawPayloadString, signature, payload.kid);

        if (!signatureValid) {
            return { error: true, errorCode: 'STEP-UP::SESSION-EXPIRED::A::p' };
        }

        return { error: false, uid: payload.uid };
    };

    const parameters = { token };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'validateStepUpContextToken', functionSource);
};

// ─────────────────────────────────────────────────────────────────────────────
// AVAILABLE STEP-UP METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the step-up authentication methods available for the given user.
 *
 * Email code is always available.  Passkey and TOTP are enabled only when the
 * user has previously registered those credentials.
 *
 * @param {string} uid
 * @returns {Promise<{ error: boolean, errorCode?: string, methods?: object }>}
 */
const getAvailableStepUpMethods = async uid => {
    const Function = async parameters => {
        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        const hasPasskey = await PasskeyModel.hasPasskey(parameters.uid);
        const totpEnabled = await TOTPModel.isEnabled(parameters.uid);

        const totpSystemDisabled = globalAccessPoint.getValue('totpSystemDisabled');
        const passkeySystemDisabled = !systemConfigModule.getModule()?.authMethods?.passkey;

        return {
            error: false,
            methods: {
                'email-code': true,
                passkey: passkeySystemDisabled ? false : hasPasskey,
                totp: totpSystemDisabled ? false : totpEnabled
            }
        };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'getAvailableStepUpMethods', functionSource);
};

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL CODE CHALLENGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initiates a step-up email challenge.
 *
 * Generates a 6-digit one-time code, persists a hashed challenge record in
 * `StepUpAuthRequests`, schedules automatic cleanup, and dispatches a
 * verification email to the user.
 *
 * @param {string} uid
 * @param {string} ip
 * @param {string} userAgent
 * @returns {Promise<{ error: boolean, errorCode?: string, reqId?: string, flowSecret?: string }>}
 */
const initiateStepUpEmailChallenge = async (uid, ip, userAgent) => {
    const Function = async parameters => {
        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        const email = user.email;

        // ── Generate challenge material ───────────────────────────────────────
        const code = generateRandomNumber(6);
        const codeHash = await hashString(code);

        const flowSecret = generateChallenge(32);
        const hashedFlowSecret = await hashString(flowSecret);

        const userAgentHash = await hashString(parameters.userAgent);

        const reqId = generateRequestId('STEP_UP_AUTH', 52);

        // ── Persist challenge record ──────────────────────────────────────────
        await RequestModel.createStepUpAuthRequest(reqId, {
            codeHash,
            hashedFlowSecret,
            uid: parameters.uid,
            ip: getIpRange(parameters.ip),
            userAgentHash
        });

        // ── Schedule automatic cleanup after 10 minutes ───────────────────────
        cronScheduler.addEvent(
            reqId,
            async p => {
                await RequestModel.deleteStepUpAuthRequest(p.reqId);
            },
            '10m',
            { reqId }
        );

        // ── Send verification email ───────────────────────────────────────────
        const mailResult = await generateAndSendMail(1, email, {
            EMAIL: email,
            CODE: code,
            IP: parameters.ip,
            USERAGENT: parameters.userAgent,
            MODEL: getDeviceDetails(parameters.userAgent).device.model || 'Unknown Device'
        });

        if (mailResult && mailResult.error) {
            // Roll back: cancel cleanup task and delete the stored challenge record
            cronScheduler.cancelEvent(reqId);
            await RequestModel.deleteStepUpAuthRequest(reqId);
            return { error: true, errorCode: 'STEP-UP::UNABLE-TO-SEND-EMAIL::A::i' };
        }

        return { error: false, reqId, flowSecret };
    };

    const parameters = { uid, ip, userAgent };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'initiateStepUpEmailChallenge', functionSource);
};

/**
 * Verifies a step-up email code submission.
 *
 * Checks UID ownership, User-Agent, IP range, flow secret (CSRF-like binding),
 * and the one-time code itself.  On success, consumes the challenge record and
 * returns a freshly-signed Step-Up Auth Token.
 *
 * @param {string} reqId
 * @param {string} code
 * @param {string} flowSecret
 * @param {string} uid
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} fingerprint
 * @returns {Promise<{ error: boolean, errorCode?: string, token?: string }>}
 */
const verifyStepUpWithEmailCode = async (reqId, code, flowSecret, uid, ip, userAgent, fingerprint) => {
    const Function = async parameters => {
        // ── 1. Fetch stored challenge record ──────────────────────────────────
        const storedData = await RequestModel.getStepUpAuthRequest(parameters.reqId);

        if (!storedData) {
            return { error: true, errorCode: 'STEP-UP::SESSION-EXPIRED::A::p' };
        }

        // ── 2. UID ownership check ────────────────────────────────────────────
        // Prevents a different user from consuming another user's challenge.
        if (storedData.user_uid !== parameters.uid) {
            return { error: true, errorCode: 'STEP-UP::SESSION-EXPIRED::A::p' };
        }

        // ── 3. User-Agent binding check ───────────────────────────────────────
        const uaValid = await verifyHash(parameters.userAgent, storedData.user_agent_hash);
        if (!uaValid) {
            return { error: true, errorCode: 'STEP-UP::USERAGENT-MISMATCH::A::p' };
        }

        // ── 4. IP range check ─────────────────────────────────────────────────
        const ipValid = await isIpInRange(parameters.ip, storedData.ip_range);
        if (!ipValid) {
            return { error: true, errorCode: 'STEP-UP::IP-MISMATCH::A::p' };
        }

        // ── 5. Flow secret check (CSRF-like session binding) ──────────────────
        const secretValid = await verifyHash(parameters.flowSecret, storedData.hashed_flow_secret);
        if (!secretValid) {
            return { error: true, errorCode: 'STEP-UP::SECRET-MISMATCH::A::p' };
        }

        // ── 6. One-time code check ────────────────────────────────────────────
        const codeValid = await verifyHash(parameters.code, storedData.code_hash);
        if (!codeValid) {
            const attempt = await RequestModel.chargeFailedAttempt('step_up_auth_requests', parameters.reqId);

            if (attempt.exhausted) {
                await RequestModel.deleteStepUpAuthRequest(parameters.reqId);
                cronScheduler.cancelEvent(parameters.reqId);
                return { error: true, errorCode: 'STEP-UP::ATTEMPTS-EXCEEDED::A::p' };
            }

            return { error: true, errorCode: 'STEP-UP::INVALID-CODE::A::p' };
        }

        // ── 7. Consume challenge record ───────────────────────────────────────
        await RequestModel.deleteStepUpAuthRequest(parameters.reqId);
        cronScheduler.cancelEvent(parameters.reqId);

        // ── 8. Issue Step-Up Auth Token ───────────────────────────────────────
        const token = await generateStepUpToken(parameters.uid, parameters.ip, parameters.userAgent, parameters.fingerprint);

        return { error: false, token };
    };

    const parameters = { reqId, code, flowSecret, uid, ip, userAgent, fingerprint };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'verifyStepUpWithEmailCode', functionSource);
};

// ─────────────────────────────────────────────────────────────────────────────
// PASSKEY STEP-UP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates WebAuthn authentication options for a passkey step-up challenge.
 *
 * Mirrors the existing `generatePasskeyAuthenticationOptionsExistingUser`
 * pattern but uses `uid` directly rather than an email look-up.
 *
 * @param {string} uid
 * @param {string} clientURL  Parsed RP ID (hostname only)
 * @returns {Promise<{ error: boolean, errorCode?: string, options?: object, cookies?: Array }>}
 */
const generateStepUpPasskeyOptions = async (uid, clientURL) => {
    const Function = async parameters => {
        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        const email = user.email;

        const passkey = await PasskeyModel.getPasskey(parameters.uid);

        if (!passkey) {
            return { error: true, errorCode: 'PASSKEY::AUTH-NO-ACTIVE-PASSKEY::A::p' };
        }

        const options = await generateAuthenticationOptions({
            rpId: parameters.clientURL,
            allowCredentials: [
                {
                    id: passkey.credential_id,
                    type: 'public-key',
                    transports: passkey.transports
                }
            ]
        });

        return {
            error: false,
            options,
            cookies: [
                {
                    key: 'PASSKEY-AUTHENTICATION-INFO-STEP-1',
                    data: {
                        uid: parameters.uid,
                        id: options.id,
                        email,
                        challenge: options.challenge
                    },
                    maxAge: 30000
                }
            ]
        };
    };

    const parameters = { uid, clientURL };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'generateStepUpPasskeyOptions', functionSource);
};

/**
 * Verifies a passkey authentication response for step-up.
 *
 * Delegates to the shared `veryifyAndCompletePasskeyAuthentication` helper,
 * then issues a Step-Up Auth Token on success.
 *
 * @param {*}      authResponse     WebAuthn authentication response from client
 * @param {string} cookieData       Raw PASSKEY-AUTHENTICATION-INFO-STEP-1 cookie value
 * @param {string} uid
 * @param {string} clientURL        Full origin URL
 * @param {string} parsedClientURL  Hostname (RP ID)
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} fingerprint
 * @returns {Promise<{ error: boolean, errorCode?: string, token?: string }>}
 */
const verifyStepUpWithPasskey = async (authResponse, cookieData, uid, clientURL, parsedClientURL, ip, userAgent, fingerprint) => {
    const Function = async parameters => {
        // Resolve user email — required by veryifyAndCompletePasskeyAuthentication
        // to validate that the cookie's stored email matches this user.
        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        const email = user.email;

        // ── Verify passkey response ───────────────────────────────────────────
        const verification = await veryifyAndCompletePasskeyAuthentication(
            parameters.authResponse,
            parameters.cookieData,
            email,
            parameters.clientURL,
            parameters.parsedClientURL
        );

        if (verification.error) {
            return verification;
        }

        // ── Issue Step-Up Auth Token ──────────────────────────────────────────
        const token = await generateStepUpToken(parameters.uid, parameters.ip, parameters.userAgent, parameters.fingerprint);

        return { error: false, token };
    };

    const parameters = {
        authResponse,
        cookieData,
        uid,
        clientURL,
        parsedClientURL,
        ip,
        userAgent,
        fingerprint
    };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'verifyStepUpWithPasskey', functionSource);
};

// ─────────────────────────────────────────────────────────────────────────────
// TOTP STEP-UP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifies a TOTP code for step-up authentication.
 *
 * Guards against users who have not enrolled TOTP and issues a Step-Up Auth
 * Token on successful verification.
 *
 * @param {string} uid
 * @param {string} totpCode
 * @param {string} ip
 * @param {string} userAgent
 * @param {string} fingerprint
 * @returns {Promise<{ error: boolean, errorCode?: string, token?: string }>}
 */
const verifyStepUpWithTOTP = async (uid, totpCode, ip, userAgent, fingerprint) => {
    const Function = async parameters => {
        if (globalAccessPoint.getValue('totpSystemDisabled')) return { error: true, errorCode: 'TOTP::SYSTEM-DISABLED::A::i' };

        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        const totpConfig = await TOTPModel.getTOTPConfig(parameters.uid);

        if (!totpConfig?.enabled) {
            return { error: true, errorCode: 'TOTP::NOT-ENABLED::A::p' };
        }

        // ── Verify TOTP code ──────────────────────────────────────────────────
        const totpResult = await verifyTOTPToken(parameters.totpCode, totpConfig.secret);

        if (totpResult.error) {
            return { error: true, errorCode: 'STEP-UP::INVALID-TOTP::A::p' };
        }

        // ── Issue Step-Up Auth Token ──────────────────────────────────────────
        const token = await generateStepUpToken(parameters.uid, parameters.ip, parameters.userAgent, parameters.fingerprint);

        return { error: false, token };
    };

    const parameters = { uid, totpCode, ip, userAgent, fingerprint };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'verifyStepUpWithTOTP', functionSource);
};

// ─────────────────────────────────────────────────────────────────────────────
// SHARED COOKIE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads and validates the `stepUpContext` cookie common to every step-up route.
 * Returns `{ ok: false, response: ... }` if the caller should immediately halt,
 * or `{ ok: true, uid }` to proceed.
 *
 * @param {object} request   Express request
 * @param {object} response  Express response
 * @returns {Promise<{ ok: boolean, uid?: string }>}
 */
const resolveStepUpContext = async (request, response) => {
    const rawContext = parseCookieData(request.cookies['stepUpContext']);
    if (!rawContext) {
        respondWithError(response, 'STEP-UP::MISSING-CONTEXT::A::p');
        return { ok: false };
    }

    const ctx = await validateStepUpContextToken(rawContext);
    if (ctx.error) {
        respondWithError(response, ctx.errorCode || 'STEP-UP::SESSION-EXPIRED::A::p');
        return { ok: false };
    }

    return { ok: true, uid: ctx.uid };
};

/**
 * Sets the `STEP_UP_TOKEN` cookie on the response.
 *
 * @param {object} response Express response
 * @param {string} token    Signed Step-Up Auth Token
 */
const setStepUpTokenCookie = (response, token) => {
    setManagedCookie(response, 'STEP_UP_TOKEN', token);
};

/**
 * Clears a transient step-up cookie by setting its maxAge to 0.
 *
 * @param {object} response Express response
 * @param {string} key      Cookie name
 */
const clearCookie = (response, key) => {
    clearManagedCookie(response, key);
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /step-up/methods
 *
 * Returns the set of step-up methods available to the authenticated-in-context
 * user so the client can render the appropriate challenge UI.
 */
const routeHandlerGetStepUpMethods = async (request, response) => {
    const ctx = await resolveStepUpContext(request, response);
    if (!ctx.ok) return;

    const { uid } = ctx;

    const callback = await getAvailableStepUpMethods(uid);
    if (callback.error) return respondWithError(response, callback.errorCode);

    return respondWithSuccess(response, 200, { methods: callback.methods });
};

/**
 * POST /step-up/email/initiate
 *
 * Sends a 6-digit verification code to the user's registered email address and
 * stores the encrypted challenge state in a pair of httpOnly cookies.
 */
const routeHandlerInitiateStepUpEmail = async (request, response) => {
    const ctx = await resolveStepUpContext(request, response);
    if (!ctx.ok) return;

    const { uid } = ctx;
    const meta = requestContext.getStore();
    const ip = meta?.ip || getIp(request);
    const userAgent = meta?.userAgent || '';

    const callback = await initiateStepUpEmailChallenge(uid, ip, userAgent);
    if (callback.error) return respondWithError(response, callback.errorCode);

    // Store the request ID and flow secret in separate httpOnly cookies so the
    // verify handler can reconstruct the full challenge context.
    setManagedCookie(response, 'stepUpEmailReqId', callback.reqId);

    setManagedCookie(response, 'stepUpFlowSecret', callback.flowSecret);

    return respondWithSuccess(response, 200, { sent: true });
};

/**
 * POST /step-up/email/verify
 *
 * Accepts the 6-digit code submitted by the user, validates all challenge
 * bindings, and on success issues a Step-Up Auth Token.
 */
const routeHandlerVerifyStepUpEmail = async (request, response) => {
    const ctx = await resolveStepUpContext(request, response);
    if (!ctx.ok) return;

    const { uid } = ctx;
    const meta = requestContext.getStore();
    const ip = meta?.ip || getIp(request);
    const userAgent = meta?.userAgent || '';
    const fingerprint = meta?.fingerprint || '';

    const code = request.body.packet?.code;
    if (!code || typeof code !== 'string') return respondWithError(response, 'STEP-UP::INVALID-CODE::A::p');

    const reqId = parseCookieData(request.cookies['stepUpEmailReqId']);
    if (!reqId) return respondWithError(response, 'STEP-UP::SESSION-EXPIRED::A::p');

    // flowSecret defaults to empty string so verifyHash will deterministically
    // fail rather than throwing if the cookie is absent.
    const flowSecret = parseCookieData(request.cookies['stepUpFlowSecret']) || '';

    const callback = await verifyStepUpWithEmailCode(reqId, code, flowSecret, uid, ip, userAgent, fingerprint);
    if (callback.error) return respondWithError(response, callback.errorCode);

    // ── Issue Step-Up Token ───────────────────────────────────────────────────
    setStepUpTokenCookie(response, callback.token);

    // ── Clear transient step-up cookies ──────────────────────────────────────
    clearCookie(response, 'stepUpContext');
    clearCookie(response, 'stepUpEmailReqId');
    clearCookie(response, 'stepUpFlowSecret');

    return respondWithSuccess(response, 200, { stepUpComplete: true });
};

/**
 * POST /step-up/passkey/options
 *
 * Generates WebAuthn authentication options for a passkey step-up and stores
 * the challenge state in a cookie for the subsequent verify call.
 */
const routeHandlerGenerateStepUpPasskeyOptions = async (request, response) => {
    const ctx = await resolveStepUpContext(request, response);
    if (!ctx.ok) return;

    const { uid } = ctx;
    const clientURL = request.get('Origin') || request.get('Referer');
    const parsedClientURL = new URL(clientURL).host;

    const callback = await generateStepUpPasskeyOptions(uid, parsedClientURL);
    if (callback.error) return respondWithError(response, callback.errorCode);

    if (callback.cookies) {
        for (const cookie of callback.cookies) {
            setManagedCookie(response, cookie.key, cookie.data);
        }
    }

    return respondWithSuccess(response, 200, { options: callback.options });
};

/**
 * POST /step-up/passkey/verify
 *
 * Verifies the WebAuthn authentication response returned by the client and,
 * on success, issues a Step-Up Auth Token.
 */
const routeHandlerVerifyStepUpPasskey = async (request, response) => {
    const ctx = await resolveStepUpContext(request, response);
    if (!ctx.ok) return;

    const { uid } = ctx;
    const meta = requestContext.getStore();
    const ip = meta?.ip || getIp(request);
    const userAgent = meta?.userAgent || '';
    const fingerprint = meta?.fingerprint || '';

    const authResponse = request.body.packet.authenticationResponse;
    const cookieData = request.cookies['PASSKEY-AUTHENTICATION-INFO-STEP-1'];

    const clientURL = request.get('Origin') || request.get('Referer');
    const parsedClientURL = new URL(clientURL).host;

    const callback = await verifyStepUpWithPasskey(authResponse, cookieData, uid, clientURL, parsedClientURL, ip, userAgent, fingerprint);
    if (callback.error) return respondWithError(response, callback.errorCode);

    // ── Issue Step-Up Token ───────────────────────────────────────────────────
    setStepUpTokenCookie(response, callback.token);

    // ── Clear transient step-up cookies ──────────────────────────────────────
    clearCookie(response, 'stepUpContext');
    clearCookie(response, 'PASSKEY-AUTHENTICATION-INFO-STEP-1');

    return respondWithSuccess(response, 200, { stepUpComplete: true });
};

/**
 * POST /step-up/totp/verify
 *
 * Verifies a TOTP code for step-up authentication and issues a Step-Up Auth
 * Token on success.
 */
const routeHandlerVerifyStepUpTOTP = async (request, response) => {
    const ctx = await resolveStepUpContext(request, response);
    if (!ctx.ok) return;

    const { uid } = ctx;
    const meta = requestContext.getStore();
    const ip = meta?.ip || getIp(request);
    const userAgent = meta?.userAgent || '';
    const fingerprint = meta?.fingerprint || '';

    // Accept both `totpCode` and the shorter alias `code` from the client
    const totpCode = request.body.packet.totpCode || request.body.packet.code;

    const callback = await verifyStepUpWithTOTP(uid, totpCode, ip, userAgent, fingerprint);
    if (callback.error) return respondWithError(response, callback.errorCode);

    // ── Issue Step-Up Token ───────────────────────────────────────────────────
    setStepUpTokenCookie(response, callback.token);

    // ── Clear transient step-up cookies ──────────────────────────────────────
    clearCookie(response, 'stepUpContext');

    return respondWithSuccess(response, 200, { stepUpComplete: true });
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
    validateStepUpToken,
    generateStepUpContextToken,
    routeHandlerGetStepUpMethods,
    routeHandlerInitiateStepUpEmail,
    routeHandlerVerifyStepUpEmail,
    routeHandlerGenerateStepUpPasskeyOptions,
    routeHandlerVerifyStepUpPasskey,
    routeHandlerVerifyStepUpTOTP
};
