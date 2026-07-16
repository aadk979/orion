# Orion-Orchestrator (`orion-orch`) — Cluster Control Plane

> **Version:** 1.0.0 (Stable)
> **License:** MIT
> **Author:** Kalivaradhan Aadharsh

The Orion cluster control plane. Runs one orchestrator process per cluster and
supervises any number of **Orion-core** nodes over [R_Sync](../R_sync/README.md)
encrypted M2M tunnels (ECDH key exchange, AES-256-GCM payloads, Ed25519
signatures, replay protection — all inherited from the transport).

```
┌──────────────────────────────────────────────────────────────────────┐
│                   ORION-ORCHESTRATOR  (this package)                  │
│                                                                      │
│  ┌────────────┐ ┌──────────────┐ ┌────────────────┐ ┌─────────────┐  │
│  │ Policy     │ │ Consensus    │ │ ClusterHealth  │ │ Escalation  │  │
│  │ Engine     │ │ Engine       │ │ FORMING→HEALTHY│ │ Hub         │  │
│  │ alert →    │ │ fleet quorum │ │ →DEGRADED      │ │ log/webhook/│  │
│  │ reaction   │ │ votes        │ │ →INCIDENT      │ │ custom      │  │
│  └─────┬──────┘ └──────┬───────┘ └───────┬────────┘ └──────┬──────┘  │
│        └───────────────┴─────────┬───────┴─────────────────┘         │
│  ┌──────────────┐  ┌─────────────┴─────┐  ┌───────────────────────┐  │
│  │ NodeRegistry │  │ CommandDispatcher │  │ R_Sync ORCHESTRATOR   │  │
│  │ + disk       │  │ correlation +     │  │ (encrypted transport) │  │
│  │ persistence  │  │ timeouts + audit  │  │                       │  │
│  └──────────────┘  └───────────────────┘  └───────────┬───────────┘  │
└───────────────────────────────────────────────────────┼──────────────┘
                          encrypted HTTP (AES-256-GCM)  │
            ┌───────────────────────┬───────────────────┴───┐
            ▼                       ▼                       ▼
   ┌─────────────────┐    ┌─────────────────┐     ┌─────────────────┐
   │  ORION-CORE #1  │    │  ORION-CORE #2  │     │  ORION-CORE #N  │
   │ ClusterLink-    │    │ ClusterLink-    │     │ ClusterLink-    │
   │ System (worker) │    │ System (worker) │     │ System (worker) │
   │ ↕ SystemsControl│    │ ↕ SystemsControl│     │ ↕ SystemsControl│
   └─────────────────┘    └─────────────────┘     └─────────────────┘
```

## How the pieces fit

| Layer | Package | Role |
|-------|---------|------|
| Transport | `r-sync` | Encrypted, authenticated, replay-protected event delivery between one ORCHESTRATOR and N WORKERs |
| Protocol | `orion-orch/protocol` | The application contract: event names, command allowlist, consensus topics, cluster states, envelope shapes. Imported by BOTH sides so they can never drift apart |
| Control plane | `orion-orch` | `OrionOrchestrator` — registry, command dispatch, policies, consensus, health, escalations |
| Node agent | Orion-core `ClusterLinkSystem` | Embeds an R_Sync WORKER inside each Orion-core service; reports status, raises alerts the moment flags flip, executes allowlisted commands, casts consensus ballots, self-heals desynced tunnels |

Redis-backed **cluster mode** in Orion-core (shared signing-key fan-out via the
secrets managers) is complementary and independent: cluster mode shares *data*,
the orchestrator link shares *control and observability*. A production cluster
typically runs both.

## What flows over the wire

### Node → Orchestrator

| Event | When | Orchestrator reaction |
|-------|------|----------------------|
| `orion:node:hello` | on join, re-registration, and identify requests | registry records identity; NODE_RECOVERED raised if the node was offline |
| `orion:node:status` | every `statusReportIntervalMs` (default 60s) — full `getSystemStatus()` + process telemetry | registry updated; feeds ClusterHealth |
| `orion:node:alert` | the MOMENT an operational flag flips (fast watcher, default 2s cadence): ETS lockdown, event-loop degradation, server lock, memory pressure, tunnel resync | PolicyEngine runs the matching rules (verify → escalate → optional remediation) |
| `orion:node:goodbye` | graceful shutdown | node marked offline instantly |
| `orion:command:result` | reply to any command | resolves the awaiting `command()` promise |

### Orchestrator → Node

