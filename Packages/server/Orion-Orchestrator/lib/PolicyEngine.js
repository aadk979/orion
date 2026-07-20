/**
 * PolicyEngine — declarative alert → reaction rules.
 *
 * Every NODE_ALERT (node-emitted or orchestrator-synthesized) flows through
 * here. A rule matches by alert type, then runs its action list through
 * executors injected by the orchestrator. Built-in action types:
 *
 *   { type: 'escalate', severity?, message? }
 *       → EscalationHub.raise (severity defaults to the alert's own)
 *   { type: 'verify-status' }
 *       → issues GET_STATUS to the node; the snapshot is attached to the
 *         escalation context so operators see confirmed state, not hearsay
 *   { type: 'command', action, args? }
 *       → issues a remote command to the alerting node
 *   { type: 'consensus', topic, params?, options? }
 *       → runs a fleet vote; outcome attached to context
 *   { type: 'schedule-command', delaySec, action, args?, onlyIfStatusFlag? }
 *       → delayed remediation: after delaySec, re-checks the node's status and
 *         issues the command only if the named flag is still true. This is how
 *         auto-clear-lockdown style policies are expressed without racing a
 *         human who already fixed it.
 *
 * Per-(rule, node) cooldowns stop alert storms from re-running reactions.
 * Rules never throw into the router: every action failure is captured in the
 * outcome and escalated at warning level if the rule asked for escalation.
 *
 * DEFAULT_POLICIES covers every protocol alert type with observability-first
 * reactions (verify + escalate). Auto-remediation stays opt-in — and node-side
 * safe mode still has the final say on anything mutating.
 */

import { ClusterAlerts } from './protocol.js';

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

const DEFAULT_POLICIES = Object.freeze([
    {
        id: 'ets-lockdown-engaged',
        on: [ClusterAlerts.ETS_LOCKDOWN_ENGAGED],
        cooldownSec: 60,
        actions: [
            { type: 'verify-status' },
            { type: 'escalate', severity: 'critical', message: 'Node entered ETS lockdown — worker-facing traffic on this node is rejected until lifted' }
        ]
    },
    {
        id: 'ets-lockdown-lifted',
        on: [ClusterAlerts.ETS_LOCKDOWN_LIFTED],
        cooldownSec: 0,
        actions: [{ type: 'escalate', severity: 'info', message: 'Node ETS lockdown lifted' }]
    },
    {
        id: 'event-loop-degraded',
        on: [ClusterAlerts.EVENT_LOOP_DEGRADED],
        cooldownSec: 300,
        actions: [
            { type: 'verify-status' },
            { type: 'escalate', severity: 'warning', message: 'Node event loop degraded — request latency on this node is elevated' }
        ]
    },
    {
        id: 'event-loop-recovered',
        on: [ClusterAlerts.EVENT_LOOP_RECOVERED],
        cooldownSec: 0,
        actions: [{ type: 'escalate', severity: 'info', message: 'Node event loop recovered' }]
    },
    {
        id: 'memory-pressure',
        on: [ClusterAlerts.MEMORY_PRESSURE],
        cooldownSec: 300,
        actions: [{ type: 'escalate', severity: 'warning', message: 'Node under memory pressure — approaching the memory monitor kill threshold' }]
    },
    {
        id: 'memory-recovered',
        on: [ClusterAlerts.MEMORY_RECOVERED],
        cooldownSec: 0,
        actions: [{ type: 'escalate', severity: 'info', message: 'Node memory pressure resolved' }]
    },
    {
        id: 'server-lock-changed',
        on: [ClusterAlerts.SERVER_LOCKED, ClusterAlerts.SERVER_UNLOCKED],
        cooldownSec: 0,
        actions: [{ type: 'escalate', message: 'Node server lock state changed' }]
    },
    {
        id: 'tunnel-resynced',
        on: [ClusterAlerts.TUNNEL_RESYNCED],
        cooldownSec: 60,
        actions: [{ type: 'escalate', severity: 'warning', message: 'Node re-registered a desynced tunnel — investigate why session state was lost' }]
    },
    {
        id: 'node-stale',
        on: [ClusterAlerts.NODE_STALE],
        cooldownSec: 60,
        actions: [{ type: 'escalate', severity: 'critical', message: 'Node stopped reporting — transport and application channels are both silent' }]
    },
    {
        id: 'node-recovered',
        on: [ClusterAlerts.NODE_RECOVERED],
        cooldownSec: 0,
        actions: [{ type: 'escalate', severity: 'info', message: 'Node is back online' }]
    }
]);

class PolicyEngine {
    /**
     * @param {Object} executors
     * @param {(escalation) => Promise} executors.escalate
     * @param {(workerId, action, args, timeoutMs?) => Promise} executors.command
     * @param {(topic, params, options) => Promise} executors.consensus
     * @param {Object} [config]
     * @param {boolean} [config.useDefaults=true] - include DEFAULT_POLICIES
     * @param {Array}   [config.rules=[]] - additional rules (evaluated after defaults)
     */
    constructor(executors, config = {}) {
        if (typeof executors?.escalate !== 'function' || typeof executors?.command !== 'function') {
            throw new Error('PolicyEngine requires escalate and command executors');
        }

        this._executors = executors;
        this._rules = [...((config.useDefaults ?? true) ? DEFAULT_POLICIES : []), ...(config.rules || [])];
        this._validateRules();

        this._cooldowns = new Map(); // `${ruleId}::${workerId}` → unix expiry
        this._scheduledTimers = new Set(); // pending schedule-command timers
        this._outcomes = []; // ring of recent rule executions
        this._outcomeLimit = 100;
        this._stopped = false;
    }

