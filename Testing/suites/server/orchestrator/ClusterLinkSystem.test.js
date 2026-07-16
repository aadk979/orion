import '../../../helpers/bootstrap.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { ClusterLinkSystem } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/ClusterLinkSystem.js';
import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import * as protocol from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';
import { silenceConsole } from '../../../helpers/mocks.js';

const { ClusterEvents, ClusterCommands, ConsensusTopics } = protocol;

// Locked GAP keys can only be set once per process — seed them at file scope.
globalAccessPoint.setValue('systemConfig', { app: { serviceID: 'svc-test', appName: 'TestNode', port: 12345 } });
globalAccessPoint.setValue('clusterMode', false);
globalAccessPoint.setValue('timeOfLife', 1_784_000_000);

// ── Fakes ──────────────────────────────────────────────────────────────────────

const makeSystemsControl = (overrides = {}) => ({
    safeMode: true,
    getSystemStatus: () => ({ safeMode: true, serverLocked: false, etsLockdown: false, elmDegraded: false, memoryMonitor: null }),
    lockServer: () => true,
    unlockServer: () => true,
    clearEtsLockdown: () => false, // safe mode refusal
    deactivateSystemSecurity: () => false,
    reactivateSystemSecurity: () => false,
    pauseAuditTrail: () => false,
    resumeAuditTrail: () => false,
    openCircuitBreaker: () => true,
    resetCircuitBreaker: () => false,
    setMaxInFlight: () => false,
    unblockActor: () => false,
    reactivateMemoryMonitoring: () => {},
    deactivateMemoryMonitoring: () => {},
    reactivateEventLoopMonitor: () => {},
    deactivateEventLoopMonitor: () => {},
    ...overrides
});

// Builds a link wired to a capture-only fake transport, skipping start() so no
// real r-sync networking is involved.
const makeLink = (config = {}) => {
    const link = new ClusterLinkSystem({
        enabled: true,
        cluster: 'test-cluster',
        allowRemoteControl: true,
        ...config
    });
    const emissions = [];
    link.protocol = protocol;
    link.rsync = {
        workerId: 'W-test',
        emitToOrchestrator: async (name, data) => { emissions.push({ name, data }); return { acknowledged: true }; }
    };
    link.connected = true;
    return { link, emissions };
};

beforeEach(() => {
    globalAccessPoint.setValue('orionSystemsControl', makeSystemsControl());
    globalAccessPoint.setValue('clientUrlsRunTimeUpdateAllowed', undefined);
    globalAccessPoint.setValue('clusterState', undefined);
});

// ── Command execution ─────────────────────────────────────────────────────────

describe('ClusterLink — command execution', () => {
    test('ping answers without SystemsControl involvement', async () => {
        const { link } = makeLink();
        const result = await link.executeCommand(ClusterCommands.PING, {});
        assert.equal(result.pong, true);
        assert.equal(result.workerId, 'W-test');
    });

    test('identify returns the hello identity payload', async () => {
        const { link } = makeLink();
        const result = await link.executeCommand(ClusterCommands.IDENTIFY, {});
        assert.equal(result.serviceID, 'svc-test');
        assert.equal(result.appName, 'TestNode');
        assert.equal(result.allowRemoteControl, true);
        assert.equal(result.pid, process.pid);
    });

    test('get-status returns the SystemsControl snapshot', async () => {
        const { link } = makeLink();
        const result = await link.executeCommand(ClusterCommands.GET_STATUS, {});
        assert.equal(result.safeMode, true);
    });

    test('mutating commands report applied true/false from SystemsControl', async () => {
        const { link } = makeLink();
        assert.deepEqual(await link.executeCommand(ClusterCommands.LOCK_SERVER, {}), { applied: true });
        // safe mode refusals surface as applied:false, not as errors
        assert.deepEqual(await link.executeCommand(ClusterCommands.CLEAR_ETS_LOCKDOWN, {}), { applied: false });
    });

    test('argument-taking commands enforce their arguments', async () => {
        const { link } = makeLink();
        await assert.rejects(link.executeCommand(ClusterCommands.DEACTIVATE_SECURITY, {}), /"system" is required/);
        await assert.rejects(link.executeCommand(ClusterCommands.SET_MAX_IN_FLIGHT, { limit: -5 }), /positive number/);
        await assert.rejects(link.executeCommand(ClusterCommands.UNBLOCK_ACTOR, {}), /"actorId" is required/);
    });

    test('every allowlisted command has an executor (no protocol drift)', async () => {
        const { link } = makeLink();
        const argFillers = {
            [ClusterCommands.CONSENSUS_VOTE]: { topic: ConsensusTopics.NODE_HEALTHY },
            [ClusterCommands.DEACTIVATE_SECURITY]: { system: 'captcha' },
            [ClusterCommands.REACTIVATE_SECURITY]: { system: 'captcha' },
            [ClusterCommands.OPEN_CIRCUIT]: { dependency: 'db' },
            [ClusterCommands.RESET_CIRCUIT]: { dependency: 'db' },
            [ClusterCommands.SET_MAX_IN_FLIGHT]: { limit: 100 },
            [ClusterCommands.UNBLOCK_ACTOR]: { actorId: 'a1' },
            [ClusterCommands.ADD_CLIENT_URLS]: { clientUrls: ['https://a.example'] }
        };
        for (const action of Object.values(ClusterCommands)) {
            // Must never hit the "allowlisted but has no executor" branch
            await link.executeCommand(action, argFillers[action] || {});
        }
    });
});