| Event | Purpose |
|-------|---------|
| `orion:command` | allowlisted remote command (see table below) |
| `orion:cluster:state` | broadcast on every health transition — each node stores it in its GAP (`globalAccessPoint.clusterState()`), so the whole fleet shares one health view |

### Orchestrator-internal signals

| Signal | Source |
|--------|--------|
| `node:stale` alert | stale sweep — node silent past `nodeStaleAfterSeconds` |
| `node:recovered` alert | any authenticated traffic from an offline node |
| `cluster:state-changed` escalation | ClusterHealth transitions (INCIDENT entry consensus-confirmed) |

## Quick start

### 1. Orchestrator process

```javascript
import { OrionOrchestrator, ClusterCommands, ConsensusTopics } from 'orion-orch';

const orch = new OrionOrchestrator({
    cluster: 'orion-prod',           // required — nodes must present the same name
    publicIp: '10.0.0.5',
    port: 55321,

    nodeStaleAfterSeconds: 120,
    healthEvaluationIntervalMs: 15_000,
    confirmIncidentViaConsensus: true,

    escalations: {
        webhook: { url: 'https://ops.example.com/hooks/orion', headers: { 'x-api-key': '...' } }
    },
    persistence: { enabled: true },  // registry survives orchestrator restarts

    policies: {
        // Defaults cover every alert type; add your own on top:
        rules: [{
            id: 'auto-clear-lockdown-after-10m',
            on: ['ets:lockdown-engaged'],
            cooldownSec: 900,
            actions: [{
                type: 'schedule-command',
                delaySec: 600,
                action: ClusterCommands.CLEAR_ETS_LOCKDOWN,
                onlyIfStatusFlag: 'etsLockdown'   // re-checks before firing
            }]
        }]
    }
});

orch.addEscalationChannel('pagerduty', async (e) => { /* your notifier */ });
orch.onClusterStateChange((state, prev, evaluation) => console.log(`${prev} → ${state}`, evaluation));

await orch.start();
```

### 2. Each Orion-core node

Enable the cluster link in the node's `systemConfig`:

```javascript
utilities: {
    clusterLink: {
        enabled: true,
        cluster: 'orion-prod',
        orchestratorIp: '10.0.0.5',
        orchestratorPort: 55321,
        publicIp: '10.0.0.21',            // address the orchestrator reaches this node on
        port: 55322,                      // node's M2M port (separate from the public API port)
        statusReportIntervalMs: 60_000,
        flagWatchIntervalMs: 2_000,       // alert latency ceiling
        memoryPressureThresholdPercent: 80,
        reRegisterAfterFailures: 3,       // tunnel desync self-healing
        allowRemoteControl: true,
        requireOrchestrator: false        // true = node refuses to boot without the orchestrator
    }
}
```

`initiateServer()` starts the link automatically. With `requireOrchestrator:
false` (default) an unreachable orchestrator never blocks the node:
registration retries in the background with exponential backoff (5s → 5m)
while the node serves auth traffic normally.

### 3. Operate the cluster

```javascript
// Merged cluster view: transport + application + health + escalations
const status = await orch.getClusterStatus();

// Awaitable remote commands
await orch.command(workerId, ClusterCommands.GET_STATUS);
await orch.command(workerId, ClusterCommands.SET_MAX_IN_FLIGHT, { limit: 500 });

// Cluster-wide (never rejects; per-node failures are in the result array)
await orch.lockCluster();                 // emergency: reject all API traffic fleet-wide
await orch.unlockCluster();
await orch.addClientUrls(['https://new-frontend.example']);   // runtime config propagation

// Fleet consensus — decisions backed by every node's LOCAL view
const vote = await orch.proposeConsensus(ConsensusTopics.NODE_HEALTHY);
// { decided, accepted, eligible, responded, yes, no, ratio, votes: [...] }

// Manual incident control
await orch.declareIncident('DB region failover in progress');
await orch.resolveIncident('failover complete');

// Observability surfaces
orch.getClusterHealth();      // state machine snapshot
orch.getEscalations();        // notification history
orch.getConsensusHistory();   // past proposals + ballots
orch.getPolicyOutcomes();     // which rules ran, what they did
orch.getCommandLog();         // audit ring of every issued command
```

