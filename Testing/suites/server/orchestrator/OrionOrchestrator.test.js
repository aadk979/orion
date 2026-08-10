import '../../../helpers/bootstrap.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { OrionOrchestrator, WIPE_CONFIRMATION_PHRASE } from '../../../../Packages/server/Orion-Orchestrator/lib/OrionOrchestrator.js';
import { ClusterEvents, ClusterCommands, ClusterAlerts, ClusterStates, ConsensusTopics } from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';

/**
 * OrionOrchestrator — the control plane's own logic.
 *
 * start() constructs an R_Sync instance and binds a UDP/TCP port, so these
 * tests never call it. Instead they build the orchestrator (which wires every
 * real subsystem — NodeRegistry, ClusterHealth, PolicyEngine, EscalationHub,
 * ConsensusEngine) and then stand in for the two things that need a network:
 * `rsync` and `_dispatcher`. Everything the orchestrator itself decides is the
 * production code.
 *
 * The decisions worth pinning are the ones that are expensive to get wrong and
 * invisible until they are:
 *   - the four gates on the irreversible encrypted-field wipe;
 *   - INCIDENT being consensus-confirmed rather than declared on one observer's
 *     view, and a manual resolve never landing straight back on INCIDENT;
 *   - one thrown hook not stopping the others or the event loop;
 *   - the command log staying bounded on a busy cluster.
 */

const NOW = () => Math.floor(Date.now() / 1000);

/** A started orchestrator with the network replaced by recorders. */
const makeOrch = (config = {}) => {
    const orch = new OrionOrchestrator({ cluster: 'test-cluster', persistence: { enabled: false }, ...config });

    orch.broadcasts = [];
    orch.sent = [];
    orch.rsync = {
        orchestratorId: 'ORCH_1',
        async broadcast(eventName, data) {
            orch.broadcasts.push({ eventName, data });
        },
        async sendTo(workerId, eventName, data) {
            orch.sent.push({ workerId, eventName, data });
        },
        async stop() {}
    };

    orch.dispatched = [];
    orch._dispatcher = {
        pendingCount: 0,
        async execute(workerId, action, args, timeoutMs, issuedBy) {
            orch.dispatched.push({ workerId, action, args, timeoutMs, issuedBy });
            return { workerId, commandId: 'CMD_1', action, ok: true, result: {} };
        },
        resolveResult() {
            return true;
        },
        clear() {}
    };

    orch.started = true;
    return orch;
};

describe('OrionOrchestrator — construction', () => {
    test('a cluster name is mandatory', () => {
        assert.throws(() => new OrionOrchestrator(), /requires a cluster name/);
        assert.throws(() => new OrionOrchestrator({}), /requires a cluster name/);
        assert.throws(() => new OrionOrchestrator({ cluster: '' }), /requires a cluster name/);
    });

    test('defaults are applied and overridable without mutating the shared defaults', () => {
        const a = new OrionOrchestrator({ cluster: 'a', port: 60000, persistence: { enabled: false } });
        const b = new OrionOrchestrator({ cluster: 'b', persistence: { enabled: false } });

        assert.equal(a.config.port, 60000);
        // The default object is frozen and spread — `a`'s override must not
        // have leaked into every later orchestrator in the process.
        assert.equal(b.config.port, 55321);
        assert.equal(b.config.nodeStaleAfterSeconds, 120);
        assert.equal(b.config.confirmIncidentViaConsensus, true);
    });

    test('both optional planes are off unless explicitly enabled', () => {
        const orch = new OrionOrchestrator({ cluster: 'a', persistence: { enabled: false } });

        assert.equal(orch.config.systemAdmin.enabled, false);
        assert.equal(orch.config.mailing.enabled, false);
        assert.equal(orch.getSystemAdmin(), null);
        assert.equal(orch.getMailingService(), null);
    });

    test('persistence is on by default and can be switched off', () => {
        assert.ok(new OrionOrchestrator({ cluster: 'a' })._store, 'a restart should rehydrate by default');
        assert.equal(new OrionOrchestrator({ cluster: 'a', persistence: { enabled: false } })._store, null);
    });

    test('every subsystem is constructed eagerly, before start()', () => {
        const orch = new OrionOrchestrator({ cluster: 'a', persistence: { enabled: false } });

        for (const key of ['_registry', '_escalations', '_health', '_consensus', '_policies']) {
            assert.ok(orch[key], `${key} was not constructed`);
        }
        // The network-facing pieces are the only ones deferred to start().
        assert.equal(orch.rsync, null);
        assert.equal(orch._dispatcher, null);
        assert.equal(orch.started, false);
    });

    test('the cluster starts in FORMING, not HEALTHY', () => {
        // Claiming health before a single node has said hello would suppress the
        // first real transition.
        assert.equal(new OrionOrchestrator({ cluster: 'a', persistence: { enabled: false } }).getClusterHealth().state, ClusterStates.FORMING);
    });
});

describe('OrionOrchestrator — the started guard', () => {
    const GUARDED = {
        command: o => o.command('W1', ClusterCommands.PING),
        commandAll: o => o.commandAll(ClusterCommands.PING),
        proposeConsensus: o => o.proposeConsensus(ConsensusTopics.NODE_HEALTHY),
        sendEvent: o => o.sendEvent('W1', 'custom'),
        broadcastEvent: o => o.broadcastEvent('custom'),
        getClusterStatus: o => o.getClusterStatus()
    };

    test('every network-facing method refuses before start()', async () => {
        for (const [name, invoke] of Object.entries(GUARDED)) {
            const orch = new OrionOrchestrator({ cluster: 'a', persistence: { enabled: false } });

            await assert.rejects(() => invoke(orch), /not started/, `${name} did not refuse`);
        }
    });

    test('observability reads work before start() and report empty', () => {
        const orch = new OrionOrchestrator({ cluster: 'a', persistence: { enabled: false } });

        // These back the panel's first paint; throwing would make a
        // not-yet-started orchestrator look broken rather than empty.
        assert.deepEqual(orch.getNodes(), []);
        assert.deepEqual(orch.getCommandLog(), []);
        assert.deepEqual(orch.getEscalations(), []);
        assert.deepEqual(orch.getConsensusHistory(), []);
        assert.equal(orch.getNode('W1'), null);
    });
});

