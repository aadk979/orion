/**
 * EscalationHub — where cluster problems become notifications.
 *
 * Every escalation flows through here: policy-engine verdicts, cluster health
 * transitions, stale nodes. Channels are pluggable — the built-in `log` channel
 * always runs; a `webhook` channel (generic JSON POST with retry) can be
 * enabled via config; applications add their own with addChannel() (PagerDuty,
 * Slack, SMS — whatever the deployment uses).
 *
 * The hub never throws into its caller and keeps a ring-buffer history so
 * operators can audit what was raised even if a channel was down.
 */

import { logger } from 'r-sync';

const HISTORY_LIMIT = 200;
const WEBHOOK_RETRIES = 3;
const WEBHOOK_RETRY_BASE_MS = 1_000;
const WEBHOOK_TIMEOUT_MS = 10_000;

class EscalationHub {
    /**
     * @param {Object} config
     * @param {{url: string, headers?: Object}} [config.webhook] - enable the webhook channel
     */
    constructor(config = {}) {
        this._channels = new Map();
        this._history = [];
        this._counts = { info: 0, warning: 0, critical: 0 };

        // Built-in: structured log line (always on)
        this.addChannel('log', escalation => {
            const line = `ESCALATION [${escalation.severity}] ${escalation.type}: ${escalation.message}`;
            if (escalation.severity === 'critical') logger.error(line);
            else if (escalation.severity === 'warning') logger.warn(line);
            else logger.info(line);
        });

        if (config.webhook?.url) {
            this._webhookConfig = config.webhook;
            this.addChannel('webhook', escalation => this._deliverWebhook(escalation));
        }
    }

    addChannel(name, handler) {
        if (typeof handler !== 'function') {
            throw new Error(`EscalationHub: channel "${name}" handler must be a function`);
        }
        this._channels.set(name, handler);
        return this;
    }

    removeChannel(name) {
        return this._channels.delete(name);
    }

    /**
     * Raises an escalation to every channel. Channel failures are logged and
     * swallowed — an alerting outage must never break the control plane.
     *
     * @param {Object} escalation - { type, severity, message, workerId?, details? }
     */
    async raise(escalation) {
        const record = {
            type: escalation.type || 'unknown',
            severity: ['info', 'warning', 'critical'].includes(escalation.severity) ? escalation.severity : 'info',
            message: escalation.message || '',
            workerId: escalation.workerId || null,
            details: escalation.details || {},
            raisedAt: Math.floor(Date.now() / 1000)
        };

        this._history.push(record);
        if (this._history.length > HISTORY_LIMIT) {
            this._history.splice(0, this._history.length - HISTORY_LIMIT);
        }
        this._counts[record.severity] += 1;

        await Promise.all(
            [...this._channels.entries()].map(async ([name, handler]) => {
                try {
                    await handler(record);
                } catch (err) {
                    logger.error(`EscalationHub: channel "${name}" failed — ${err.message}`);
                }
            })
        );

        return record;
    }

    async _deliverWebhook(escalation) {
        const { url, headers = {} } = this._webhookConfig;
        let lastError = null;

        for (let attempt = 1; attempt <= WEBHOOK_RETRIES; attempt++) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...headers },
                    body: JSON.stringify({ source: 'orion-orch', escalation }),
                    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
                });
                if (response.ok) return;
                lastError = new Error(`HTTP ${response.status}`);
            } catch (err) {
                lastError = err;
            }
            if (attempt < WEBHOOK_RETRIES) {
                await new Promise(r => setTimeout(r, WEBHOOK_RETRY_BASE_MS * 2 ** (attempt - 1)));
            }
        }

        throw new Error(`webhook delivery failed after ${WEBHOOK_RETRIES} attempts: ${lastError?.message}`);
    }

    getHistory(limit = 50) {
        return this._history.slice(-limit);
    }

    getCounts() {
        return { ...this._counts };
    }
}

export { EscalationHub, HISTORY_LIMIT };