// ── Consensus voting ──────────────────────────────────────────────────────────

describe('ClusterLink — consensus ballots', () => {
    test('node-healthy votes true on a clean node and false under lockdown', async () => {
        const { link } = makeLink();
        let ballot = await link.executeCommand(ClusterCommands.CONSENSUS_VOTE, { topic: ConsensusTopics.NODE_HEALTHY });
        assert.equal(ballot.vote, true);
        assert.equal(ballot.topic, ConsensusTopics.NODE_HEALTHY);

        globalAccessPoint.setValue('orionSystemsControl', makeSystemsControl({
            getSystemStatus: () => ({ safeMode: true, serverLocked: false, etsLockdown: true, elmDegraded: false, memoryMonitor: null })
        }));
        ballot = await link.executeCommand(ClusterCommands.CONSENSUS_VOTE, { topic: ConsensusTopics.NODE_HEALTHY });
        assert.equal(ballot.vote, false);
        assert.equal(ballot.details.etsLockdown, true);
    });

    test('memory-pressure topic honors the per-vote threshold param', async () => {
        globalAccessPoint.setValue('orionSystemsControl', makeSystemsControl({
            getSystemStatus: () => ({ safeMode: true, serverLocked: false, etsLockdown: false, elmDegraded: false, memoryMonitor: { usagePercent: 70 } })
        }));
        const { link } = makeLink();

        let ballot = await link.executeCommand(ClusterCommands.CONSENSUS_VOTE, { topic: ConsensusTopics.MEMORY_PRESSURE });
        assert.equal(ballot.vote, false); // 70 < default 80

        ballot = await link.executeCommand(ClusterCommands.CONSENSUS_VOTE, {
            topic: ConsensusTopics.MEMORY_PRESSURE, params: { thresholdPercent: 60 }
        });
        assert.equal(ballot.vote, true);
        assert.equal(ballot.details.usagePercent, 70);
    });

    test('abuse-high counts blocked actors against minBlocked', async () => {
        globalAccessPoint.setValue('orionSystemsControl', makeSystemsControl({
            getSystemStatus: () => ({ safeMode: true, abuseDetection: { blockedActors: 3 }, memoryMonitor: null })
        }));
        const { link } = makeLink();

        let ballot = await link.executeCommand(ClusterCommands.CONSENSUS_VOTE, { topic: ConsensusTopics.ABUSE_HIGH });
        assert.equal(ballot.vote, true); // 3 >= default 1

        ballot = await link.executeCommand(ClusterCommands.CONSENSUS_VOTE, {
            topic: ConsensusTopics.ABUSE_HIGH, params: { minBlocked: 5 }
        });
        assert.equal(ballot.vote, false);
    });

    test('unknown topics are rejected', async () => {
        const { link } = makeLink();
        await assert.rejects(
            link.executeCommand(ClusterCommands.CONSENSUS_VOTE, { topic: 'not-a-topic' }),
            /Unknown consensus topic/
        );
    });
});

// ── Runtime client-URL propagation ────────────────────────────────────────────

describe('ClusterLink — client URL propagation', () => {
    test('refused when the node did not opt into runtime updates', async () => {
        const { link } = makeLink();
        const result = await link.executeCommand(ClusterCommands.ADD_CLIENT_URLS, { clientUrls: ['https://new.example'] });
        assert.equal(result.applied, false);
        assert.equal(result.reason, 'RUNTIME_CLIENT_URL_UPDATES_DISABLED');
    });

    test('merges, dedups, and validates when runtime updates are allowed', async () => {
        globalAccessPoint.setValue('clientUrlsRunTimeUpdateAllowed', true);
        globalAccessPoint.setValue('allowedClientUrls', ['https://existing.example']);
        const { link } = makeLink();

        const result = await silenceConsole(() => link.executeCommand(ClusterCommands.ADD_CLIENT_URLS, {
            clientUrls: ['https://new.example', 'https://existing.example', 'ftp://bad.example']
        }));

        assert.equal(result.applied, true);
        assert.equal(result.added, 1); // dedup + invalid protocol filtered
        assert.deepEqual(globalAccessPoint.allowedClientUrls(), ['https://existing.example', 'https://new.example']);
    });
});