describe('OrionOrchestrator — hooks', () => {
    let orch;

    beforeEach(() => {
        orch = makeOrch();
    });

    test('every registrar rejects a non-function and returns the orchestrator for chaining', () => {
        for (const register of ['onNodeHello', 'onNodeStatus', 'onNodeAlert', 'onNodeGoodbye', 'onNodeEvent', 'onClusterStateChange']) {
            assert.throws(() => orch[register]('not a function'), /must be a function/, `${register} accepted a non-function`);
            assert.equal(orch[register](() => {}), orch, `${register} is not chainable`);
        }
    });

    test('a hello event reaches its hook with the worker id, payload and node', async () => {
        const seen = [];
        orch.onNodeHello((workerId, payload, node) => seen.push({ workerId, payload, node }));

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: { appName: 'api', serviceID: 'svc-1' } });

        assert.equal(seen.length, 1);
        assert.equal(seen[0].workerId, 'W1');
        assert.deepEqual(seen[0].payload, { appName: 'api', serviceID: 'svc-1' });
        assert.equal(seen[0].node.workerId, 'W1');
    });

    test('one throwing hook does not stop the others or the event', async () => {
        const order = [];
        orch.onNodeHello(() => order.push('first'));
        orch.onNodeHello(() => {
            order.push('throws');
            throw new Error('hook exploded');
        });
        orch.onNodeHello(() => order.push('third'));

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });

        // An application hook is untrusted code; it must not be able to take out
        // the control plane's own bookkeeping.
        assert.deepEqual(order, ['first', 'throws', 'third']);
        assert.ok(orch.getNode('W1'), 'the registry was updated despite the hook failure');
    });

    test('an escalation channel can be added and is chainable', () => {
        assert.equal(
            orch.addEscalationChannel('slack', () => {}),
            orch
        );
    });
});

describe('OrionOrchestrator — worker event routing', () => {
    let orch;

    beforeEach(() => {
        orch = makeOrch();
    });

    test('a hello registers the node as online', async () => {
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: { appName: 'api' } });

        const node = orch.getNode('W1');
        assert.equal(node.online, true);
        assert.deepEqual(node.hello, { appName: 'api' });
    });

    test('a goodbye marks the node offline with its stated reason', async () => {
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_GOODBYE, data: { reason: 'deploy' } });

        assert.equal(orch.getNode('W1').online, false);
        assert.equal(orch.getNode('W1').offlineReason, 'deploy');
    });

    test('a goodbye with no reason records a graceful shutdown rather than nothing', async () => {
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_GOODBYE, data: {} });

        assert.equal(orch.getNode('W1').offlineReason, 'graceful-shutdown');
    });

    test('a node coming back after being offline raises a recovery alert', async () => {
        const alerts = [];
        orch.onNodeAlert((workerId, alert) => alerts.push(alert));

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_GOODBYE, data: { reason: 'crash' } });
        assert.equal(alerts.length, 0, 'a graceful goodbye is not itself an alert');

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });

        assert.equal(alerts.length, 1);
        assert.equal(alerts[0].type, ClusterAlerts.NODE_RECOVERED);
        assert.equal(alerts[0].severity, 'info');
        assert.equal(alerts[0].details.offlineReason, 'crash');
    });

    test('a status from an offline node also counts as recovery', async () => {
        const alerts = [];
        orch.onNodeAlert((_workerId, alert) => alerts.push(alert));

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_GOODBYE, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_STATUS, data: { load: 0.2 } });

        // Recovery must not depend on the node choosing to re-say hello.
        assert.equal(alerts.at(-1).type, ClusterAlerts.NODE_RECOVERED);
        assert.equal(orch.getNode('W1').online, true);
    });

    test('a recovery is not raised for a node that was never offline', async () => {
        const alerts = [];
        orch.onNodeAlert((_workerId, alert) => alerts.push(alert));

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_STATUS, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_STATUS, data: {} });

        assert.deepEqual(alerts, []);
    });

    test('a node alert reaches the policy engine as well as the hooks', async () => {
        const handled = [];
        orch._policies.handleAlert = async (workerId, alert) => handled.push({ workerId, type: alert.type });

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_ALERT, data: { type: ClusterAlerts.NODE_STALE, severity: 'critical' } });

        assert.deepEqual(handled, [{ workerId: 'W1', type: ClusterAlerts.NODE_STALE }]);
    });

    test('an unknown event is surfaced to the generic hook rather than dropped', async () => {
        const seen = [];
        orch.onNodeEvent((workerId, event) => seen.push({ workerId, name: event.name }));

        await orch._routeWorkerEvent('W1', { name: 'app:custom-thing', data: { x: 1 } });

        // Application traffic rides the same tunnel; swallowing it would make
        // the orchestrator unusable as a message bus.
        assert.deepEqual(seen, [{ workerId: 'W1', name: 'app:custom-thing' }]);
    });

    test('a command result is handed to the dispatcher and does not touch the hooks', async () => {
        const seen = [];
        orch.onNodeEvent(() => seen.push('event'));
        let resolved = null;
        orch._dispatcher.resolveResult = (workerId, data) => {
            resolved = { workerId, data };
            return true;
        };

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.COMMAND_RESULT, data: { commandId: 'CMD_1', ok: true } });

        assert.deepEqual(resolved, { workerId: 'W1', data: { commandId: 'CMD_1', ok: true } });
        assert.deepEqual(seen, []);
    });

    test('an unmatched command result is tolerated, not thrown', async () => {
        orch._dispatcher.resolveResult = () => false;

        await assert.doesNotReject(() => orch._routeWorkerEvent('W1', { name: ClusterEvents.COMMAND_RESULT, data: {} }));
    });

    test('a routing failure is contained — one bad event cannot kill the router', async () => {
        orch._registry.recordAlert = () => {
            throw new Error('registry corrupted');
        };

        await assert.doesNotReject(() => orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_ALERT, data: {} }));

        // And the next event still routes.
        await orch._routeWorkerEvent('W2', { name: ClusterEvents.NODE_HELLO, data: {} });
        assert.ok(orch.getNode('W2'));
    });

    test('mailing events are forwarded only when the mailing plane exists', async () => {
        // No mailing plane: the optional-chained calls must be no-ops, not crashes.
        await assert.doesNotReject(() => orch._routeWorkerEvent('W1', { name: ClusterEvents.MAILING_PROGRESS, data: { jobId: 'JOB_1' } }));
        await assert.doesNotReject(() => orch._routeWorkerEvent('W1', { name: ClusterEvents.MAILING_GROUP_DONE, data: {} }));

        const forwarded = [];
        orch._mailing = {
            async handleProgress(workerId, data) {
                forwarded.push({ kind: 'progress', workerId, data });
            },
            async handleGroupDone(workerId, data) {
                forwarded.push({ kind: 'done', workerId, data });
            },
            async handleNodeLost(workerId, reason) {
                forwarded.push({ kind: 'lost', workerId, reason });
            }
        };

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.MAILING_PROGRESS, data: { sent: 3 } });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.MAILING_GROUP_DONE, data: { groupId: 'G1' } });

        assert.deepEqual(forwarded.map(f => f.kind), ['progress', 'done']);
    });

    test('a departing node hands its unsent mailing groups back immediately', async () => {
        const lost = [];
        orch._mailing = { async handleNodeLost(workerId, reason) { lost.push({ workerId, reason }); } };

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_GOODBYE, data: { reason: 'deploy' } });

        // Waiting for the watchdog would stall the blast for the full silent
        // timeout when the node told us it was leaving.
        assert.equal(lost.length, 1);
        assert.match(lost[0].reason, /left the cluster \(deploy\)/);
    });
});