## Configuration Reference — `OrionOrchestrator`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `cluster` | `string` | — (required) | Cluster name; nodes must match it to register |
| `publicIp` / `port` | `string`/`number` | `127.0.0.1` / `55321` | Orchestrator M2M address |
| `encryptionAlg` | `string` | `ECC_256` | `ECC_256` / `ECC_384` / `ECC_521` (must match nodes) |
| `trustAdvertisedWorkerIp` | `boolean` | `false` | See R_Sync docs — leave false unless nodes are behind NAT |
| `nodeStaleAfterSeconds` | `number` | `120` | Node flagged offline (`node:stale`) after this silence |
| `staleSweepIntervalMs` | `number` | `30000` | Stale-check frequency |
| `commandTimeoutMs` | `number` | `10000` | Default await window for commands |
| `healthEvaluationIntervalMs` | `number` | `15000` | ClusterHealth evaluation cadence |
| `confirmIncidentViaConsensus` | `boolean` | `true` | INCIDENT entry requires a failed NODE_HEALTHY fleet vote (an unreachable fleet still counts as an incident) |
| `identifyOnStart` | `boolean` | `true` | Ask nodes with live tunnels to re-send identity after an orchestrator restart |
| `health` | `object` | `{}` | `{ incidentRatio: 0.5, minUnhealthyForIncident: 2, statusMaxAgeSeconds: 300 }` |
| `consensus` | `object` | `{}` | Default `{ quorumRatio: 0.5, minVoters: 1, timeoutMs: 8000 }` for proposals |
| `policies` | `object` | `{}` | `{ useDefaults: true, rules: [...] }` — see PolicyEngine |
| `escalations` | `object` | `{}` | `{ webhook: { url, headers } }` — log channel is always on |
| `persistence` | `object` | `{ enabled: true }` | `{ enabled, directory, fileName, debounceMs }` — registry file `orion_orch.internal.registry.json` |

## Configuration Reference — Orion-core `utilities.clusterLink`

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Master switch |
| `cluster` | `string` | — | Required when enabled |
| `orchestratorIp` / `orchestratorPort` | `string`/`number` | `127.0.0.1` / `55321` | Where the orchestrator lives |
| `publicIp` / `port` | `string`/`number` | `127.0.0.1` / `55322` | This node's M2M callback address |
| `encryptionAlg` | `string` | `ECC_256` | Must match the orchestrator |
| `heartbeatIntervalMs` | `number` | `30000` | Transport-level liveness |
| `statusReportIntervalMs` | `number` | `60000` | Application-level status snapshots |
| `flagWatchIntervalMs` | `number` | `2000` | Fast operational-flag watcher (alert latency ceiling); `0` disables |
| `memoryPressureThresholdPercent` | `number` | `80` | System memory % at which the node reports pressure |
| `reRegisterAfterFailures` | `number` | `3` | Consecutive delivery failures before full tunnel re-registration; `0` disables |
| `allowRemoteControl` | `boolean` | `true` | Master gate for executing orchestrator commands |
| `requireOrchestrator` | `boolean` | `false` | Fail the Orion boot if registration fails |

## Command allowlist

Every action maps 1:1 onto a node capability:

| Action | Args | Safe-mode gated |
|--------|------|-----------------|
| `node:ping` | — | no |
| `node:identify` | — | no |
| `status:get` | — | no |
| `consensus:vote` | `{ topic, params? }` | no (read-only evaluation) |
| `server:lock` / `server:unlock` | — | no |
| `ets:clear-lockdown` | — | **yes** |
| `security:deactivate` / `security:reactivate` | `{ system }` | **yes** |
| `audit:pause` / `audit:resume` | — | **yes** |
| `circuit:open` | `{ dependency }` | no |
| `circuit:reset` | `{ dependency }` | **yes** |
| `load:set-max-in-flight` | `{ limit }` | **yes** |
| `abuse:unblock-actor` | `{ actorId }` | **yes** |
| `config:client-urls:add` | `{ clientUrls }` | gated by the node's `clientUrls.runTimeUpdateAllowed` boot flag |
| `memory-monitor:start/stop` | — | no |
| `event-loop-monitor:start/stop` | — | no |

## Consensus topics

A vote asks every node to evaluate a predicate against its **local** view; the
engine tallies ballots against a quorum measured over **eligible** voters, so
silent nodes make acceptance harder, never easier. A mostly-unreachable fleet
yields `decided: false` — never a fake rejection.

| Topic | A node votes true when… |
|-------|------------------------|
| `node-healthy` | no lockdown, no ELM degradation, no memory pressure, not locked |
| `ets-lockdown` | it is in ETS lockdown |
| `elm-degraded` | its event loop is degraded |
| `memory-pressure` | memory usage ≥ threshold (`params.thresholdPercent`) |
| `abuse-high` | ≥ `params.minBlocked` actors currently blocked |

