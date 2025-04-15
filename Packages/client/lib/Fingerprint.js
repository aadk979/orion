import FingerprintJS from 'https://openfpcdn.io/fingerprintjs/v4';

async function getDeviceFingerprint() {
    const fp = await FingerprintJS.load();
    const result = await fp.get();
    return result.visitorId;
}

export { getDeviceFingerprint };