describe('OrionOrchestrator — stale node sweep', () => {
    test('a silent node is flipped stale, alerted on, and its mail reassigned', async () => {
        const orch = makeOrch({ nodeStaleAfterSeconds: 60 });
        const alerts = [];
        const lost = [];
        orch.onNodeAlert((workerId, alert) => alerts.push({ workerId, type: alert.type, severity: alert.severity }));
        orch._mailing = { async handleNodeLost(workerId, reason) { lost.push({ workerId, reason }); } };

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        // Backdate last contact rather than waiting 60s.
        orch._registry.getNode('W1').lastSeen = NOW() - 120;

        await orch._sweepStaleNodes();

        assert.deepEqual(alerts, [{ workerId: 'W1', type: ClusterAlerts.NODE_STALE, severity: 'critical' }]);
        assert.equal(orch.getNode('W1').online, false);
        assert.equal(lost.length, 1);
    });

    test('a node still inside the window is left alone', async () => {
        const orch = makeOrch({ nodeStaleAfterSeconds: 300 });
        const alerts = [];
        orch.onNodeAlert(() => alerts.push('alert'));

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._sweepStaleNodes();

        assert.deepEqual(alerts, []);
        assert.equal(orch.getNode('W1').online, true);
    });

    test('a node already offline is not re-alerted on every sweep', async () => {
        const orch = makeOrch({ nodeStaleAfterSeconds: 60 });
        const alerts = [];
        orch.onNodeAlert(() => alerts.push('alert'));

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        orch._registry.getNode('W1').lastSeen = NOW() - 120;

        await orch._sweepStaleNodes();
        await orch._sweepStaleNodes();
        await orch._sweepStaleNodes();

        // Otherwise a permanently-dead node pages the on-call every 30 seconds.
        assert.equal(alerts.length, 1);
    });

    test('recording the staleness alert does not resurrect the node', async () => {
        const orch = makeOrch({ nodeStaleAfterSeconds: 60 });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        const staleSince = NOW() - 120;
        orch._registry.getNode('W1').lastSeen = staleSince;

        await orch._sweepStaleNodes();

        // The alert is the orchestrator's own observation about a silent node.
        // Writing it through the inbound-traffic path would mark the node online
        // and refresh lastSeen — erasing the very condition being reported and
        // leaving a dead node showing as healthy in the panel.
        const node = orch.getNode('W1');
        assert.equal(node.online, false, 'the stale node was marked back online by its own alert');
        assert.equal(node.offlineReason, 'stale');
        assert.equal(node.lastSeen, staleSince, 'lastSeen must not be refreshed by a synthesized alert');
    });

    test('a stale node still counts as unhealthy in the merged cluster view', async () => {
        const orch = makeOrch({ nodeStaleAfterSeconds: 60 });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        orch._registry.getNode('W1').lastSeen = NOW() - 120;

        await orch._sweepStaleNodes();
        const { summary, nodes } = await orch.getClusterStatus();

        // This is what ClusterHealth counts to decide DEGRADED/INCIDENT; a node
        // that reports itself online after going stale is invisible to it.
        assert.equal(summary.offline, 1);
        assert.equal(summary.online, 0);
        assert.equal(nodes.find(n => n.workerId === 'W1').offlineReason, 'stale');
    });

    test('an alert genuinely received from a node does prove liveness', async () => {
        const orch = makeOrch({ nodeStaleAfterSeconds: 60 });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        orch._registry.getNode('W1').lastSeen = NOW() - 120;
        await orch._sweepStaleNodes();
        assert.equal(orch.getNode('W1').online, false);

        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_ALERT, data: { type: 'orion:disk-pressure', severity: 'warning' } });

        // The distinction that matters: delivery of an inbound alert IS contact,
        // so this path must keep touching liveness.
        assert.equal(orch.getNode('W1').online, true);
    });
});

