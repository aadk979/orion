/**
 * Kept as the stable import path for the device signal — the API surface every
 * request path already uses. The implementation moved to DeviceSignals.js when
 * the BSL-licensed FingerprintJS bundle was removed; see that file for why the
 * approach changed as well as the library.
 */
export { getDeviceFingerprint, resetDeviceFingerprint } from './DeviceSignals.js';
