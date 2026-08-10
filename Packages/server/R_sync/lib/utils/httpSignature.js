/**
 * HTTP Message Signatures — RFC 9421, with Content-Digest from RFC 9530.
 *
 * WHY THIS REPLACED THE PROPRIETARY SCHEME
 *
 * The previous signer built its own canonical string:
 *
 *     METHOD:path:sha256(body):workerId:timestamp:nonce
 *
 * That was sound work — it covered the request rather than just the sender,
 * which is the mistake most hand-rolled schemes make. But it was a private
 * format, which carries costs that grow rather than shrink: no independent
 * review of the canonicalisation, no off-the-shelf verifier for anything that
 * is not this codebase, and every ambiguity (how is an absent body encoded?
 * what if a header repeats?) resolved by whichever side was written first.
 *
 * RFC 9421 is the standard for exactly this problem, published February 2024.
 * It specifies the canonical form precisely, covers derived components the ad-hoc
 * string could not express (`@authority`, `@target-uri` — so a signature cannot
 * be replayed against a different host), and is implementable by any peer from
 * the spec alone.
 *
 * The delimiter difference matters too. The old format joined fields with `:`,
 * a character that appears inside the values being joined — a path or a host
 * containing `:` shifts the field boundaries, and two different requests can
 * canonicalize identically. RFC 9421 quotes and length-delimits every
 * component, so that class of ambiguity cannot arise.
 *
 * WHAT IS SIGNED
 *
 *   "@method"          the HTTP method
 *   "@target-uri"      the full absolute URI — binds host, port, path and query
 *   "content-digest"   RFC 9530 digest of the body
 *   "x-r_sync-worker-id" the claimed sender
 *
 * plus the signature parameters (`created`, `keyid`, `nonce`, `alg`), which are
 * themselves part of the signature base — so an attacker cannot alter the
 * freshness window or swap the key id without invalidating the signature.
 */
import crypto from 'crypto';

/** Components every R_sync request signs. Order is part of the signature base. */
const DEFAULT_COVERED_COMPONENTS = ['@method', '@target-uri', 'content-digest', 'x-r_sync-worker-id'];

/** Signature label. RFC 9421 allows several; R_sync uses exactly one. */
const SIG_LABEL = 'sig1';

/** Maximum age of a signature, in seconds. */
const DEFAULT_MAX_AGE_SECONDS = 30;

/**
 * RFC 9530 Content-Digest for a body.
 *
 * The body is digested exactly as it goes on the wire. An absent body MUST
 * canonicalize identically on both sides — Express hands a bodyless POST to the
 * verifier as `{}` after express.json(), so the signer passes `{}` too. Getting
 * this wrong makes every bodyless request fail to verify, which is why it is
 * one function used by both halves rather than two that agree by convention.
 *
 * @param {*} body object, string, Buffer, or null
 * @returns {string} `sha-256=:<base64>:`
 */
const contentDigest = body => {
    const material = body === null || body === undefined ? '{}' : typeof body === 'string' ? body : Buffer.isBuffer(body) ? body : JSON.stringify(body);

    const digest = crypto.createHash('sha256').update(material).digest('base64');
    return `sha-256=:${digest}:`;
};

/** Verifies a received Content-Digest against the body actually delivered. */
const contentDigestMatches = (headerValue, body) => {
    if (typeof headerValue !== 'string') return false;

    const expected = Buffer.from(contentDigest(body), 'utf8');
    const presented = Buffer.from(headerValue.trim(), 'utf8');

    return expected.length === presented.length && crypto.timingSafeEqual(expected, presented);
};

/**
 * Value of one covered component, per RFC 9421 §2.2 (derived) and §2.1 (fields).
 *
 * Returns null for a component that cannot be resolved, which the callers treat
 * as a hard failure — signing or verifying over a silently-empty component
 * would let it be omitted without detection.
 */