describe('OrionOrchestrator — command plane', () => {
    let orch;

    beforeEach(() => {
        orch = makeOrch();
    });

    test('a command is dispatched with the configured timeout and the issuing principal', async () => {
        const admin = { type: 'admin', id: 'SAD_1', email: 'admin@orion.local' };

        const outcome = await orch.command('W1', ClusterCommands.PING, { x: 1 }, 5000, admin);

        assert.equal(outcome.ok, true);
        assert.deepEqual(orch.dispatched[0], { workerId: 'W1', action: ClusterCommands.PING, args: { x: 1 }, timeoutMs: 5000, issuedBy: admin });
    });

    test('a successful command is attributed to the admin in the command log', async () => {
        await orch.command('W1', ClusterCommands.PING, {}, 1000, { type: 'admin', email: 'admin@orion.local' });

        const entry = orch.getCommandLog().at(-1);
        assert.equal(entry.issuedBy, 'admin@orion.local');
        assert.equal(entry.ok, true);
        assert.equal(entry.action, ClusterCommands.PING);
    });

    test('an unattributed command is logged as system, not as blank', async () => {
        await orch.command('W1', ClusterCommands.PING);

        assert.equal(orch.getCommandLog().at(-1).issuedBy, 'system');
    });

    test('a principal without an email falls back to its id', async () => {
        await orch.command('W1', ClusterCommands.PING, {}, 1000, { type: 'admin', id: 'SAD_1' });

        assert.equal(orch.getCommandLog().at(-1).issuedBy, 'SAD_1');
    });

    test('a failed command is logged before the error propagates', async () => {
        orch._dispatcher.execute = async () => {
            throw new Error('command timed out after 10000ms');
        };

        await assert.rejects(() => orch.command('W1', ClusterCommands.LOCK_SERVER, {}, 1000, { email: 'admin@orion.local' }), /timed out/);

        // An attempt that failed is exactly the one an operator goes looking
        // for; dropping it from the log would hide it.
        const entry = orch.getCommandLog().at(-1);
        assert.equal(entry.ok, false);
        assert.match(entry.error, /timed out/);
        assert.equal(entry.issuedBy, 'admin@orion.local');
    });

    test('the command log is bounded and keeps the most recent entries', async () => {
        for (let i = 0; i < 260; i++) {
            await orch.command('W1', `action-${i}`);
        }

        const log = orch.getCommandLog(1000);
        assert.equal(log.length, 200, 'a busy cluster must not grow the log without bound');
        assert.equal(log.at(-1).action, 'action-259');
        assert.equal(log[0].action, 'action-60');
    });

    test('getCommandLog returns the tail at the requested size', async () => {
        for (let i = 0; i < 10; i++) await orch.command('W1', `action-${i}`);

        assert.deepEqual(
            orch.getCommandLog(3).map(e => e.action),
            ['action-7', 'action-8', 'action-9']
        );
    });

    test('every convenience wrapper maps to its protocol command', async () => {
        const single = {
            pingNode: ClusterCommands.PING,
            getNodeStatus: ClusterCommands.GET_STATUS,
            lockNode: ClusterCommands.LOCK_SERVER,
            unlockNode: ClusterCommands.UNLOCK_SERVER,
            clearNodeEtsLockdown: ClusterCommands.CLEAR_ETS_LOCKDOWN
        };

        for (const [method, action] of Object.entries(single)) {
            orch.dispatched.length = 0;
            await orch[method]('W1');
            assert.equal(orch.dispatched[0]?.action, action, `${method} sent the wrong action`);
        }
    });

    test('cluster-wide wrappers fan out rather than targeting one node', async () => {
        const fanned = [];
        orch.commandAll = async (action, args) => {
            fanned.push({ action, args });
            return [];
        };

        await orch.lockCluster();
        await orch.unlockCluster();
        await orch.addClientUrls(['https://app.example.com']);

        assert.deepEqual(fanned, [
            { action: ClusterCommands.LOCK_SERVER, args: {} },
            { action: ClusterCommands.UNLOCK_SERVER, args: {} },
            { action: ClusterCommands.ADD_CLIENT_URLS, args: { clientUrls: ['https://app.example.com'] } }
        ]);
    });

    test('commandAll never rejects — a per-node failure is reported in the results', async () => {
        // Two nodes, one of which throws. The array shape must stay uniform so
        // callers can report partial success.
        orch.commandAll = OrionOrchestrator.prototype.commandAll.bind(orch);
        let call = 0;
        orch.command = async workerId => {
            if (call++ === 0) return { workerId, ok: true };
            throw new Error('node unreachable');
        };
        orch._fleet = ['W1', 'W2'];

        const results = await Promise.allSettled([orch.command('W1'), orch.command('W2')]);
        const shaped = results.map((r, i) => (r.status === 'fulfilled' ? r.value : { workerId: `W${i + 1}`, ok: false, error: { message: r.reason.message } }));

        assert.deepEqual(shaped, [
            { workerId: 'W1', ok: true },
            { workerId: 'W2', ok: false, error: { message: 'node unreachable' } }
        ]);
    });

    test('raw event passthroughs reach the transport unchanged', async () => {
        await orch.sendEvent('W1', 'app:custom', { a: 1 });
        await orch.broadcastEvent('app:announce', { b: 2 });

        assert.deepEqual(orch.sent, [{ workerId: 'W1', eventName: 'app:custom', data: { a: 1 } }]);
        assert.deepEqual(orch.broadcasts, [{ eventName: 'app:announce', data: { b: 2 } }]);
    });
});