## Policy engine

Declarative rules run on every alert. Action types: `escalate`,
`verify-status` (attaches a confirmed snapshot to the escalation),
`command`, `consensus`, and `schedule-command` (delayed remediation that
re-checks the condition before firing, so it never races an operator).
Per-(rule, node) cooldowns stop alert storms. `DEFAULT_POLICIES` covers every
protocol alert type with observability-first reactions; auto-remediation is
opt-in — and node-side safe mode always has the final say.

## Cluster health lifecycle

```
FORMING ──first nodes──▶ HEALTHY ◀──────────────┐
                            │ any unhealthy node │ all healthy
                            ▼                    │
                        DEGRADED ────────────────┘
                            │ ≥ incidentRatio unhealthy (and ≥ minUnhealthyForIncident)
                            │ + fleet consensus fails to affirm NODE_HEALTHY
                            ▼
                        INCIDENT  ── every transition: escalated + broadcast to all nodes
```

Unhealthy = offline, ETS lockdown, ELM degraded, or status snapshot older than
`statusMaxAgeSeconds`. Manual overrides: `declareIncident()` / `resolveIncident()`.

## Security model

Remote control is **triple-gated**:

1. **Transport** — commands only arrive over an R_Sync tunnel: ECDH-derived
   AES-256-GCM encryption, Ed25519 payload signatures, replay/dedup guards.
   Only the orchestrator that a node registered with can address it.
2. **Node allowlist** — `allowRemoteControl: false` rejects every command with
   `REMOTE_CONTROL_DISABLED`; unknown actions are rejected with
   `UNKNOWN_COMMAND` before touching anything. There is no eval-style escape
   hatch: only the fixed action table above exists.
3. **Safe mode** — Orion's `OrionSystemsControl` safe mode still applies. A
   safe-mode refusal reports `{ applied: false }` back to the orchestrator; the
   orchestrator cannot override it remotely (by design — it requires a config
   change and restart on the node).

Command results are additionally bound to the issuing node: a
`orion:command:result` arriving from a different worker than the command was
sent to is discarded (impersonation guard in `CommandDispatcher`).

Failure-mode guarantees:

- **Node loses the orchestrator** → keeps serving, retries registration with
  backoff; on repeated delivery failures it re-registers the tunnel from
  scratch under its persistent identity key and raises `tunnel:resynced`.
- **Orchestrator restarts** → registry rehydrated from disk (nodes marked
  offline until they prove liveness), then an identify sweep over still-live
  tunnels rebuilds current state within seconds.
- **Fleet partition** → consensus returns *undecided* rather than guessing;
  undecided incident-confirmation counts FOR the incident, because a silent
  fleet is exactly what an incident looks like.

> ⚠️ R_Sync's built-in `system:flush` (localhost-only endpoint on the
> orchestrator) wipes tunnel state on ALL nodes and **exits their processes**.
> With embedded workers that means killing the Orion-core services. Don't use
> it on a live cluster unless that is exactly what you want.

## Files

```
Orion-Orchestrator/
├── index.js                  # Package exports
├── lib/
│   ├── OrionOrchestrator.js  # Control plane — wires every subsystem
│   ├── PolicyEngine.js       # Alert → reaction rules (+ DEFAULT_POLICIES)
│   ├── ConsensusEngine.js    # Fleet quorum votes
│   ├── ClusterHealth.js      # FORMING/HEALTHY/DEGRADED/INCIDENT state machine
│   ├── EscalationHub.js      # Pluggable notification channels + history
│   ├── CommandDispatcher.js  # Request/response over one-way events
│   ├── NodeRegistry.js       # Application-level cluster registry
│   ├── RegistryStore.js      # Crash-safe registry persistence
│   ├── protocol.js           # Shared wire contract (exported as orion-orch/protocol)
│   └── orch.meta.js          # Version metadata
└── examples/
    └── orchestrator.example.js
```

## Tests

Covered by the repository suite (`Testing/`):

```bash
cd Testing
node --test "suites/server/orchestrator/*.test.js"
```

`protocol`, `CommandDispatcher`, `NodeRegistry`, `RegistryStore`,
`PolicyEngine`, `ConsensusEngine`, `ClusterHealth`, `EscalationHub`, and the
node-side `ClusterLinkSystem` are unit-tested; the full orchestrator ↔ node
production loop (registration, immediate alerts, policy reactions, consensus,
health transitions, state broadcast, persistence) is verified with a live
two-process harness.
