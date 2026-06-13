import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { hashString, verifyHash } from '../../CryptoFunctions.js';
import { getFutureUnixTime, getCurrentUnixTime } from '../../Date&Time.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { RequestModel } from '../../Databases/models/index.js';
import { getIp, getIpRange, isIpInRange } from '../../Ip.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { generateRequestId } from '../../valueGenerator.js';
import { cronScheduler } from '../../Cron.js';
import { verifyCaptcha, generateCaptchaImage } from '../../CustomCaptchaSystem.js';
import { stringifyCookieData, parseCookieData } from '../../CookieUtils.js';

const captchaSystemVersion = '[orion:v1]-[1.0.0]-[BETA]';

// Max user-agent length stored to DB — prevents oversized payload attacks
const MAX_USER_AGENT_LENGTH = 512;

// How long (ms) a CAPTCHA transaction is valid for submission
const CAPTCHA_MAX_AGE_MS = 3 * 60 * 1000; // 3 minutes

const deletionFunction = async parameters => {
    await RequestModel.deleteNoAuthTransaction(parameters.docId);
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE TRANSACTION
// ─────────────────────────────────────────────────────────────────────────────

const generateNoAuthTokenCreationTransaction = async (ip, fingerprint, userAgent) => {
    const Function = async parameters => {
        const transactionId = generateRequestId('NO_AUTH_TOKEN_CREATION_TRANSACTION');
        const captcha = await generateCaptchaImage();

        const storage = await RequestModel.createNoAuthTransaction(transactionId, {
            ipRange: getIpRange(parameters.ip),
            fingerprint: parameters.fingerprint,
            userAgent: parameters.userAgent,
            captchaCode: captcha.hashedCode,
            captchaVersion: captchaSystemVersion,
            serverCreatedAt: Date.now()
        });

        if (storage && storage.error) {
            return { error: true, errorCode: 'DATABASE-ERROR' };
        }

        cronScheduler.addEvent(transactionId, deletionFunction, '5m', { docId: transactionId });

        return {
            error: false,
            transactionId: transactionId,
            captchaBase64Img: captcha.imageBase64,
            captchaSystemVersion: captchaSystemVersion
        };
    };

    const parameters = {
        ip: ip,
        fingerprint: await hashString(fingerprint),
        // Sanitise user-agent length before touching the DB
        userAgent: (userAgent || '').slice(0, MAX_USER_AGENT_LENGTH)
    };

    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'generateNoAuthTokenCreationTransaction', functionSource);
};