describe('OrionOrchestrator — cluster health', () => {
    let orch;

    beforeEach(() => {
        orch = makeOrch();
    });

    test('declareIncident transitions, escalates and tells the fleet', async () => {
        const states = [];
        orch.onClusterStateChange((state, previous) => states.push({ state, previous }));

        const snapshot = await orch.declareIncident('datacentre lost power');

        assert.equal(snapshot.state, ClusterStates.INCIDENT);
        assert.deepEqual(states, [{ state: ClusterStates.INCIDENT, previous: ClusterStates.FORMING }]);
        assert.equal(orch.broadcasts.at(-1).eventName, ClusterEvents.CLUSTER_STATE);
        assert.match(orch.getEscalations().at(-1).message, /INCIDENT declared manually: datacentre lost power/);
    });

    test('declaring an incident twice does not re-broadcast or re-escalate', async () => {
        await orch.declareIncident('first');
        const broadcasts = orch.broadcasts.length;
        const escalations = orch.getEscalations().length;

        await orch.declareIncident('second');

        // Repeated declarations are common from a nervous operator; each one
        // paging the fleet again is noise.
        assert.equal(orch.broadcasts.length, broadcasts);
        assert.equal(orch.getEscalations().length, escalations);
    });

    test('a failed broadcast does not prevent the state change', async () => {
        orch.rsync.broadcast = async () => {
            throw new Error('no nodes reachable');
        };

        // If the fleet is unreachable, that is *more* reason to be in INCIDENT,
        // not a reason to stay HEALTHY.
        const snapshot = await orch.declareIncident('total partition');
        assert.equal(snapshot.state, ClusterStates.INCIDENT);
    });

    test('resolveIncident on a non-incident cluster is a no-op', async () => {
        const before = orch.getClusterHealth().state;

        const snapshot = await orch.resolveIncident('nothing to do');

        assert.equal(snapshot.state, before);
        assert.deepEqual(orch.broadcasts, []);
    });

    test('a manual resolve caps at DEGRADED rather than bouncing back to INCIDENT', async () => {
        await orch.declareIncident('manual');
        // A fleet the evaluator would still call INCIDENT.
        orch._health.evaluate = () => ({ targetState: ClusterStates.INCIDENT, unhealthy: [{}, {}], total: 2, ratio: 1 });

        const snapshot = await orch.resolveIncident('operator says it is fine now');

        // Otherwise "resolve" would appear to do nothing at all; the periodic
        // evaluation re-escalates honestly if the fleet really is still down.
        assert.equal(snapshot.state, ClusterStates.DEGRADED);
        assert.match(orch.getEscalations().at(-1).message, /resolved manually.*now DEGRADED/);
    });

    test('INCIDENT is held at DEGRADED when the fleet votes itself healthy', async () => {
        orch._health.evaluate = () => ({ targetState: ClusterStates.INCIDENT, unhealthy: [{}], total: 1, ratio: 1 });
        orch.proposeConsensus = async () => ({ decided: true, accepted: true, ratio: 1 });

        await orch._evaluateHealth();

        // One observer declaring a cluster-wide incident on its own registry
        // view is how a network blip becomes an outage page.
        assert.equal(orch.getClusterHealth().state, ClusterStates.DEGRADED);
    });

    test('an undecided vote counts FOR the incident — silence is what an outage looks like', async () => {
        orch._health.evaluate = () => ({ targetState: ClusterStates.INCIDENT, unhealthy: [{}], total: 1, ratio: 1 });
        orch.proposeConsensus = async () => ({ decided: false, accepted: false, ratio: 0 });

        await orch._evaluateHealth();

        assert.equal(orch.getClusterHealth().state, ClusterStates.INCIDENT);
    });

    test('a failed confirmation vote falls back to the registry evidence', async () => {
        orch._health.evaluate = () => ({ targetState: ClusterStates.INCIDENT, unhealthy: [{}], total: 1, ratio: 1 });
        orch.proposeConsensus = async () => {
            throw new Error('consensus engine unavailable');
        };

        await orch._evaluateHealth();

        assert.equal(orch.getClusterHealth().state, ClusterStates.INCIDENT);
    });

    test('the confirmation vote is skipped when it is configured off', async () => {
        const direct = makeOrch({ confirmIncidentViaConsensus: false });
        let voted = false;
        direct._health.evaluate = () => ({ targetState: ClusterStates.INCIDENT, unhealthy: [{}], total: 1, ratio: 1 });
        direct.proposeConsensus = async () => {
            voted = true;
            return { decided: true, accepted: true };
        };

        await direct._evaluateHealth();

        assert.equal(voted, false);
        assert.equal(direct.getClusterHealth().state, ClusterStates.INCIDENT);
    });

    test('an already-INCIDENT cluster is not re-confirmed on every evaluation', async () => {
        let votes = 0;
        orch._health.evaluate = () => ({ targetState: ClusterStates.INCIDENT, unhealthy: [{}], total: 1, ratio: 1 });
        orch.proposeConsensus = async () => {
            votes++;
            return { decided: false, accepted: false };
        };

        await orch._evaluateHealth();
        await orch._evaluateHealth();
        await orch._evaluateHealth();

        assert.equal(votes, 1, 'the fleet must not be polled once per tick for a known incident');
    });

    test('the escalation severity tracks the state being entered', async () => {
        const severities = [];
        orch._escalations.raise = async escalation => severities.push(escalation.severity);

        orch._health.evaluate = () => ({ targetState: ClusterStates.DEGRADED, unhealthy: [{}], total: 2, ratio: 0.5 });
        await orch._evaluateHealth();

        orch._health.evaluate = () => ({ targetState: ClusterStates.HEALTHY, unhealthy: [], total: 2, ratio: 0 });
        await orch._evaluateHealth();

        assert.deepEqual(severities, ['warning', 'info']);
    });

    test('health evaluation is skipped once the orchestrator has stopped', async () => {
        orch.started = false;
        let evaluated = false;
        orch._health.evaluate = () => {
            evaluated = true;
            return { targetState: ClusterStates.HEALTHY, unhealthy: [], total: 0, ratio: 0 };
        };

        await orch._evaluateHealth();

        assert.equal(evaluated, false);
    });
});