// ── Inbound command envelopes ─────────────────────────────────────────────────

describe('ClusterLink — inbound command handling', () => {
    test('valid command produces an ok result envelope', async () => {
        const { link, emissions } = makeLink();
        await link._handleOrchestratorEvent({
            name: ClusterEvents.COMMAND,
            data: { commandId: 'C1', action: ClusterCommands.PING, args: {} }
        });
        assert.equal(emissions.length, 1);
        assert.equal(emissions[0].name, ClusterEvents.COMMAND_RESULT);
        assert.equal(emissions[0].data.ok, true);
        assert.equal(emissions[0].data.commandId, 'C1');
    });

    test('unknown action is rejected with UNKNOWN_COMMAND', async () => {
        const { link, emissions } = makeLink();
        await link._handleOrchestratorEvent({
            name: ClusterEvents.COMMAND,
            data: { commandId: 'C2', action: 'not:real', args: {} }
        });
        assert.equal(emissions[0].data.ok, false);
        assert.equal(emissions[0].data.error.code, 'UNKNOWN_COMMAND');
    });

    test('remote control disabled rejects EVERY action', async () => {
        const { link, emissions } = makeLink({ allowRemoteControl: false });
        await link._handleOrchestratorEvent({
            name: ClusterEvents.COMMAND,
            data: { commandId: 'C3', action: ClusterCommands.PING, args: {} }
        });
        assert.equal(emissions[0].data.ok, false);
        assert.equal(emissions[0].data.error.code, 'REMOTE_CONTROL_DISABLED');
        assert.equal(link.getStats().commandsRejected, 1);
    });

    test('executor errors are reported as EXECUTION_ERROR, not thrown', async () => {
        const { link, emissions } = makeLink();
        await link._handleOrchestratorEvent({
            name: ClusterEvents.COMMAND,
            data: { commandId: 'C4', action: ClusterCommands.DEACTIVATE_SECURITY, args: {} }
        });
        assert.equal(emissions[0].data.ok, false);
        assert.equal(emissions[0].data.error.code, 'EXECUTION_ERROR');
    });

    test('malformed envelopes are dropped without a reply', async () => {
        const { link, emissions } = makeLink();
        await silenceConsole(async () => {
            await link._handleOrchestratorEvent({ name: ClusterEvents.COMMAND, data: {} });
        });
        assert.equal(emissions.length, 0);
    });

    test('non-protocol events go to custom handlers', async () => {
        const { link } = makeLink();
        const seen = [];
        link.onClusterEvent(e => seen.push(e.name));
        await link._handleOrchestratorEvent({ name: 'app:custom', data: {} });
        assert.deepEqual(seen, ['app:custom']);
    });
});

// ── Cluster state broadcasts ──────────────────────────────────────────────────

describe('ClusterLink — cluster state tracking', () => {
    test('CLUSTER_STATE broadcasts land in the GAP and reach custom handlers', async () => {
        const { link } = makeLink();
        const seen = [];
        link.onClusterEvent(e => seen.push(e.name));

        await link._handleOrchestratorEvent({
            name: ClusterEvents.CLUSTER_STATE,
            data: { state: 'DEGRADED', previousState: 'HEALTHY', summary: { unhealthy: 1 } }
        });

        assert.equal(link.getClusterState().state, 'DEGRADED');
        assert.equal(globalAccessPoint.clusterState().state, 'DEGRADED');
        assert.deepEqual(seen, [ClusterEvents.CLUSTER_STATE]);
        assert.equal(link.getStats().clusterState, 'DEGRADED');
    });
});

// ── Status reporting & alert edges ────────────────────────────────────────────

