import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { AdminMailer } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/AdminMailer.js';

/**
 * AdminMailer — magic-link delivery.
 *
 * Two properties matter here and neither is about email formatting:
 *
 *   1. console mode must be entered on ABSENCE of config, not on an explicit
 *      opt-in. A deployment that forgot its mail block should log the link and
 *      keep working, and — more importantly — a deployment that HAS a mail
 *      block must never silently fall back to printing sign-in links to stdout.
 *   2. the transport options handed to nodemailer must match the config shape
 *      the deployment guide documents, because a wrong port or a missing
 *      `secure` sends admin sign-in links over cleartext.
 *
 * nodemailer's Mail object exposes the resolved options verbatim, so the second
 * property is checkable without opening a socket.
 */

const captureSends = mailer => {
    const sent = [];
    mailer.transporter = {
        async sendMail(message) {
            sent.push(message);
            return { messageId: 'test' };
        }
    };
    return sent;
};

const LINK = { link: 'https://orch.example.com/login?code=abc', code: 'abc', ttlMinutes: 10 };

describe('AdminMailer — mode selection', () => {
    test('no config at all means console mode', () => {
        assert.equal(new AdminMailer().consoleMode, true);
        assert.equal(new AdminMailer({}).consoleMode, true);
    });

    test('console mode constructs no transport', () => {
        assert.equal(new AdminMailer({}).transporter, undefined);
    });

    test('an appName alone does not count as mail config', () => {
        // Only `email` or `host` mean "there is somewhere to send this".
        assert.equal(new AdminMailer({ appName: 'Acme Control' }).consoleMode, true);
    });

    test('either an email or a host leaves console mode', () => {
        assert.equal(new AdminMailer({ service: 'gmail', email: 'ops@acme.com', password: 'x' }).consoleMode, false);
        assert.equal(new AdminMailer({ host: 'smtp.acme.com' }).consoleMode, false);
    });

    test('appName defaults but is overridable', () => {
        assert.equal(new AdminMailer({}).appName, 'Orion Orchestrator');
        assert.equal(new AdminMailer({ appName: 'Acme Control' }).appName, 'Acme Control');
    });
});

describe('AdminMailer — transport options', () => {
    test('the service shorthand passes service + auth straight through', () => {
        const mailer = new AdminMailer({ service: 'gmail', email: 'ops@acme.com', password: 'app-password' });

        assert.deepEqual(mailer.transporter.options, {
            service: 'gmail',
            auth: { user: 'ops@acme.com', pass: 'app-password' }
        });
    });

    test('explicit SMTP defaults to port 587 and non-implicit TLS', () => {
        const mailer = new AdminMailer({ host: 'smtp.acme.com', email: 'ops@acme.com', password: 'x' });

        assert.equal(mailer.transporter.options.host, 'smtp.acme.com');
        assert.equal(mailer.transporter.options.port, 587);
        // 587 is STARTTLS, so `secure` (implicit TLS) is correctly false here —
        // it is not "no encryption", and flipping it on for 587 breaks delivery.
        assert.equal(mailer.transporter.options.secure, false);
    });

    test('secure is only honoured when it is exactly true', () => {
        assert.equal(new AdminMailer({ host: 'h', secure: true }).transporter.options.secure, true);
        // A truthy-but-not-true value (e.g. the string "false" out of an env
        // var) must not be read as "encrypted".
        assert.equal(new AdminMailer({ host: 'h', secure: 'false' }).transporter.options.secure, false);
        assert.equal(new AdminMailer({ host: 'h', secure: 1 }).transporter.options.secure, false);
    });

    test('an unauthenticated relay omits auth rather than sending undefined credentials', () => {
        const mailer = new AdminMailer({ host: 'relay.internal', port: 25 });

        assert.equal(mailer.transporter.options.auth, undefined);
        assert.equal(mailer.transporter.options.port, 25);
    });
});