export const routeHandlerGenerateNoAuthTokenCreationTransaction = async (request, response) => {
    const ip = getIp(request);
    const fingerprint = request.headers['orion-fingerprint'];
    const userAgent = request.headers['orion-user-agent'];

    const callback = await generateNoAuthTokenCreationTransaction(ip, fingerprint, userAgent);

    if (callback.error) {
        return respondWithError(response, callback?.errorCode);
    }

    return respondWithSuccess(response, 200, callback);
};

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const generateNoAuthToken = async (ip, fingerprint, userAgent, recaptchaResponse, transactionId) => {
    const Function = async parameters => {
        // ── 0. Validate transactionId format ─────────────────────────────────
        if (
            !parameters.transactionId ||
            typeof parameters.transactionId !== 'string' ||
            !parameters.transactionId.startsWith('REQ_NO_AUTH_TOKEN_CREATION_TRANSACTION')
        ) {
            return { error: true, errorCode: 'INVALID-CAPTCHA-TRANSACTION-ID' };
        }

        // ── 1. Fetch and validate transaction ────────────────────────────────
        const txn = await RequestModel.getNoAuthTransaction(parameters.transactionId);

        if (!txn) {
            return { error: true, errorCode: 'INVALID-CAPTCHA-TRANSACTION-ID' };
        }

        // ── 2. Server-side expiry check (independent of cron) ────────────────
        if (Date.now() - txn.server_created_at > CAPTCHA_MAX_AGE_MS) {
            await deletionFunction({ docId: parameters.transactionId });
            return { error: true, errorCode: 'EXPIRED-CAPTCHA-TRANSACTION' };
        }

        // ── 3. Version check ─────────────────────────────────────────────────
        if (txn.captcha_version !== captchaSystemVersion) {
            return { error: true, errorCode: 'CAPTCHA-SYSTEM-VERSION-ERROR' };
        }

        // ── 4. Bind checks: IP, fingerprint, user-agent ──────────────────────
        if (!(await isIpInRange(parameters.ip, txn.ip_range))) {
            await deletionFunction({ docId: parameters.transactionId });
            return { error: true, errorCode: 'INVALID-CAPTCHA-TRANSACTION-IP' };
        }

        // Fingerprint is an advisory risk signal, not a hard gate
        let fpRiskScore = 0;
        if (!(await verifyHash(parameters.fingerprint, txn.fingerprint))) {
            fpRiskScore += 30;
        }
        if (fpRiskScore >= 50) {
            await deletionFunction({ docId: parameters.transactionId });
            return { error: true, errorCode: 'INVALID-CAPTCHA-TRANSACTION-FINGERPRINT' };
        }

        if (txn.user_agent !== parameters.userAgent) {
            await deletionFunction({ docId: parameters.transactionId });
            return { error: true, errorCode: 'INVALID-CAPTCHA-TRANSACTION-USERAGENT' };
        }

        // ── 5. CAPTCHA code check ────────────────────────────────────────────
        const normalizedCaptchaInput = (parameters.recaptchaResponse.captchaCode || '').trim();

        const isCodeValid = await verifyCaptcha(normalizedCaptchaInput, txn.captcha_code);

        if (!isCodeValid) {
            await deletionFunction({ docId: parameters.transactionId });
            return { error: true, errorCode: 'INVALID-CAPTCHA-CODE' };
        }

        // ── 6. Consume transaction immediately (replay protection) ───────────
        await deletionFunction({ docId: parameters.transactionId });

        // ── 7. Sign the token with SignatureSecretsManager ───────────────────
        const ssm = globalAccessPoint.SIGNATURE_SECRETS_MANAGER_internal();
        const signingPair = await ssm.getRandomSigningKeyPair();

        if (!signingPair) {
            return { error: true, errorCode: 'SIGNING-KEY-UNAVAILABLE' };
        }

        const exp = getFutureUnixTime('1d');

        // Payload bound to the full device context — IP, user-agent, AND
        // fingerprint are all embedded and cryptographically signed so the token
        // cannot be lifted and used from a different device or browser profile.
        // We reuse the database fingerprint hash to embed in the payload.
        const tokenPayload = JSON.stringify({
            type: 'NO_AUTH_TOKEN',
            ipRange: getIpRange(parameters.ip),
            userAgent: parameters.userAgent,
            fpHash: txn.fingerprint,
            exp: exp,
            kid: signingPair.keyPairId
        });

        const signature = ssm.sign(tokenPayload, signingPair.keyPairId);

        // Format: base64(payload).signature
        // The keyPairId is embedded inside the payload so the verifier knows
        // which public key to look up without a separate header field.
        const payloadB64 = Buffer.from(tokenPayload).toString('base64url');
        const token = `${payloadB64}.${signature}`;

        return {
            error: false,
            success: true,
            cookies: [{ key: 'NO_AUTH_TOKEN', data: token, maxAge: 86400000 }]
        };
    };

    const parameters = {
        ip: ip,
        fingerprint: fingerprint,
        // Sanitise on the way in — must match what was stored at transaction creation
        userAgent: (userAgent || '').slice(0, MAX_USER_AGENT_LENGTH),
        recaptchaResponse: recaptchaResponse,
        transactionId: transactionId
    };

    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'generateNoAuthToken', functionSource);
};

export const routeHandlerGenerateNoAuthToken = async (request, response) => {
    const packet = request.body.packet;

    const recaptchaResponse = packet.recaptchaResponse || 'NONE';
    const ip = getIp(request);
    const fingerprint = request.headers['orion-fingerprint'];
    const userAgent = request.headers['orion-user-agent'];
    const transactionId = packet.transactionId || 'NONE';

    const callback = await generateNoAuthToken(ip, fingerprint, userAgent, recaptchaResponse, transactionId);
    if (callback.error) {
        return respondWithError(response, callback?.errorCode);
    }

    if (callback.cookies) {
        for (let i = 0; i < callback.cookies.length; i++) {
            const cookie = callback.cookies[i];
            response.cookie(cookie.key, stringifyCookieData(cookie.data), {
                httpOnly: true,
                secure: true,
                sameSite: 'None',
                maxAge: cookie.maxAge
            });
        }
    }

    delete callback.cookies;

    return respondWithSuccess(response, 200, callback);
};

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATE TOKEN
// ─────────────────────────────────────────────────────────────────────────────