const componentValue = (name, { method, url, headers, digest }) => {
    switch (name) {
        case '@method':
            return String(method).toUpperCase();

        case '@target-uri':
            return url;

        case '@authority': {
            // Lowercased host with the default port elided, per §2.2.3.
            const parsed = new URL(url);
            const isDefault = (parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80');
            return parsed.hostname.toLowerCase() + (parsed.port && !isDefault ? `:${parsed.port}` : '');
        }

        case '@path':
            return new URL(url).pathname;

        case 'content-digest':
            return digest;

        default: {
            // An ordinary header field. Repeated fields join with ", " (§2.1).
            const raw = headers?.[name] ?? headers?.[name.toLowerCase()];
            if (raw === undefined || raw === null) return null;
            return Array.isArray(raw) ? raw.map(v => String(v).trim()).join(', ') : String(raw).trim();
        }
    }
};

/**
 * Serializes the signature parameters as an RFC 8941 inner list with parameters —
 * the value of `Signature-Input` and the final line of the signature base.
 */
const serializeSignatureParams = (components, { created, keyid, nonce, alg }) => {
    const list = components.map(c => `"${c}"`).join(' ');
    return `(${list});created=${created};keyid="${keyid}";nonce="${nonce}";alg="${alg}"`;
};

/**
 * Builds the RFC 9421 signature base.
 *
 * Every line is `"<component>": <value>`, LF-separated, ending with the
 * `@signature-params` line and NO trailing newline (§2.5).
 */
const buildSignatureBase = ({ components, method, url, headers, digest, params }) => {
    const lines = [];

    for (const name of components) {
        const value = componentValue(name, { method, url, headers, digest });

        if (value === null) {
            throw new Error(`HTTP signature: covered component "${name}" is not present on this message`);
        }

        lines.push(`"${name}": ${value}`);
    }

    lines.push(`"@signature-params": ${serializeSignatureParams(components, params)}`);

    return lines.join('\n');
};

/**
 * Signs a request.
 *
 * @returns {{contentDigest: string, signatureInput: string, signature: string, created: number, nonce: string}}
 *   headers the caller attaches verbatim.
 */
const signRequest = ({ method, url, body, workerId, privateJwk, nonce, created = null, components = DEFAULT_COVERED_COMPONENTS }) => {
    const digest = contentDigest(body);
    const createdAt = created ?? Math.floor(Date.now() / 1000);

    const params = { created: createdAt, keyid: workerId, nonce, alg: 'ed25519' };

    const base = buildSignatureBase({
        components,
        method,
        url,
        headers: { 'x-r_sync-worker-id': workerId },
        digest,
        params
    });

    const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });

    // Ed25519 signs the message directly — no separate digest algorithm, hence
    // the null. This is `alg="ed25519"` in RFC 9421's registry.
    const signature = crypto.sign(null, Buffer.from(base, 'utf8'), privateKey).toString('base64');

    return {
        contentDigest: digest,
        signatureInput: `${SIG_LABEL}=${serializeSignatureParams(components, params)}`,
        signature: `${SIG_LABEL}=:${signature}:`,
        created: createdAt,
        nonce
    };
};

/**
 * Parses `Signature-Input` for our label.
 *
 * Deliberately strict — a header we cannot parse unambiguously is refused
 * rather than partially understood, because a verifier that guesses at the
 * covered-component list can be talked into covering less than the signer
 * intended.
 */
const parseSignatureInput = headerValue => {
    if (typeof headerValue !== 'string') return null;

    const match = headerValue.match(/^([A-Za-z0-9_-]+)=\((.*?)\)(.*)$/);
    if (!match) return null;

    const [, label, componentList, paramString] = match;

    const components = componentList.length === 0 ? [] : (componentList.match(/"[^"]*"/g) || []).map(s => s.slice(1, -1));

    if (components.length === 0) return null;

    const params = {};
    const paramRegex = /;([a-z]+)=(?:"([^"]*)"|([0-9]+))/g;
    let m;

    while ((m = paramRegex.exec(paramString)) !== null) {
        params[m[1]] = m[2] !== undefined ? m[2] : Number(m[3]);
    }

    return { label, components, params, raw: `(${componentList})${paramString}` };
};

