import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { getIp } from '../../Ip.js';
import {
    authorizeDeviceWithCode,
    sendDeviceAuthorizationMail,
    authorizeDeviceDirect
} from '../AccountManagment/2FA&DeviceAuthorization/DeviceAuthorization.js';
import { parseCookieData, setManagedCookie, clearManagedCookie } from '../../CookieUtils.js';
import { resolveClientContext } from '../../Parsers.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, PasskeyModel, TOTPModel } from '../../Databases/models/index.js';
import { veryifyAndCompletePasskeyAuthentication } from '../AccountManagment/Passkeys/completeAuthentication.js';
import { verifyTOTPToken } from '../AccountManagment/TOTP.js';
import { validateDeviceAuthContext } from './DeviceAuthContext.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'DeviceAuthorization.js');

const routeHandlerDeviceAuthorization = async (request, response) => {
    const headers = request.headers;
    const userAgent = headers['orion-user-agent'];
    const ip = getIp(request);

    const requestId = parseCookieData(request.cookies['deviceAuthorizationRequestId']);
    const flowSecret = parseCookieData(request.cookies['deviceAuthFlowSecret']) || '';

    if (!requestId) {
        return respondWithError(response, 'DEVICE-AUTH::MISSING-REQUEST-ID::A::p');
    }

    const code = request.body.packet.authorizationCode;

    const callback = await authorizeDeviceWithCode(requestId, code, flowSecret, ip, userAgent);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    if (callback?.cookies) {
        for (const cookie of callback.cookies) {
            if (cookie.maxAge === 0) {
                clearManagedCookie(response, cookie.key);
            } else {
                setManagedCookie(response, cookie.key, cookie.data);
            }
        }
    }

    clearManagedCookie(response, 'deviceAuthorizationRequestId');
    clearManagedCookie(response, 'deviceAuthEmailOffset');
    clearManagedCookie(response, 'deviceAuthFlowSecret');

    return respondWithSuccess(response, 200, { success: true });
};

/**
 * Resolves the account this device-authorization request is acting on.
 *
 * The subject used to be read straight out of the `deviceAuthEmailOffset`
 * cookie as a plain email, which any caller could set to any address. It is now
 * a server-signed, device-bound context (see DeviceAuthContext.js) and this is
 * the only way these handlers learn who they are dealing with.
 *
 * @returns {Promise<{ ok: false } | { ok: true, email: string, uid: string|null }>}
 *   `ok: true` with a null uid means the context is valid but names no
 *   registered account — callers must behave identically to the registered case
 *   (see the uniformity note on each handler).
 */
const resolveDeviceAuthContext = async (request, response) => {
    const context = await validateDeviceAuthContext(request.cookies['deviceAuthEmailOffset']);

    if (context.error) {
        respondWithError(response, context.errorCode || 'DEVICE-AUTH::MISSING-EMAIL-OFFSET::A::p');
        return { ok: false };
    }

    // The uid is re-resolved rather than trusted from the token, so an account
    // deleted or created since the context was minted is seen as it is now.
    const uid = await UserModel.getUidByEmail(context.email);

    return { ok: true, email: context.email, uid: uid || null };
};

const routeHandlerGetAvailable2faMethods = async (request, response) => {
    const ctx = await resolveDeviceAuthContext(request, response);
    if (!ctx.ok) return;

    // An address with no account reports the same shape as a registered one
    // with no extra factors enrolled. Returning ACCOUNT-NOT-FOUND here told an
    // unauthenticated caller whether any address they cared to name was
    // registered — and, for those that were, exactly which second factors the
    // owner held. 'email-code' is unconditionally true for a real account, so
    // this is the genuine response for a plausible account, not a special case.
    const hasPasskey = ctx.uid ? await PasskeyModel.hasPasskey(ctx.uid) : false;

    // isUsable, not isEnabled: an enrolled user whose secret cannot be
    // decrypted (key vault down, key rotated away) must NOT be offered a factor
    // that is guaranteed to fail. Dropping it here is what makes the fallback
    // to the emailed code automatic — 'email-code' is always available, so the
    // user completes authorization with two factors and is never locked out.
    const totpUsable = ctx.uid ? await TOTPModel.isUsable(ctx.uid) : false;

    const totpSystemDisabled = globalAccessPoint.getValue('totpSystemDisabled');
    const passkeySystemDisabled = !systemConfigModule.getModule()?.authMethods?.passkey;

    const methods = {
        'email-code': true,
        passkey: passkeySystemDisabled ? false : hasPasskey,
        totp: totpSystemDisabled ? false : totpUsable
    };

    return respondWithSuccess(response, 200, { methods });
};