describe('AdminMailer — sendMagicLink', () => {
    test('console mode reports its mode and opens no connection', async () => {
        const mailer = new AdminMailer({});

        const result = await mailer.sendMagicLink('admin@orion.local', LINK);

        assert.deepEqual(result, { sent: true, mode: 'console' });
        assert.equal(mailer.transporter, undefined, 'console mode must not lazily create a transport');
    });

    test('SMTP mode sends exactly one message and reports mode smtp', async () => {
        const mailer = new AdminMailer({ host: 'smtp.acme.com', email: 'ops@acme.com', password: 'x' });
        const sent = captureSends(mailer);

        const result = await mailer.sendMagicLink('admin@orion.local', LINK);

        assert.deepEqual(result, { sent: true, mode: 'smtp' });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].to, 'admin@orion.local');
    });

    test('the From address prefers an explicit from over the auth identity', async () => {
        const explicit = new AdminMailer({ host: 'h', email: 'ops@acme.com', from: 'no-reply@acme.com' });
        const explicitSent = captureSends(explicit);
        await explicit.sendMagicLink('a@b.c', LINK);
        assert.equal(explicitSent[0].from, 'no-reply@acme.com');

        const implied = new AdminMailer({ host: 'h', email: 'ops@acme.com' });
        const impliedSent = captureSends(implied);
        await implied.sendMagicLink('a@b.c', LINK);
        assert.equal(impliedSent[0].from, 'ops@acme.com');
    });

    test('the subject and body are branded with the configured app name', async () => {
        const mailer = new AdminMailer({ host: 'h', email: 'ops@acme.com', appName: 'Acme Control' });
        const sent = captureSends(mailer);

        await mailer.sendMagicLink('admin@acme.com', LINK);

        assert.equal(sent[0].subject, 'Acme Control — your sign-in link');
        assert.match(sent[0].text, /Acme Control control panel/);
    });

    test('the body carries the link, the CLI code and the TTL', async () => {
        const mailer = new AdminMailer({ host: 'h', email: 'ops@acme.com' });
        const sent = captureSends(mailer);

        await mailer.sendMagicLink('admin@orion.local', LINK);

        const { text } = sent[0];
        assert.match(text, /https:\/\/orch\.example\.com\/login\?code=abc/);
        assert.match(text, /valid for 10 minutes, single use/);
        assert.match(text, /^abc$/m, 'the CLI code must stand alone on its own line to be copyable');
        assert.match(text, /admin@orion\.local/, 'the recipient is named so a misdirected link is obvious');
    });

    test('the body tells an unexpecting recipient that the link alone is not enough', async () => {
        const mailer = new AdminMailer({ host: 'h', email: 'ops@acme.com' });
        const sent = captureSends(mailer);

        await mailer.sendMagicLink('admin@orion.local', LINK);

        // The link is only the first factor; saying so stops a recipient
        // panicking — and stops them treating the mail as a full compromise.
        assert.match(sent[0].text, /only works together with your authenticator code/);
    });

    test('a transport failure propagates rather than reporting a false success', async () => {
        const mailer = new AdminMailer({ host: 'h', email: 'ops@acme.com' });
        mailer.transporter = {
            async sendMail() {
                throw new Error('EAUTH: invalid credentials');
            }
        };

        // The caller (requestMagicLink) needs to know delivery failed; a
        // swallowed error would leave an admin waiting for a mail that never
        // comes while the API reported success.
        await assert.rejects(() => mailer.sendMagicLink('a@b.c', LINK), /EAUTH/);
    });

    test('the message body is plain text only — no HTML part to render a spoofed link', async () => {
        const mailer = new AdminMailer({ host: 'h', email: 'ops@acme.com' });
        const sent = captureSends(mailer);

        await mailer.sendMagicLink('a@b.c', LINK);

        assert.equal(sent[0].html, undefined);
        assert.deepEqual(Object.keys(sent[0]).sort(), ['from', 'subject', 'text', 'to']);
    });
});
