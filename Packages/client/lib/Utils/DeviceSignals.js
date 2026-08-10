/**
 * Device signal used by the server as a soft risk input.
 *
 * WHY THIS REPLACED FingerprintJS
 *
 * Two reasons, one legal and one architectural.
 *
 * The bundled FingerprintJS v4 build was licensed under the Business Source
 * License 1.1 with "Additional Use Grant: None" — commercial use is not
 * granted until that version's change date. Shipping it inside a product is a
 * licensing exposure, not a technical one, and no amount of engineering fixes
 * it.
 *
 * The architectural reason matters more. That library exists to identify a
 * browser against its will — canvas rendering, audio-context quirks, font
 * enumeration, WebGL parameters. That is the right toolkit if a fingerprint is
 * carrying real security weight. It no longer is: RFC 9449 proof of possession
 * binds sessions to a non-extractable key, so this value's entire remaining
 * job is to answer "does this look like the same device as before?" for risk
 * scoring and abuse heuristics.
 *
 * For that job, adversarial fingerprinting is actively the wrong tool. It is
 * unstable — every browser update, privacy mode, and anti-fingerprinting
 * measure shifts the value, and each shift is a false risk signal that pushes
 * a legitimate user into step-up. What is wanted is something STABLE for real
 * users and merely inconvenient for an attacker to keep rotating.
 *
 * WHAT THIS DOES INSTEAD
 *
 * A random per-origin identifier, generated once and persisted in the same
 * IndexedDB vault the device key lives in. Stable across reloads, updates and
 * navigations; scoped to the origin so it cannot correlate the user anywhere
 * else; and carrying no information about the device at all, which is what
 * makes it safe to send on every request.
 *
 * Clearing site data resets it, and that is the correct behaviour rather than
 * a weakness to engineer around — a user who clears storage has asked not to
 * be recognised. It registers as a new device: a risk signal, evaluated
 * alongside the key binding, exactly as intended.
 *
 * Where storage is unavailable (private modes that block IndexedDB, embedded
 * webviews), it degrades to a coarse hash of stable environment properties.
 * That is weaker and deliberately so — it keeps the header populated and the
 * request working rather than failing a sign-in over a risk signal.
 */
import { orionVault } from './OrionVault.js';

const STORE_ID = 'device-signal-id';

let cached = null;

const toHex = buffer =>
    Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

/** SHA-256 hex. The server validates this as exactly 64 hex characters. */
const sha256Hex = async message => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)));

/**
 * Stable environment properties, used only when persistent storage is
 * unavailable.
 *
 * Deliberately excludes anything that changes during ordinary use:
 * `devicePixelRatio` moves with browser zoom, and window dimensions move
 * constantly. Screen geometry is included because it is stable per display
 * configuration; attaching an external monitor will shift it, which is an
 * acceptable inaccuracy for a fallback path that only feeds a risk score.
 */
const environmentSignals = () => {
    const nav = navigator || {};
    const scr = screen || {};

    let timeZone = '';
    try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        timeZone = '';
    }

    return [
        nav.userAgent || '',
        (nav.languages && nav.languages.join(',')) || nav.language || '',
        nav.hardwareConcurrency || '',
        nav.deviceMemory || '',
        nav.maxTouchPoints || '',
        scr.width || '',
        scr.height || '',
        scr.colorDepth || '',
        timeZone
    ].join('|');
};

/** 16 random bytes, hex. Generated once per origin, then persisted. */
const mintIdentifier = () => toHex(crypto.getRandomValues(new Uint8Array(16)));

/**
 * Returns the device signal for this browser and origin.
 *
 * @returns {Promise<string>} 64 hex characters
 */
async function getDeviceFingerprint() {
    if (cached) return cached;

    const origin = window.location.origin;

    let identifier = null;

    try {
        identifier = await orionVault.getItem(STORE_ID);

        if (typeof identifier !== 'string' || identifier.length === 0) {
            identifier = mintIdentifier();
            await orionVault.setItem(STORE_ID, identifier);
        }
    } catch {
        identifier = null;
    }

    // The two branches are domain-separated so a stored identifier and a
    // fallback hash can never collide, and so the server-side value visibly
    // changes if a browser starts or stops permitting storage.
    cached = identifier ? await sha256Hex(`id:${identifier}:${origin}`) : await sha256Hex(`env:${environmentSignals()}:${origin}`);

    return cached;
}

/** Drops the device signal — used on sign-out alongside the device key. */
async function resetDeviceFingerprint() {
    cached = null;
    await orionVault.deleteItem(STORE_ID).catch(() => {});
}

export { getDeviceFingerprint, resetDeviceFingerprint };