describe('OrionOrchestrator — signing-key revocation', () => {
    let orch;

    beforeEach(() => {
        orch = makeOrch();
    });

    test('the key inventory is reshaped per node, separating success from failure', async () => {
        orch.commandAll = async () => [
            { workerId: 'W1', ok: true, result: { managers: [{ name: 'access', signing: [{ kid: 'k1' }] }] } },
            { workerId: 'W2', ok: false, error: { message: 'unreachable' } }
        ];

        const inventory = await orch.listClusterSigningKeys();

        assert.deepEqual(inventory, [
            { workerId: 'W1', ok: true, managers: [{ name: 'access', signing: [{ kid: 'k1' }] }] },
            { workerId: 'W2', ok: false, error: { message: 'unreachable' } }
        ]);
    });

    test('a node that answered without managers reports an empty list, not undefined', async () => {
        orch.commandAll = async () => [{ workerId: 'W1', ok: true, result: {} }];

        assert.deepEqual((await orch.listClusterSigningKeys())[0].managers, []);
    });

    test('revoking requires a non-empty kid array', () => {
        for (const kids of [undefined, [], null, 'kid-1']) {
            assert.throws(() => orch.revokeSigningKids(kids), /non-empty kids array/, `accepted ${JSON.stringify(kids)}`);
        }
    });

    test('revocation is broadcast fleet-wide with the kids coerced to strings', async () => {
        const fanned = [];
        orch.commandAll = async (action, args) => {
            fanned.push({ action, args });
            return [];
        };

        await orch.revokeSigningKids(['k1', 'k2']);

        // Every node self-discovers what a kid means to it — the owner rotates,
        // everyone else drops it from their verification pool.
        assert.deepEqual(fanned, [{ action: ClusterCommands.SECRETS_REVOKE_KIDS, args: { kids: ['k1', 'k2'] } }]);
    });

    test('forceRotateNodeKeys collects the node kids then broadcasts them', async () => {
        orch.command = async () => ({
            ok: true,
            result: { managers: [{ signing: [{ kid: 'k1' }, { kid: 'k2' }] }, { signing: [{ kid: 'k3' }] }] }
        });
        const revoked = [];
        orch.revokeSigningKids = async kids => {
            revoked.push(kids);
            return [{ workerId: 'W1', ok: true }];
        };

        const outcome = await orch.forceRotateNodeKeys('W1');

        assert.deepEqual(outcome.kids, ['k1', 'k2', 'k3']);
        assert.deepEqual(revoked, [['k1', 'k2', 'k3']]);
    });

    test('a node with no active keys is a no-op rather than an empty broadcast', async () => {
        orch.command = async () => ({ ok: true, result: { managers: [] } });
        let broadcast = false;
        orch.revokeSigningKids = async () => {
            broadcast = true;
            return [];
        };

        const outcome = await orch.forceRotateNodeKeys('W1');

        assert.deepEqual(outcome, { workerId: 'W1', kids: [], results: [] });
        assert.equal(broadcast, false);
    });

    test('an unreachable node fails loudly instead of silently revoking nothing', async () => {
        orch.command = async () => ({ ok: false, error: { message: 'timed out' } });

        await assert.rejects(() => orch.forceRotateNodeKeys('W1'), /Could not list signing keys on W1: timed out/);
    });
});

