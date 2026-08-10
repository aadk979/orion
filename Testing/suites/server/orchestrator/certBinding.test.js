/**
 * RFC 8705 certificate-bound admin sessions.
 *
 * The thumbprint is computed from a real TLS handshake rather than a fixture,
 * because the whole control depends on `getPeerCertificate().raw` being the DER
 * the client actually presented — a detail no unit-level mock would catch if it
 * were wrong.
 */
import '../../../helpers/bootstrap.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';

import { thumbprintFromDer, thumbprintFromSocket, thumbprintsMatch, evaluateCertBinding } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/certBinding.js';

/**
 * Minimal self-signed cert/key pair.
 *
 * Generated with the `selfsigned`-style approach using Node's own X509 support
 * is not possible without a CSR API, so this uses a fixed, throwaway pair
 * created at test time via a child openssl call when available. When openssl is
 * unavailable the TLS test is skipped rather than failing the suite on an
 * environment difference.
 */
const makeSelfSigned = () => {
    const { execFileSync } = require('node:child_process');
    const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
    const { tmpdir } = require('node:os');
    const { join } = require('node:path');

    const dir = mkdtempSync(join(tmpdir(), 'orion-mtls-'));

    try {
        execFileSync(
            'openssl',
            [
                'req',
                '-x509',
                '-newkey',
                'rsa:2048',
                '-keyout',
                join(dir, 'key.pem'),
                '-out',
                join(dir, 'cert.pem'),
                '-days',
                '1',
                '-nodes',
                '-subj',
                '/CN=orion-test'
            ],
            {
                stdio: 'ignore',
                // A stale OPENSSL_CONF inherited from the environment (some
                // Windows installs point it at a PostgreSQL path that no longer
                // exists) makes every openssl invocation fail. Neutralise it so
                // this test exercises the binding rather than the host's setup.
                env: { ...process.env, OPENSSL_CONF: process.platform === 'win32' ? 'NUL' : '/dev/null' }
            }
        );

        return {
            key: readFileSync(join(dir, 'key.pem')),
            cert: readFileSync(join(dir, 'cert.pem')),
            cleanup: () => rmSync(dir, { recursive: true, force: true })
        };
    } catch {
        rmSync(dir, { recursive: true, force: true });
        return null;
    }
};

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);

test('MTLS-001: the binding decision is fail-closed', async t => {
    await t.test('binding off is a no-op', () => {
        assert.deepEqual(evaluateCertBinding({ bindingRequired: false, sessionThumbprint: null, presentedThumbprint: null }), { ok: true });
    });

    await t.test('a pre-binding session cannot be used once binding is required', () => {
        // Otherwise every token minted before the switch keeps working as a
        // plain bearer credential — the exact hole this closes.
        const verdict = evaluateCertBinding({ bindingRequired: true, sessionThumbprint: null, presentedThumbprint: 'abc' });

        assert.equal(verdict.ok, false);
        assert.equal(verdict.reason, 'SESSION_NOT_BOUND');
    });

    await t.test('a bound session presented without a certificate is refused', () => {
        const verdict = evaluateCertBinding({ bindingRequired: true, sessionThumbprint: 'abc', presentedThumbprint: null });

        assert.equal(verdict.ok, false);
        assert.equal(verdict.reason, 'NO_CLIENT_CERTIFICATE');
    });

    await t.test('a stolen token presented with a DIFFERENT certificate is refused', () => {
        const verdict = evaluateCertBinding({ bindingRequired: true, sessionThumbprint: 'abc', presentedThumbprint: 'xyz' });

        assert.equal(verdict.ok, false);
        assert.equal(verdict.reason, 'CERTIFICATE_MISMATCH');
    });

    await t.test('the matching certificate is accepted', () => {
        assert.deepEqual(evaluateCertBinding({ bindingRequired: true, sessionThumbprint: 'abc', presentedThumbprint: 'abc' }), { ok: true });
    });

    await t.test('thumbprint comparison rejects non-strings and length mismatches', () => {
        assert.equal(thumbprintsMatch('a', 'a'), true);
        assert.equal(thumbprintsMatch('a', 'ab'), false);
        assert.equal(thumbprintsMatch(null, 'a'), false);
        assert.equal(thumbprintsMatch(undefined, undefined), false);
    });
});

test('MTLS-002: the thumbprint is the RFC 8705 x5t#S256 of the presented DER', async t => {
    const pair = makeSelfSigned();

    if (!pair) {
        t.skip('openssl unavailable — cannot generate a client certificate in this environment');
        return;
    }

    t.after(() => pair.cleanup());

    const x509 = new X509Certificate(pair.cert);
    const expected = crypto.createHash('sha256').update(x509.raw).digest('base64url');

    await t.test('thumbprintFromDer matches an independent computation', () => {
        assert.equal(thumbprintFromDer(x509.raw), expected);
        assert.match(expected, /^[A-Za-z0-9_-]{43}$/, 'base64url SHA-256 is 43 chars unpadded');
    });

    await t.test('a real mTLS handshake yields the same thumbprint server-side', async () => {
        const server = tls.createServer({ key: pair.key, cert: pair.cert, requestCert: true, rejectUnauthorized: false }, socket => {
            socket.end(thumbprintFromSocket(socket) || 'NONE');
        });

        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        t.after(() => server.close());

        const observed = await new Promise((resolve, reject) => {
            const socket = tls.connect(
                { port: server.address().port, host: '127.0.0.1', key: pair.key, cert: pair.cert, rejectUnauthorized: false },
                () => {}
            );
            let data = '';
            socket.on('data', c => (data += c));
            socket.on('end', () => resolve(data));
            socket.on('error', reject);
        });

        assert.equal(observed, expected, 'the server must derive the same x5t#S256 the client presented');
    });

    await t.test('a client that presents NO certificate yields null, not a bogus thumbprint', async () => {
        const server = tls.createServer({ key: pair.key, cert: pair.cert, requestCert: true, rejectUnauthorized: false }, socket => {
            const tp = thumbprintFromSocket(socket);
            socket.end(tp === null ? 'NULL' : tp);
        });

        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        t.after(() => server.close());

        const observed = await new Promise((resolve, reject) => {
            const socket = tls.connect({ port: server.address().port, host: '127.0.0.1', rejectUnauthorized: false }, () => {});
            let data = '';
            socket.on('data', c => (data += c));
            socket.on('end', () => resolve(data));
            socket.on('error', reject);
        });

        assert.equal(observed, 'NULL', '"no certificate" must be distinguishable from "certificate that does not match"');
    });

    await t.test('a different certificate produces a different thumbprint', () => {
        const other = makeSelfSigned();

        if (!other) return;

        try {
            const otherTp = thumbprintFromDer(new X509Certificate(other.cert).raw);
            assert.notEqual(otherTp, expected);
        } finally {
            other.cleanup();
        }
    });
});
