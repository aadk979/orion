import FingerprintJS from '../External-Scripts/fPrint.js';

async function getDeviceFingerprint() {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    return result.visitorId;
}

export { getDeviceFingerprint };