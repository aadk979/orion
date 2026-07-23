import { renderDeviceAuthorizationUI } from '../Flows/DeviceAuthorizationFlow.js';
import { renderStepUpAuthUI } from '../Flows/StepUpAuthFlow.js';
import { getDeviceFingerprint } from './DevicePrint.js';
import { createProof } from './DpopKey.js';

const ORION_FLOW_TYPES = {
    'FLOW-DEVICE-AUTHORIZATION': { fn: renderDeviceAuthorizationUI, params: ['baseUrl', 'nameSpace', 'slug'] },
    'FLOW-STEP-UP-AUTH': { fn: renderStepUpAuthUI, params: ['baseUrl', 'nameSpace', 'slug'] }
};

class ApiInterface {
    constructor(baseUrl, nameSpace, slug, options = {}) {
        this.baseUrl = baseUrl;
        this.nameSpace = nameSpace;
        this.slug = slug;

        // Attach a DPoP proof to every request. Must match the server's
        // tokens.binding setting: proofs sent to a server that does not bind are
        // simply ignored, but a bound server rejects requests that omit them.
        this.useDpop = options.useDpop === true;

        // Set by the Orion root: invoked whenever the server flags a response
        // with orion-session-logout, i.e. the session on this device is dead
        // (revoked / expired beyond refresh / tampered). Central teardown —
        // individual API handlers never need to interpret token error codes.
        this.onSessionInvalid = null;
    }

    // NOTE: The custom DIP integrity envelope and hybrid transport-encryption layer
    // were removed — request payloads now travel as plain JSON, protected by TLS 1.3.
    // See Graveyard/ for the historical record of those subsystems.
    async fetch(endpoint, method, authorization, body = {}) {
        const url = `${this.baseUrl}${this.slug !== '' ? '/' + this.slug : ''}${endpoint}`;

        // Proof of possession, when the deployment binds tokens to a device key.
        // The proof is per-request (method + URI + a one-time jti), so it cannot
        // be lifted onto another call. Failure is non-fatal: an unbound session
        // never needs it, and the server rejects a bound one that arrives without.
        let dpopProof = null;

        if (this.useDpop) {
            try {
                dpopProof = await createProof(method, url);
            } catch (e) {
                console.warn('[Orion] Could not create a device proof for this request:', e?.message);
            }
        }

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
                'orion-fingerprint': await getDeviceFingerprint(),
                'orion-user-agent': navigator.userAgent,
                'orion-api-system-version': '1.0.0[BETA]',
                ...(dpopProof ? { DPoP: dpopProof } : {}),
                // NOTE: `Origin` is deliberately NOT set here. It is a forbidden
                // header name — the browser discards any script-supplied value and
                // sets its own — so writing it was dead code that also implied this
                // SDK is what satisfies the server's mandatory-Origin check. It is
                // the browser that does; a non-browser runtime must send it itself.
                Authorization: authorization
            },
            credentials: 'include',
            body: body ? JSON.stringify(body) : undefined
        });

        const refresh = response.headers.get('orion-response-refresh') || response.headers.get('Orion-Response-Refresh');

        if (refresh) {
            if (String(refresh) === 'true') {
                window.location.reload();
            }
        }

        const sessionLogout = response.headers.get('orion-session-logout') || response.headers.get('Orion-Session-Logout');

        if (String(sessionLogout) === 'true' && typeof this.onSessionInvalid === 'function') {
            await this.onSessionInvalid();
        }

        const flow = response.headers.get('orion-flow-activation') || response.headers.get('Orion-Flow-Activation');

        if (flow) {
            const flowFn = ORION_FLOW_TYPES[flow];

            if (!flowFn) {
                throw new Error('Orion header flow triggered, invalid flow type!');
            }

            // dynamically extract params from 'this'
            const args = flowFn.params.map(paramName => this[paramName]);

            // await the flow UI — it now resolves when the user completes authorization
            await flowFn.fn(...args);

            // Signal the caller to retry their original operation with the same args.
            // The original response is stale (it had the flow header, not a real result).
            const retryErr = new Error('ORION_DEVICE_AUTH_COMPLETED');
            retryErr._orionDeviceAuthCompleted = true;
            throw retryErr;
        }

        return response;
    }
}

export { ApiInterface };
