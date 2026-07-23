/**
 * Canonical signing string for worker → orchestrator requests.
 *
 * ONE definition, used by both the signer (lib/interface.js) and the verifier
 * (lib/core/middleware/securityMiddleware.js). These two must produce byte-identical
 * strings or every request fails to authenticate, so they must not each build it
 * by hand.
 *
 * The signature covers the request, not just the sender. Signing only identity +
 * freshness (`workerId:timestamp:nonce`) proved that a worker sent *something*
 * recently, but said nothing about method, target or content — so anything able
 * to modify a request in flight could swap the body or point it at a different
 * endpoint while the signature still verified. Method, path and a body digest
 * close that gap; nonce and timestamp continue to cover replay and freshness.
 *
 * Body digest note: an empty body MUST canonicalize the same on both sides.
 * Express yields `{}` for a bodyless POST after express.json(), so the signer
 * passes `{}` when it sends no body.
 */
import { sha256Hash } from './crypto.js';

/** Digest of the JSON body exactly as it goes on the wire. */
const digestBody = body => sha256Hash(typeof body === 'string' ? body : JSON.stringify(body ?? {}));

/**
 * @param {object} parts
 * @param {string} parts.method     HTTP method, upper-case (e.g. 'POST')
 * @param {string} parts.path       pathname only — no query string
 * @param {*}      parts.body       request body (object, or the exact JSON string sent)
 * @param {string} parts.workerId
 * @param {number} parts.timestamp  unix seconds
 * @param {string} parts.nonce
 * @returns {string} the exact string to sign / verify
 */
const buildRequestSignaturePayload = ({ method, path, body, workerId, timestamp, nonce }) =>
    `${String(method).toUpperCase()}:${path}:${digestBody(body)}:${workerId || ''}:${timestamp}:${nonce}`;

export { buildRequestSignaturePayload, digestBody };