const routeHandlerSendDeviceAuthorizationMail = async (request, response) => {
    const ctx = await resolveDeviceAuthContext(request, response);
    if (!ctx.ok) return;

    const headers = request.headers;
    const userAgent = headers['orion-user-agent'];
    const ip = getIp(request);

    // No account: report success without sending anything. The standard
    // don't-confirm-existence response — the alternative is an endpoint that
    // says "no such user" to anyone who asks, and that also mails a real user
    // on demand for every address that IS registered.
    if (!ctx.uid) {
        return respondWithSuccess(response, 200, { success: true });
    }

    const deviceAuthorizationRequest = await sendDeviceAuthorizationMail(ctx.email, ip, userAgent);

    if (deviceAuthorizationRequest.error) {
        return respondWithError(response, deviceAuthorizationRequest.errorCode);
    }

    setManagedCookie(response, 'deviceAuthorizationRequestId', deviceAuthorizationRequest.reqId);

    // Deliver the flow_secret to the client as an HttpOnly cookie for later verification
    setManagedCookie(response, 'deviceAuthFlowSecret', deviceAuthorizationRequest.flowSecret);

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerAuthorizeDeviceWithPasskey = async (request, response) => {
    const ctx = await resolveDeviceAuthContext(request, response);
    if (!ctx.ok) return;

    const cookie = request.cookies['PASSKEY-AUTHENTICATION-INFO-STEP-1'];
    const responseData = request.body.packet?.authenticationResponse;

    if (!responseData) {
        return respondWithError(response, 'PASSKEY::AUTH-FAILED::A::i');
    }

    // RP ID is the hostname, and a missing origin is answered rather than
    // thrown — see resolveClientContext in Utils/Parsers.js.
    const clientContext = resolveClientContext(request);

    if (!clientContext) {
        return respondWithError(response, 'GENERAL::UNKNOWN-ORIGIN::A::p');
    }

    const userAgent = request.headers['orion-user-agent'];

    // An unregistered address fails exactly as a wrong assertion does. The
    // ceremony lookup would fail anyway; answering with the same code keeps the
    // two indistinguishable.
    if (!ctx.uid) {
        return respondWithError(response, 'PASSKEY::AUTH-FAILED::A::i');
    }

    const verification = await veryifyAndCompletePasskeyAuthentication(responseData, cookie, ctx.email, clientContext.origin, clientContext.rpId);

    if (verification.error) {
        return respondWithError(response, verification.errorCode);
    }

    const authorization = await authorizeDeviceDirect(ctx.email, undefined, userAgent);

    if (authorization.error) {
        return respondWithError(response, authorization.errorCode);
    }

    if (authorization.cookies) {
        for (const cookieData of authorization.cookies) {
            if (cookieData.maxAge === 0) {
                clearManagedCookie(response, cookieData.key);
            } else {
                setManagedCookie(response, cookieData.key, cookieData.data);
            }
        }
    }

    clearManagedCookie(response, 'PASSKEY-AUTHENTICATION-INFO-STEP-1');
    clearManagedCookie(response, 'deviceAuthEmailOffset');

    return respondWithSuccess(response, 200, { success: true });
};

const routeHandlerAuthorizeDeviceWithTOTP = async (request, response) => {
    const ctx = await resolveDeviceAuthContext(request, response);
    if (!ctx.ok) return;

    if (globalAccessPoint.getValue('totpSystemDisabled')) {
        return respondWithError(response, 'TOTP::SYSTEM-DISABLED::A::i');
    }

    const totpCode = request.body.packet?.totpCode || request.body.packet?.code;
    const userAgent = request.headers['orion-user-agent'];

    // Unregistered address: answer exactly as a wrong code does, so this
    // endpoint cannot be used to test whether an address has an account.
    if (!ctx.uid) {
        return respondWithError(response, 'DEVICE-AUTH::INVALID-TOTP::A::p');
    }

    // ── Per-account ceiling ──────────────────────────────────────────────────
    // This endpoint is unauthenticated, names its account from a cookie, and
    // accepts a 6-digit code. Before this ceiling existed nothing bounded
    // guessing it: chargeFailedAttempt() charges a challenge record and a TOTP
    // submission creates none, so the only backstop was the per-IP abuse
    // detector — which a distributed caller sidesteps and which fails open when
    // Redis is unreachable. Succeeding here marks the caller's device trusted
    // for the account, so it is the device-authorization gate itself that was
    // brute-forcible.
    //
    // Refuses the TOTP factor only. The emailed code stays available, so a real
    // owner whose authenticator is being attacked still has a way in.
    const throttle = await UserModel.getSecondFactorThrottle(ctx.uid);

    if (throttle.throttled) {
        return respondWithError(response, 'DEVICE-AUTH::TOTP-THROTTLED::A::p');
    }

    const totpConfig = await TOTPModel.getTOTPConfig(ctx.uid);

    if (!totpConfig?.enabled) {
        return respondWithError(response, 'TOTP::NOT-ENABLED::A::p');
    }

    const secret = totpConfig.secret;

    // Enrolled, but the stored secret could not be decrypted on this node.
    // Reported as a system-level TOTP outage rather than an invalid code, so
    // the client falls back to the emailed one-time code instead of telling the
    // user their authenticator is wrong.
    if (!secret) {
        return respondWithError(response, 'TOTP::SYSTEM-DISABLED::A::i');
    }

    const verification = await verifyTOTPToken(totpCode, secret);

    if (verification.error) {
        await UserModel.recordFailedSecondFactor(ctx.uid);

        return respondWithError(response, 'DEVICE-AUTH::INVALID-TOTP::A::p');
    }

    await UserModel.clearFailedSecondFactors(ctx.uid);

    const authorization = await authorizeDeviceDirect(ctx.email, undefined, userAgent);

    if (authorization.error) {
        return respondWithError(response, authorization.errorCode);
    }

    if (authorization.cookies) {
        for (const cookieData of authorization.cookies) {
            if (cookieData.maxAge === 0) {
                clearManagedCookie(response, cookieData.key);
            } else {
                setManagedCookie(response, cookieData.key, cookieData.data);
            }
        }
    }

    clearManagedCookie(response, 'deviceAuthEmailOffset');

    return respondWithSuccess(response, 200, { success: true });
};

export {
    routeHandlerDeviceAuthorization,
    routeHandlerGetAvailable2faMethods,
    routeHandlerSendDeviceAuthorizationMail,
    routeHandlerAuthorizeDeviceWithPasskey,
    routeHandlerAuthorizeDeviceWithTOTP
};