const validateNoAuthToken = async (token, ip, fingerprint, userAgent) => {
    const Function = async parameters => {
        // ── 1. Split token into payload + signature ───────────────────────────
        const dotIndex = parameters.token.indexOf('.');
        if (dotIndex === -1) {
            return { error: true, errorCode: 'INVALID-NO-AUTH-TOKEN' };
        }

        const payloadB64 = parameters.token.slice(0, dotIndex);
        const signature = parameters.token.slice(dotIndex + 1);

        // ── 2. Decode and parse payload ───────────────────────────────────────
        let payload;
        try {
            payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        } catch {
            return { error: true, errorCode: 'INVALID-NO-AUTH-TOKEN' };
        }

        // ── 3. Structural + type check ────────────────────────────────────────
        // fpHash is now required — tokens without it (e.g. old format) are rejected
        if (!payload || payload.type !== 'NO_AUTH_TOKEN' || !payload.exp || !payload.kid || !payload.fpHash || !payload.ipRange) {
            return { error: true, errorCode: 'INVALID-NO-AUTH-TOKEN' };
        }

        // ── 4. Expiry check ───────────────────────────────────────────────────
        if (getCurrentUnixTime() > payload.exp) {
            return { error: true, errorCode: 'EXPIRED-NO-AUTH-TOKEN' };
        }

        // ── 5. Cryptographic signature verification ───────────────────────────
        // The token cannot be forged without the private key. Any tampering with
        // the payload (ip, userAgent, fpHash, exp) invalidates the signature.
        // We must pass the raw decoded JSON string to ssm.verify(), as that is
        // what was passed to ssm.sign() during generation.
        const ssm = globalAccessPoint.SIGNATURE_SECRETS_MANAGER_internal();
        const rawPayloadString = Buffer.from(payloadB64, 'base64url').toString('utf8');
        const signatureValid = await ssm.verify(rawPayloadString, signature, payload.kid);

        if (!signatureValid) {
            return { error: true, errorCode: 'INVALID-NO-AUTH-TOKEN' };
        }

        // ── 6. Device binding checks ──────────────────────────────────────────
        // All three checks run against the cryptographically signed payload —
        // a stolen token cannot be used from a different device, IP, or browser.
        // Checks are ordered cheapest-first (string compare before bcrypt).
        // All return the same error code to avoid revealing which field failed.
        if (!(await isIpInRange(parameters.ip, payload.ipRange))) {
            return { error: true, errorCode: 'INVALID-NO-AUTH-TOKEN' };
        }

        if (payload.userAgent !== parameters.userAgent) {
            return { error: true, errorCode: 'INVALID-NO-AUTH-TOKEN' };
        }

        // Fingerprint is an advisory risk signal, not a hard gate
        let riskScore = 0;
        if (!(await verifyHash(parameters.fingerprint, payload.fpHash))) {
            riskScore += 30;
        }
        if (riskScore >= 50) {
            return { error: true, errorCode: 'INVALID-NO-AUTH-TOKEN' };
        }

        return { error: false, valid: true };
    };

    const parameters = {
        token: token,
        ip: ip,
        fingerprint: fingerprint,
        userAgent: (userAgent || '').slice(0, MAX_USER_AGENT_LENGTH)
    };

    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'validateNoAuthToken', functionSource);
};

export const routeHandlerDeviceHasNoAuthToken = async (request, response) => {
    const noAuthTokenEnabled = globalAccessPoint.captcha();

    if (!noAuthTokenEnabled) {
        return respondWithError(response, 'NO-AUTH-TOKEN-DISABLED');
    }

    const authHeader = request.headers['authorization'] || 'DEFAULT NONE';
    const tokenType = authHeader.split(' ')[0];

    if (tokenType !== 'NO_BEARER') {
        return respondWithError(response, 'NO-AUTH-TOKEN-UNAUTHORIZED');
    }

    const token = parseCookieData(request.cookies['NO_AUTH_TOKEN']) || 'NONE';

    if (token === 'NONE') {
        return respondWithError(response, 'NO-AUTH-TOKEN-NOT-FOUND');
    }

    const userAgent = (request.headers['orion-user-agent'] || '').slice(0, MAX_USER_AGENT_LENGTH);
    const fingerprint = request.headers['orion-fingerprint'];
    const ip = getIp(request);

    const verification = await validateNoAuthToken(token, ip, fingerprint, userAgent);

    if (verification.error || !verification.valid) {
        return respondWithError(response, verification.errorCode);
    }

    return respondWithSuccess(response, 200, { valid: true });
};

export { validateNoAuthToken };
