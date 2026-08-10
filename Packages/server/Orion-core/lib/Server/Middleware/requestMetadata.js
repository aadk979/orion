import ipaddr from 'ipaddr.js';
import { getIp } from '../../Utils/Ip.js';
import { respondWithError } from '../Response/response.js';
import { parseCookieData } from '../../Utils/CookieUtils.js';
import { validateStepUpToken } from '../../Utils/Core/SecurityManagment/StepUpAuth.js';
import { SafeModuleHandler } from '../../Utils/UnavailableModuleWrapper.js';
// Store lives in its own leaf module so the response layer can read it without
// closing an import cycle back through here. Re-exported below for compatibility.
import { requestContext } from './requestContextStore.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'requestMetadata.js');

const RULES = [
    {
        applyTo: 'fingerprint',
        mustHave: true,
        missingError: 'GENERAL::MISSING-FINGERPRINT::A::p',
        invalidError: 'GENERAL::INVALID-FINGERPRINT::A::p',
        callback: fp => typeof fp === 'string' && /^[0-9a-fA-F]{64}$/.test(fp)
    },
    {
        applyTo: 'userAgent',
        mustHave: true,
        missingError: 'GENERAL::MISSING-USER-AGENT::A::p',
        invalidError: null,
        callback: null
    },
    {
        applyTo: 'ip',
        mustHave: true,
        missingError: 'GENERAL::UNRESOLVABLE-CLIENT-IP::A::p',
        invalidError: 'GENERAL::UNRESOLVABLE-CLIENT-IP::A::p',
        callback: ip => {
            try {
                const parsed = ipaddr.parse(ip);
                const kind = parsed.kind();
                if (kind !== 'ipv4' && kind !== 'ipv6') return false;
                const range = parsed.range();
                return range !== 'unspecified' && range !== 'Reserved';
            } catch {
                return false;
            }
        }
    }
];

const evaluateRules = metadata => {
    for (const rule of RULES) {
        const value = metadata[rule.applyTo];
        const absent = value === undefined || value === null || value === '';

        if (absent) {
            if (rule.mustHave) return rule.missingError;
            continue;
        }

        if (typeof rule.callback === 'function') {
            let passed = false;
            try {
                passed = rule.callback(value);
            } catch {
                passed = false;
            }
            if (!passed && rule.invalidError) return rule.invalidError;
        }
    }

    return null;
};

const requestMetadataMiddleware = async (request, response, next) => {
    const metadata = {
        fingerprint: request.headers['orion-fingerprint'],
        userAgent: request.headers['orion-user-agent'] || request.headers['user-agent'],
        ip: (() => {
            try {
                return getIp(request);
            } catch {
                return null;
            }
        })(),
        cookies: request.cookies,
        user: request.user || false,
        clientURL: request.headers.origin || request.headers.referer || `${request.protocol}://${request.get('host')}`,
        // Needed to bind a DPoP proof to this exact request (htm / htu).
        method: request.method,
        requestUri: `${request.protocol}://${request.get('host')}${request.originalUrl.split('?')[0]}`,
        dpopProof: request.headers['dpop'] || null,
        // Per-request memo of verified DPoP proofs. A client sends one proof per
        // request, but several independent checks in a single request may need
        // it (step-up token here, then the access token — and on a refresh, the
        // refresh token and the newly minted access token too). Verification
        // consumes the proof's jti, so without this memo every one of those
        // after the first failed as a replay. The Map is mutable even though the
        // metadata object is frozen, and a new one per request is what keeps
        // cross-request replay protection intact.
        dpopProofCache: new Map(),
        stepUpAuthComplete: false,
        stepUpUid: null
    };

    const violation = evaluateRules(metadata);
    if (violation) return respondWithError(response, violation);

    // Validate step-up token if present — allows the auth middleware to trust stepUpAuthComplete
    const rawStepUpToken = parseCookieData(request.cookies['STEP_UP_TOKEN']);
    if (rawStepUpToken) {
        // The proof context is handed over explicitly: this runs before
        // `requestContext.run` below, so the async store is not readable yet.
        const stepUpResult = await validateStepUpToken(rawStepUpToken, metadata.ip, metadata.userAgent, metadata.fingerprint, {
            dpopProof: metadata.dpopProof,
            method: metadata.method,
            requestUri: metadata.requestUri,
            // Handed over explicitly: this runs before `requestContext.run`, so
            // the proof memo cannot be read from the async store yet. Without
            // it the proof verified here would be consumed and every later
            // check in this same request would fail as a replay.
            proofCache: metadata.dpopProofCache
        });
        if (stepUpResult.valid) {
            metadata.stepUpAuthComplete = true;
            metadata.stepUpUid = stepUpResult.uid;
        }
    }

    response.set('orion-served-by', systemConfigModule.getModule().app.serviceID);

    request.requestContext = requestContext;
    requestContext.run(Object.freeze(metadata), () => next());
};

export { requestMetadataMiddleware, requestContext };
