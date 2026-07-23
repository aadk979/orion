import { orionVault } from './OrionVault.js';

/**
 * Device-bound signing key for proof-of-possession (DPoP).
 *
 * THE POINT OF THIS FILE
 *
 * Session cookies are HttpOnly, which stops script reading them — but anything
 * that can make requests from the page can still USE them, and a token lifted by
 * any other route (a proxy, a log, a backup, a shared profile) works anywhere.
 *
 * The keypair here is generated with `extractable: false`. The private key then
 * exists only as an opaque handle inside the browser: code can ask it to sign,
 * and cannot read it out — not through IndexedDB, not through `exportKey`, not
 * through XSS. A token bound to it is useless to anyone who does not also have
 * this browser profile.
 *
 * That does not stop an attacker executing inside the live page — they can ask
 * the key to sign for as long as they are resident. What it removes is the far
 * more common case: durable, portable theft of a credential that keeps working
 * elsewhere, later.
 */

const KEY_STORE_ID = 'dpop-keypair';
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: { name: 'SHA-256' } };

const base64Url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const encodeSegment = obj => base64Url(new TextEncoder().encode(JSON.stringify(obj)));

let cached = null;

/**
 * Returns the device keypair, creating it on first use.
 *
 * The CryptoKey objects are what gets stored — structured-clone keeps them as
 * live handles, so the private key never becomes bytes at any point.
 */
const getKeyPair = async () => {
    if (cached) return cached;

    const stored = await orionVault.getItem(KEY_STORE_ID).catch(() => undefined);

    if (stored?.privateKey && stored?.publicKey) {
        cached = stored;
        return cached;
    }

    const keyPair = await crypto.subtle.generateKey(ALGORITHM, /* extractable */ false, ['sign', 'verify']);

    // Only the PUBLIC half is ever exportable — that is what travels in proofs.
    const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    cached = { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, publicJwk };

    await orionVault.setItem(KEY_STORE_ID, cached).catch(() => {
        // A vault write failure is survivable: the key stays in memory for this
        // page, and a fresh one is minted next load. Sessions bound to the old
        // key stop working, which is a correctness annoyance, not a hole.
    });

    return cached;
};

/** RFC 7638 thumbprint — the identity the server binds a token to. */
const getThumbprint = async () => {
    const { publicJwk } = await getKeyPair();

    const canonical = { crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));

    return base64Url(digest);
};

/** SHA-256 of the access token, base64url — the `ath` claim. */
const hashAccessToken = async token => base64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));

/**
 * Builds a DPoP proof for one specific request.
 *
 * Bound to method and URI so it cannot be replayed against another endpoint, and
 * carries a random `jti` the server records once — so it cannot be replayed at
 * all.
 *
 * @param {string} method
 * @param {string} url          full request URI, no query string
 * @param {string} [accessToken] when present, the proof is tied to this token
 * @returns {Promise<string>} compact JWS
 */
const createProof = async (method, url, accessToken = null) => {
    const { privateKey, publicJwk } = await getKeyPair();

    const header = {
        typ: 'dpop+jwt',
        alg: 'ES256',
        // Public half only — never the private member.
        jwk: { crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y }
    };

    const payload = {
        htm: method.toUpperCase(),
        htu: url,
        iat: Math.floor(Date.now() / 1000),
        jti: base64Url(crypto.getRandomValues(new Uint8Array(16)))
    };

    if (accessToken) {
        payload.ath = await hashAccessToken(accessToken);
    }

    const signingInput = `${encodeSegment(header)}.${encodeSegment(payload)}`;
    const signature = await crypto.subtle.sign(SIGN_PARAMS, privateKey, new TextEncoder().encode(signingInput));

    return `${signingInput}.${base64Url(signature)}`;
};

/** Drops the device key — used on sign-out so the next session gets a fresh one. */
const resetKey = async () => {
    cached = null;
    await orionVault.deleteItem(KEY_STORE_ID).catch(() => {});
};

export { createProof, getThumbprint, resetKey };