    _validateRules() {
        const seen = new Set();
        for (const rule of this._rules) {
            if (!rule.id || seen.has(rule.id)) {
                throw new Error(`PolicyEngine: rules need unique ids (offender: "${rule.id || 'missing'}")`);
            }
            seen.add(rule.id);
            if (!Array.isArray(rule.on) || rule.on.length === 0) {
                throw new Error(`PolicyEngine: rule "${rule.id}" needs a non-empty "on" alert-type list`);
            }
            if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
                throw new Error(`PolicyEngine: rule "${rule.id}" needs a non-empty action list`);
            }
        }
    }

    getRules() {
        return this._rules.map(r => ({ id: r.id, on: [...r.on], cooldownSec: r.cooldownSec ?? 0, actions: r.actions.length }));
    }

    /**
     * Routes one alert through every matching rule. Never throws.
     * @returns {Promise<Array>} outcome per executed rule
     */
    async handleAlert(workerId, alert, node = null) {
        if (this._stopped) return [];
        const now = Math.floor(Date.now() / 1000);
        const outcomes = [];

        for (const rule of this._rules) {
            if (!rule.on.includes(alert?.type)) continue;

            if (rule.minSeverity && SEVERITY_RANK[alert?.severity] < SEVERITY_RANK[rule.minSeverity]) continue;

            const cooldownKey = `${rule.id}::${workerId}`;
            const expiry = this._cooldowns.get(cooldownKey);
            if (expiry && now < expiry) continue;
            if (rule.cooldownSec > 0) this._cooldowns.set(cooldownKey, now + rule.cooldownSec);

            const outcome = await this._runRule(rule, workerId, alert, node);
            outcomes.push(outcome);
        }

        return outcomes;
    }

    async _runRule(rule, workerId, alert, node) {
        const outcome = {
            ruleId: rule.id,
            workerId,
            alertType: alert.type,
            executedAt: Math.floor(Date.now() / 1000),
            actions: [],
            context: {}
        };

        for (const action of rule.actions) {
            try {
                const result = await this._runAction(action, workerId, alert, node, outcome.context);
                outcome.actions.push({ type: action.type, ok: true, result });
            } catch (err) {
                outcome.actions.push({ type: action.type, ok: false, error: err.message });
            }
        }

        this._outcomes.push(outcome);
        if (this._outcomes.length > this._outcomeLimit) {
            this._outcomes.splice(0, this._outcomes.length - this._outcomeLimit);
        }

        return outcome;
    }

    async _runAction(action, workerId, alert, node, context) {
        switch (action.type) {
            case 'escalate':
                return this._executors.escalate({
                    type: alert.type,
                    severity: action.severity || alert.severity || 'info',
                    message: action.message || `Alert ${alert.type} from ${workerId}`,
                    workerId,
                    details: {
                        alert: alert.details || {},
                        appName: node?.hello?.appName || null,
                        serviceID: node?.hello?.serviceID || null,
                        ...context
                    }
                });

            case 'verify-status': {
                const verification = await this._executors.command(workerId, 'status:get', {});
                context.verifiedStatus = verification?.result || null;
                return { verified: verification?.ok === true };
            }

            case 'command':
                return this._executors.command(workerId, action.action, action.args || {});

            case 'consensus': {
                if (typeof this._executors.consensus !== 'function') {
                    throw new Error('No consensus executor configured');
                }
                const outcome = await this._executors.consensus(action.topic, action.params || {}, action.options || {});
                context.consensus = {
                    topic: outcome.topic,
                    decided: outcome.decided,
                    accepted: outcome.accepted,
                    ratio: outcome.ratio
                };
                return context.consensus;
            }

            case 'schedule-command':
                return this._scheduleCommand(action, workerId);

            default:
                throw new Error(`Unknown policy action type "${action.type}"`);
        }
    }

    _scheduleCommand(action, workerId) {
        if (!action.delaySec || !action.action) {
            throw new Error('schedule-command needs delaySec and action');
        }

        const timer = setTimeout(async () => {
            this._scheduledTimers.delete(timer);
            if (this._stopped) return;

            try {
                // Re-check before firing — the condition may have resolved itself
                // (or an operator beat us to it).
                if (action.onlyIfStatusFlag) {
                    const check = await this._executors.command(workerId, 'status:get', {});
                    if (check?.ok !== true || check.result?.[action.onlyIfStatusFlag] !== true) {
                        return;
                    }
                }
                await this._executors.command(workerId, action.action, action.args || {});
            } catch (err) {
                await this._executors
                    .escalate({
                        type: 'policy:scheduled-command-failed',
                        severity: 'warning',
                        message: `Scheduled command ${action.action} on ${workerId} failed: ${err.message}`,
                        workerId,
                        details: { action }
                    })
                    .catch(() => {});
            }
        }, action.delaySec * 1000);

        this._scheduledTimers.add(timer);
        return { scheduled: true, delaySec: action.delaySec, action: action.action };
    }

    getOutcomes(limit = 20) {
        return this._outcomes.slice(-limit);
    }

    /** Cancels scheduled remediations and stops accepting alerts. */
    stop() {
        this._stopped = true;
        for (const timer of this._scheduledTimers) clearTimeout(timer);
        this._scheduledTimers.clear();
    }
}

export { PolicyEngine, DEFAULT_POLICIES };