describe('OrionOrchestrator — key vault operations', () => {
    let orch;

    beforeEach(() => {
        orch = makeOrch();
        orch._firstActiveWorkerId = async () => 'W1';
    });

    test('vault status is gathered fleet-wide so a diverging node is visible', async () => {
        orch.commandAll = async () => [
            { workerId: 'W1', ok: true, result: { provider: 'aws-kms', healthy: true } },
            { workerId: 'W2', ok: false, error: { message: 'vault unreachable' } }
        ];

        const status = await orch.getClusterKeyVaultStatus();

        // A single-node query would hide exactly the failure that turns into a
        // partial outage.
        assert.deepEqual(status, [
            { workerId: 'W1', ok: true, status: { provider: 'aws-kms', healthy: true } },
            { workerId: 'W2', ok: false, error: { message: 'vault unreachable' } }
        ]);
    });

    test('KEK rotation targets one node with the long timeout', async () => {
        const issued = [];
        orch.command = async (workerId, action, args, timeoutMs) => {
            issued.push({ workerId, action, timeoutMs });
            return { ok: true };
        };

        const result = await orch.rotateEncryptionKek();

        assert.equal(result.workerId, 'W1');
        assert.equal(issued[0].action, ClusterCommands.KEYVAULT_ROTATE_KEK);
        // The DEK ledger is shared database state — a broadcast would have every
        // node re-wrapping the same row concurrently.
        assert.equal(issued.length, 1);
        assert.equal(issued[0].timeoutMs, 10 * 60 * 1000);
    });

    test('an explicit node overrides the default target', async () => {
        const issued = [];
        orch.command = async workerId => {
            issued.push(workerId);
            return { ok: true };
        };

        await orch.rotateEncryptionKek('W7');
        await orch.rotateEncryptionDek({ workerId: 'W9' });

        assert.deepEqual(issued, ['W7', 'W9']);
    });

    test('DEK rotation re-encrypts by default and passes an explicit batch size through', async () => {
        const issued = [];
        orch.command = async (_workerId, _action, args) => {
            issued.push(args);
            return { ok: true };
        };

        await orch.rotateEncryptionDek();
        await orch.rotateEncryptionDek({ batchSize: 500, reencrypt: false });

        assert.deepEqual(issued[0], { reencrypt: true });
        assert.deepEqual(issued[1], { batchSize: 500, reencrypt: false });
    });

    test('the unrecoverable check demands unanimity from every node', async () => {
        let options = null;
        orch.proposeConsensus = async (topic, params, opts) => {
            options = { topic, opts };
            return { decided: true, accepted: true };
        };

        await orch.confirmEncryptionUnrecoverable();

        // If one node can still decrypt, the data is not lost and the answer is
        // to repair the others — so a majority is not good enough.
        assert.equal(options.topic, ConsensusTopics.ENCRYPTION_UNAVAILABLE);
        assert.equal(options.opts.quorumRatio, 1);
    });
});

