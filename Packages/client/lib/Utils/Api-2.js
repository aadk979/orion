// This is functionaly the same code as Api.js but a secondary one was created to prevent ciruclar dependency in some modules

import { getDeviceFingerprint } from './DevicePrint.js';
import { createProofIfEnabled } from './DpopKey.js';

class ApiInterface {
    constructor(baseUrl, nameSpace, slug) {
        this.baseUrl = baseUrl;
        this.nameSpace = nameSpace;
        this.slug = slug;
    }

    // Payloads travel as plain JSON over TLS 1.3; the DIP integrity envelope and the
    // hybrid transport-encryption layer were decommissioned. See Graveyard/.
    async fetch(endpoint, method, authorization, body = {}) {
        const url = `${this.baseUrl}${this.slug !== '' ? '/' + this.slug : ''}${endpoint}`;

        // The flow overlays (step-up, device authorization, notifications) go
        // through this interface and hit the same authenticated endpoints as the
        // main one. Without a proof they are refused outright by a server that
        // binds tokens — which would have made step-up unreachable exactly when
        // a risk signal demanded it.
        const dpopProof = await createProofIfEnabled(method, url);

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
                'orion-fingerprint': await getDeviceFingerprint(),
                'orion-user-agent': navigator.userAgent,
                'orion-api-system-version': '1.0.0[BETA]',
                ...(dpopProof ? { DPoP: dpopProof } : {}),
                // `Origin` is a forbidden header name — the browser overwrites
                // any script-supplied value with its own. Setting it here was
                // dead code; removed to match Api.js.
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

        return response;
    }
}

export { ApiInterface };
