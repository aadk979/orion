// This is functionaly the same code as Api.js but a secondary one was created to prevent ciruclar dependency in some modules

import { getDeviceFingerprint } from './DevicePrint.js';

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

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip, deflate, br',
                'orion-fingerprint': await getDeviceFingerprint(),
                'orion-user-agent': navigator.userAgent,
                'orion-api-system-version': '1.0.0[BETA]',
                Origin: window.location.origin,
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