describe('ClusterLink — status reports and edge-triggered alerts', () => {
    test('first snapshot establishes a baseline without alerting', async () => {
        const { link, emissions } = makeLink();
        await link._reportStatus();
        const alerts = emissions.filter(e => e.name === ClusterEvents.NODE_ALERT);
        assert.equal(alerts.length, 0);
        const reports = emissions.filter(e => e.name === ClusterEvents.NODE_STATUS);
        assert.equal(reports.length, 1);
        assert.ok(reports[0].data.process.rssBytes > 0); // process telemetry attached
    });

    test('flag flips raise one alert per transition, both directions', async () => {
        let lockdown = false;
        globalAccessPoint.setValue('orionSystemsControl', makeSystemsControl({
            getSystemStatus: () => ({ safeMode: true, serverLocked: false, etsLockdown: lockdown, elmDegraded: false, memoryMonitor: null })
        }));
        const { link, emissions } = makeLink();

        await link._reportStatus();            // baseline
        lockdown = true;
        await link._reportStatus();            // rising edge
        await link._reportStatus();            // steady state — no repeat
        lockdown = false;
        await link._reportStatus();            // falling edge

        const alerts = emissions.filter(e => e.name === ClusterEvents.NODE_ALERT).map(e => e.data);
        assert.deepEqual(alerts.map(a => a.type), ['ets:lockdown-engaged', 'ets:lockdown-lifted']);
        assert.equal(alerts[0].severity, 'critical');
        assert.equal(alerts[1].severity, 'info');
    });

    test('the fast flag watcher and the status reporter share one edge state (no double alerts)', async () => {
        let lockdown = false;
        globalAccessPoint.setValue('orionSystemsControl', makeSystemsControl({
            getSystemStatus: () => ({ safeMode: true, serverLocked: false, etsLockdown: lockdown, elmDegraded: false, memoryMonitor: null })
        }));
        const { link, emissions } = makeLink();

        await link._watchFlags();              // baseline via the watcher
        lockdown = true;
        await link._watchFlags();              // watcher catches the edge first
        await link._reportStatus();            // reporter must NOT re-alert

        const alerts = emissions.filter(e => e.name === ClusterEvents.NODE_ALERT);
        assert.equal(alerts.length, 1);
    });

    test('memory pressure edges use the configured threshold', async () => {
        let usage = 50;
        globalAccessPoint.setValue('orionSystemsControl', makeSystemsControl({
            getSystemStatus: () => ({ safeMode: true, serverLocked: false, etsLockdown: false, elmDegraded: false, memoryMonitor: { usagePercent: usage } })
        }));
        const { link, emissions } = makeLink({ memoryPressureThresholdPercent: 75 });

        await link._watchFlags();              // baseline
        usage = 80;
        await link._watchFlags();              // above threshold
        usage = 60;
        await link._watchFlags();              // recovered

        const alerts = emissions.filter(e => e.name === ClusterEvents.NODE_ALERT).map(e => e.data.type);
        assert.deepEqual(alerts, ['memory:pressure', 'memory:recovered']);
    });

    test('disconnected link does not attempt to report', async () => {
        const { link, emissions } = makeLink();
        link.connected = false;
        await link._reportStatus();
        assert.equal(emissions.length, 0);
    });
});

// ── Tunnel desync self-healing ────────────────────────────────────────────────

describe('ClusterLink — tunnel desync recovery', () => {
    test('re-registers after N consecutive delivery failures', async () => {
        const { link } = makeLink({ reRegisterAfterFailures: 3 });
        const causes = [];
        link._reRegisterTransport = async (cause) => { causes.push(cause); };

        link._trackEmitFailure();
        link._trackEmitFailure();
        assert.equal(causes.length, 0);
        link._trackEmitFailure();
        await new Promise(r => setImmediate(r));
        assert.equal(causes.length, 1);
        assert.match(causes[0], /3 consecutive delivery failures/);
    });

    test('a success resets the failure streak', async () => {
        const { link } = makeLink({ reRegisterAfterFailures: 3 });
        const causes = [];
        link._reRegisterTransport = async (cause) => { causes.push(cause); };

        link._trackEmitFailure();
        link._trackEmitFailure();
        link._trackEmitSuccess();
        link._trackEmitFailure();
        link._trackEmitFailure();
        await new Promise(r => setImmediate(r));
        assert.equal(causes.length, 0);
        assert.equal(link.getStats().consecutiveEmitFailures, 2);
    });

    test('failed deliveries feed the streak from real emit paths', async () => {
        const { link } = makeLink({ reRegisterAfterFailures: 2 });
        const causes = [];
        link._reRegisterTransport = async (cause) => { causes.push(cause); };
        link.rsync.emitToOrchestrator = async () => { throw new Error('403 signature rejected'); };

        await silenceConsole(async () => {
            await link._reportStatus();   // baseline flags + failed report = 1 failure
            await link._reportStatus();   // 2nd failure → re-register
        });
        await new Promise(r => setImmediate(r));

        assert.equal(causes.length, 1);
        assert.equal(link.getStats().statusReportFailures, 2);
    });
});

// ── Configuration guards ──────────────────────────────────────────────────────

describe('ClusterLink — configuration', () => {
    test('disabled link is a no-op on start', async () => {
        const link = new ClusterLinkSystem({});
        assert.equal(link.enabled, false);
        assert.equal(await link.start(), false);
    });

    test('enabling without a cluster name throws at construction', () => {
        assert.throws(() => new ClusterLinkSystem({ enabled: true }), /requires clusterLink.cluster/);
    });

    test('emitToOrchestrator passthrough requires a connection', async () => {
        const { link } = makeLink();
        link.connected = false;
        await assert.rejects(link.emitToOrchestrator('app:x', {}), /not connected/);
    });
});
