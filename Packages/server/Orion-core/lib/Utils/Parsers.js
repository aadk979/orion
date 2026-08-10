import { globalAccessPoint } from './GlobalAccessPoint.js';

function slugParser(path) {
    const slug = globalAccessPoint.apiSlug();

    if (slug === '') {
        return path;
    }

    const slugPattern = new RegExp(`^/${slug}(/|$)`);
    if (slugPattern.test(path)) {
        return path.replace(slugPattern, '/');
    }

    return path;
}

/**
 * Resolves the WebAuthn client context for a request: the expected origin, and
 * the Relying Party ID to check an assertion against.
 *
 * TWO THINGS THIS FIXES
 *
 * 1. The RP ID is the HOSTNAME, never `host`. Every call site used
 *    `new URL(x).host` (or a `split('//')` equivalent), which carries the port —
 *    and a WebAuthn RP ID is a registrable domain, so a deployment on any
 *    non-default port produced an RP ID no authenticator would ever match. On a
 *    :443 deployment host and hostname are identical, so nothing that currently
 *    works changes.
 *
 * 2. It cannot throw. The call sites did `new URL(request.get('Origin'))` with
 *    no guard: `new URL(undefined)` throws, which turned a missing header into
 *    an uncaught 500 inside a route handler. originVerifier makes Origin
 *    mandatory today, so this was unreachable — but that is an ordering
 *    dependency between two files, not a guard. Callers get null and answer
 *    with a proper error code.
 *
 * @param {object} request Express request
 * @returns {{ origin: string, rpId: string } | null} null when no usable origin
 */
function resolveClientContext(request) {
    const raw = request.get('Origin') || request.get('Referer');

    if (!raw) return null;

    try {
        const parsed = new URL(raw);

        // Referer carries a path; the expected origin never should.
        return { origin: parsed.origin, rpId: parsed.hostname };
    } catch {
        return null;
    }
}

export { slugParser, resolveClientContext };