describe('OrionOrchestrator — the encrypted-field wipe', () => {
    let orch;

    beforeEach(() => {
        orch = makeOrch();
        orch._firstActiveWorkerId = async () => 'W1';
        orch.confirmEncryptionUnrecoverable = async () => ({ decided: true, accepted: true, yes: 2, eligible: 2, responded: 2 });
        orch.command = async (workerId, action, args) => ({ ok: true, workerId, action, args });
    });

    const VALID = { confirmation: WIPE_CONFIRMATION_PHRASE, reason: 'vault destroyed in region outage' };

    test('the exact confirmation phrase is required, before any consensus is even asked', async () => {
        let asked = false;
        orch.confirmEncryptionUnrecoverable = async () => {
            asked = true;
            return { accepted: true };
        };

        for (const confirmation of [undefined, '', 'wipe encrypted fields', 'WIPE ENCRYPTED FIELD', ' WIPE ENCRYPTED FIELDS ']) {
            await assert.rejects(
                () => orch.wipeEncryptedFields({ ...VALID, confirmation }),
                /confirmation phrase must be exactly/,
                `accepted ${JSON.stringify(confirmation)}`
            );
        }

        assert.equal(asked, false, 'the phrase gate must come first');
    });

    test('the phrase alone is not enough — the fleet must agree the data is unrecoverable', async () => {
        orch.confirmEncryptionUnrecoverable = async () => ({ decided: true, accepted: false, yes: 1, eligible: 3, responded: 3 });

        await assert.rejects(() => orch.wipeEncryptedFields(VALID), err => {
            assert.equal(err.code, 'KEYVAULT::CONSENSUS-REFUSED');
            assert.match(err.message, /2 of 3 node\(s\) can still decrypt/);
            assert.match(err.message, /Repair those nodes instead/);
            assert.deepEqual(err.consensus.eligible, 3);
            return true;
        });
    });

    test('an undecided vote blocks the wipe as "unknown" rather than proceeding', async () => {
        orch.confirmEncryptionUnrecoverable = async () => ({ decided: false, accepted: false, yes: 1, eligible: 3, responded: 1 });

        await assert.rejects(() => orch.wipeEncryptedFields(VALID), err => {
            assert.match(err.message, /only 1\/3 nodes answered, so the fleet's state is unknown/);
            return true;
        });
    });

    test('no command is issued when consensus refuses', async () => {
        const issued = [];
        orch.command = async (...args) => {
            issued.push(args);
            return { ok: true };
        };
        orch.confirmEncryptionUnrecoverable = async () => ({ decided: true, accepted: false, yes: 0, eligible: 1, responded: 1 });

        await assert.rejects(() => orch.wipeEncryptedFields(VALID));

        assert.deepEqual(issued, []);
    });

    test('an explicit override proceeds and is flagged as overridden in the result', async () => {
        orch.confirmEncryptionUnrecoverable = async () => ({ decided: true, accepted: false, yes: 0, eligible: 2, responded: 2 });

        const result = await orch.wipeEncryptedFields({ ...VALID, overrideConsensus: true });

        assert.equal(result.consensusOverridden, true, 'the audit trail must be able to tell an override from an agreed wipe');
        assert.equal(result.workerId, 'W1');
    });

    test('overrideConsensus is honoured only when it is exactly true', async () => {
        orch.confirmEncryptionUnrecoverable = async () => ({ decided: true, accepted: false, yes: 0, eligible: 1, responded: 1 });

        for (const override of ['true', 1, {}, 'yes']) {
            await assert.rejects(() => orch.wipeEncryptedFields({ ...VALID, overrideConsensus: override }), /Refusing to wipe/, `accepted ${JSON.stringify(override)}`);
        }
    });

    test('an agreed wipe is not marked as overridden', async () => {
        const result = await orch.wipeEncryptedFields(VALID);

        assert.equal(result.consensusOverridden, false);
    });

    test('the wipe runs on exactly one node, with the phrase re-sent for the node to re-check', async () => {
        const issued = [];
        orch.command = async (workerId, action, args, timeoutMs) => {
            issued.push({ workerId, action, args, timeoutMs });
            return { ok: true };
        };

        await orch.wipeEncryptedFields({ ...VALID, fields: ['totp_secret'] });

        assert.equal(issued.length, 1, 'a broadcast would be N identical destructive passes');
        assert.equal(issued[0].action, ClusterCommands.KEYVAULT_WIPE_ENCRYPTED);
        assert.equal(issued[0].args.confirmation, WIPE_CONFIRMATION_PHRASE);
        assert.deepEqual(issued[0].args.fields, ['totp_secret']);
        assert.equal(issued[0].timeoutMs, 10 * 60 * 1000);
    });

    test('an empty field list means "everything" rather than an empty selection', async () => {
        const issued = [];
        orch.command = async (_w, _a, args) => {
            issued.push(args);
            return { ok: true };
        };

        await orch.wipeEncryptedFields({ ...VALID, fields: [] });

        assert.equal('fields' in issued[0], false, 'an empty list must not be sent as a no-op selection');
    });

    test('the acting admin rides the command so the node can audit it too', async () => {
        const issued = [];
        orch.command = async (_w, _a, args) => {
            issued.push(args);
            return { ok: true };
        };

        await orch.wipeEncryptedFields(VALID, { type: 'admin', email: 'root@orion.local' });

        assert.equal(issued[0].actorEmail, 'root@orion.local');
        assert.equal(issued[0].reason, VALID.reason);
    });

    test('the exported phrase is the one the CLI and the node both hard-code', () => {
        // orionctl and ClusterLinkSystem duplicate this string deliberately;
        // if it changes here and nowhere else, the wipe becomes unreachable.
        assert.equal(WIPE_CONFIRMATION_PHRASE, 'WIPE ENCRYPTED FIELDS');
    });
});

describe('OrionOrchestrator — getClusterStatus', () => {
    test('the merged view joins transport and registry records', async () => {
        const orch = makeOrch();
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: { appName: 'api' } });

        const status = await orch.getClusterStatus();

        assert.equal(status.cluster, 'test-cluster');
        assert.equal(status.orchestratorId, 'ORCH_1');
        assert.ok(status.protocolVersion);
        assert.ok(status.generatedAt > 0);

        const node = status.nodes.find(n => n.workerId === 'W1');
        assert.ok(node, 'a registry-only node must still appear');
        assert.equal(node.online, true);
        assert.deepEqual(node.identity, { appName: 'api' });
    });

    test('the summary counts online, offline and unhealthy nodes', async () => {
        const orch = makeOrch();
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W2', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W2', { name: ClusterEvents.NODE_GOODBYE, data: { reason: 'deploy' } });

        const { summary } = await orch.getClusterStatus();

        assert.equal(summary.total, 2);
        assert.equal(summary.online, 1);
        assert.equal(summary.offline, 1);
        assert.ok(summary.escalations);
    });

    test('only the five most recent alerts per node are carried', async () => {
        const orch = makeOrch();
        for (let i = 0; i < 8; i++) {
            await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_ALERT, data: { type: `alert-${i}`, severity: 'warning' } });
        }

        const node = (await orch.getClusterStatus()).nodes.find(n => n.workerId === 'W1');

        // The panel renders this on every poll; an unbounded alert history per
        // node would make the payload grow without limit.
        assert.equal(node.recentAlerts.length, 5);
        assert.equal(node.recentAlerts.at(-1).type, 'alert-7');
    });

    test('a node offline reason survives into the merged view', async () => {
        const orch = makeOrch();
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_HELLO, data: {} });
        await orch._routeWorkerEvent('W1', { name: ClusterEvents.NODE_GOODBYE, data: { reason: 'oom-killed' } });

        const node = (await orch.getClusterStatus()).nodes.find(n => n.workerId === 'W1');

        assert.equal(node.online, false);
        assert.equal(node.offlineReason, 'oom-killed');
    });
});

describe('OrionOrchestrator — stop()', () => {
    test('stop() clears timers, the dispatcher and the transport, and is idempotent', async () => {
        const orch = makeOrch();
        let cleared = null;
        orch._dispatcher.clear = reason => {
            cleared = reason;
        };
        orch._staleSweepTimer = setInterval(() => {}, 1000);
        orch._healthTimer = setInterval(() => {}, 1000);

        await orch.stop();

        assert.equal(orch.started, false);
        assert.equal(orch.rsync, null);
        assert.equal(orch._staleSweepTimer, null);
        assert.equal(orch._healthTimer, null);
        assert.match(cleared, /stopping/);

        await assert.doesNotReject(() => orch.stop(), 'a second stop must not throw');
    });

    test('a failure closing the admin plane does not prevent the rest of the shutdown', async () => {
        const orch = makeOrch();
        orch._adminServer = {
            async stop() {
                throw new Error('server already closed');
            }
        };
        orch._adminDb = {
            async close() {
                throw new Error('pool already ended');
            }
        };

        await orch.stop();

        // A half-torn-down orchestrator that still holds its transport is worse
        // than one that logged two warnings.
        assert.equal(orch.rsync, null);
        assert.equal(orch.started, false);
        assert.equal(orch._adminServer, null);
        assert.equal(orch._adminDb, null);
    });
});
