import FingerprintJS from '../External-Scripts/fPrint.js';

async function sha256Hash(message) {
    // Convert the message to a Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(message);

    // Hash the data
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert ArrayBuffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return hashHex;
}

async function getDeviceFingerprint() {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    return await sha256Hash(result.visitorId + window.location.origin);
}

export { getDeviceFingerprint };