/** Extracts the base64 signature for our label from the `Signature` header. */
const parseSignature = headerValue => {
    if (typeof headerValue !== 'string') return null;

    const match = headerValue.match(/^([A-Za-z0-9_-]+)=:([A-Za-z0-9+/=]+):$/);
    if (!match) return null;

    return { label: match[1], value: match[2] };
};

/**
 * Verifies a received request signature.
 *
 * @returns {{valid: boolean, reason?: string, params?: object}}
 */
const verifyRequest = ({
    method,
    url,
    headers,
    body,
    publicJwk,
    requiredComponents = DEFAULT_COVERED_COMPONENTS,
    maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
    nowSeconds = null
}) => {
    const input = parseSignatureInput(headers?.['signature-input']);
    if (!input) return { valid: false, reason: 'MALFORMED_SIGNATURE_INPUT' };

    const sig = parseSignature(headers?.['signature']);
    if (!sig) return { valid: false, reason: 'MALFORMED_SIGNATURE' };

    if (sig.label !== input.label) return { valid: false, reason: 'LABEL_MISMATCH' };

    // The signer does not get to choose a weaker covered set than policy demands.
    // Without this, an attacker could re-sign with only "@method" covered and
    // every other part of the request would be unprotected.
    for (const required of requiredComponents) {
        if (!input.components.includes(required)) {
            return { valid: false, reason: `MISSING_COMPONENT:${required}` };
        }
    }

    if (input.params.alg && input.params.alg !== 'ed25519') {
        return { valid: false, reason: 'UNSUPPORTED_ALG' };
    }

    const now = nowSeconds ?? Math.floor(Date.now() / 1000);

    if (typeof input.params.created !== 'number' || Math.abs(now - input.params.created) > maxAgeSeconds) {
        return { valid: false, reason: 'STALE_OR_FUTURE_CREATED' };
    }

    if (typeof input.params.expires === 'number' && now > input.params.expires) {
        return { valid: false, reason: 'EXPIRED' };
    }

    if (!input.params.nonce) return { valid: false, reason: 'MISSING_NONCE' };

    // The digest must describe the body we actually received, or covering
    // "content-digest" in the signature would prove nothing about the payload.
    if (input.components.includes('content-digest')) {
        if (!contentDigestMatches(headers?.['content-digest'], body)) {
            return { valid: false, reason: 'CONTENT_DIGEST_MISMATCH' };
        }
    }

    let base;
    try {
        base = buildSignatureBase({
            components: input.components,
            method,
            url,
            headers,
            digest: headers?.['content-digest'],
            params: {
                created: input.params.created,
                keyid: input.params.keyid,
                nonce: input.params.nonce,
                alg: input.params.alg || 'ed25519'
            }
        });
    } catch (e) {
        return { valid: false, reason: 'UNRESOLVABLE_COMPONENT' };
    }

    let ok = false;
    try {
        const publicKey = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
        ok = crypto.verify(null, Buffer.from(base, 'utf8'), publicKey, Buffer.from(sig.value, 'base64'));
    } catch {
        return { valid: false, reason: 'BAD_KEY' };
    }

    if (!ok) return { valid: false, reason: 'INVALID_SIGNATURE' };

    return { valid: true, params: input.params };
};

export {
    contentDigest,
    contentDigestMatches,
    buildSignatureBase,
    serializeSignatureParams,
    parseSignatureInput,
    parseSignature,
    signRequest,
    verifyRequest,
    DEFAULT_COVERED_COMPONENTS,
    DEFAULT_MAX_AGE_SECONDS,
    SIG_LABEL
};
