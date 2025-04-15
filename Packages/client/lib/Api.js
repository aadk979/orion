const { getDeviceFingerprint } = require("./Fingerprint");

class ApiInterface {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    async getData(endpoint, params = {}) {
        const url = new URL(`${this.baseUrl}${endpoint}`);
        Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

        const response = await fetch(url , {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-Orion-Cross-Origin": "TRUE",
                "orion-fingerprint": await getDeviceFingerprint(),
                "orion-user-agent": navigator.userAgent,
            },
            credentials: "include",
        });

        if (!response.ok) {
            return { error: true , errorCode: "CLIENT-UNABLE-TO-GET-RESOURCE" }
        }

        return response;
    }

    async fetch(endpoint , method , body = {}) {
        const url = `${this.baseUrl}${endpoint}`;

        const response = await fetch(url , {
            method: method,
            headers: {
                "Content-Type": "application/json",
                "X-Orion-Cross-Origin": "TRUE",
                "orion-fingerprint": await getDeviceFingerprint(),
                "orion-user-agent": navigator.userAgent,
            },
            credentials: "include",
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            return { error: true , errorCode: "CLIENT-UNABLE-TO-GET-RESOURCE" }
        }

        return response;
    }
}