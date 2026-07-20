/**
 * AdminMailer — magic-link delivery for the system-admin plane.
 *
 * Config mirrors Orion-core's mail block:
 *   { service, email, password }         — well-known provider shorthand
 * or { host, port, secure, email, password } — explicit SMTP.
 *
 * With no mail config the mailer runs in console mode: the link is logged to
 * the orchestrator's stdout instead of emailed. That keeps local/dev clusters
 * usable, and the raw token still never touches the database.
 */

import nodemailer from 'nodemailer';
import { logger } from 'r-sync';

class AdminMailer {
    constructor(config = {}) {
        this.config = config;
        this.appName = config.appName || 'Orion Orchestrator';
        this.consoleMode = !config.email && !config.host;

        if (!this.consoleMode) {
            this.transporter = nodemailer.createTransport(
                config.service
                    ? { service: config.service, auth: { user: config.email, pass: config.password } }
                    : {
                          host: config.host,
                          port: config.port || 587,
                          secure: config.secure === true,
                          auth: config.email ? { user: config.email, pass: config.password } : undefined
                      }
            );
        }
    }

    async sendMagicLink(to, { link, code, ttlMinutes }) {
        const subject = `${this.appName} — your sign-in link`;
        const text = [
            `A sign-in was requested for ${to} on the ${this.appName} control panel.`,
            '',
            `Sign in (valid for ${ttlMinutes} minutes, single use):`,
            link,
            '',
            `Using the CLI? Enter this code instead:`,
            code,
            '',
            'If you did not request this, ignore this email — the link expires on its own',
            'and only works together with your authenticator code.'
        ].join('\n');

        if (this.consoleMode) {
            logger.warn(`AdminMailer (console mode — no mail config): magic link for ${to}: ${link} (code: ${code})`);
            return { sent: true, mode: 'console' };
        }

        await this.transporter.sendMail({
            from: this.config.from || this.config.email,
            to,
            subject,
            text
        });
        return { sent: true, mode: 'smtp' };
    }
}

export { AdminMailer };
