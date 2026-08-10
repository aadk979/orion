/**
 * Cover for resolveClientContext — the shared WebAuthn origin/RP-ID resolver.
 *
 * Two defects it replaces, at four call sites:
 *   - the RP ID was `new URL(x).host`, which carries the port. A WebAuthn RP ID
 *     is a registrable domain, so any deployment on a non-default port produced
 *     an RP ID no authenticator would match.
 *   - `new URL(request.get('Origin'))` was unguarded, so a request without the
 *     header threw inside a route handler and surfaced as a 500.
 */
import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveClientContext } from '../../../../Packages/server/Orion-core/lib/Utils/Parsers.js';

/** Minimal Express-request stand-in: only `.get()` is consulted. */
const requestWith = headers => ({
    get: name => headers[name] ?? headers[name.toLowerCase()]
});

describe('resolveClientContext', () => {
    test('drops the port from the RP ID', () => {
        const ctx = resolveClientContext(requestWith({ Origin: 'https://app.example.com:8443' }));

        assert.equal(ctx.rpId, 'app.example.com', 'a port in the RP ID matches no authenticator');
        assert.equal(ctx.origin, 'https://app.example.com:8443', 'the expected ORIGIN keeps its port');
    });

    test('is a no-op for a standard :443 deployment', () => {
        // The compatibility claim behind shipping this: where things already
        // work, nothing changes and no credential is invalidated.
        const ctx = resolveClientContext(requestWith({ Origin: 'https://app.example.com' }));

        assert.equal(ctx.rpId, 'app.example.com');
        assert.equal(ctx.origin, 'https://app.example.com');
    });

    test('strips the path when only a Referer is available', () => {
        // Referer carries a full URL; the old split('//') form kept the path in
        // the RP ID.
        const ctx = resolveClientContext(requestWith({ Referer: 'https://app.example.com/account/security' }));

        assert.equal(ctx.rpId, 'app.example.com');
        assert.equal(ctx.origin, 'https://app.example.com');
    });

    test('prefers Origin over Referer', () => {
        const ctx = resolveClientContext(
            requestWith({ Origin: 'https://app.example.com', Referer: 'https://evil.example.net/x' })
        );

        assert.equal(ctx.rpId, 'app.example.com');
    });

    test('returns null instead of throwing when no origin is present', () => {
        assert.equal(resolveClientContext(requestWith({})), null);
    });

    test('returns null for an unparseable origin', () => {
        assert.equal(resolveClientContext(requestWith({ Origin: 'not a url' })), null);
        assert.equal(resolveClientContext(requestWith({ Origin: '' })), null);
    });

    test('lowercases the host the way the URL parser does', () => {
        const ctx = resolveClientContext(requestWith({ Origin: 'https://APP.Example.COM' }));

        assert.equal(ctx.rpId, 'app.example.com');
    });
});
