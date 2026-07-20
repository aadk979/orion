/**
 * Runnable Orion-Orchestrator demo.
 *
 * Start this first, then boot one or more Orion-core services with
 * `utilities.clusterLink.enabled = true` pointing at this host/port.
 */

import { OrionOrchestrator, ClusterCommands, ConsensusTopics } from '../index.js';

const orchestrator = new OrionOrchestrator({
    cluster: 'orion-demo',
    publicIp: '127.0.0.1',
    port: 55321,
    encryptionAlg: 'ECC_256',
    nodeStaleAfterSeconds: 120,

    // Optional: push escalations to an ops webhook (log channel is always on)
    // escalations: { webhook: { url: 'https://ops.example.com/hooks/orion' } },

    // Optional: opt-in auto-remediation on top of the default policies
    policies: {
        rules: [
            {
                id: 'demo-auto-clear-lockdown',
                on: ['ets:lockdown-engaged'],
                cooldownSec: 900,
                actions: [
                    {
                        type: 'schedule-command',
                        delaySec: 600,
                        action: ClusterCommands.CLEAR_ETS_LOCKDOWN,
                        onlyIfStatusFlag: 'etsLockdown' // re-checked right before firing
                    }
                ]
            }
        ]
    }

    // Optional: the PBAC system-admin plane — orch panel (GUI), /api, and the
    // `orionctl` CLI. Uncomment and fill in to enable. See README §System-admin plane.
    // systemAdmin: {
    //     enabled: true,
    //     database: {                       // shared Postgres, ORCH credentials (read-write)
    //         host: '127.0.0.1',
    //         port: 5432,
    //         database: 'orion',
    //         user: 'orion_orch',
    //         password: '...'
    //     },
    //     rootAdmin: {                      // consumed on FIRST boot only
    //         email: 'root@example.com',
    //         initialPassword: 'change-me-immediately'  // rotation forced on first login
    //     },
    //     http: { host: '0.0.0.0', port: 55330, secureCookies: true, theme: 'modern' },
    //     // theme: panel look — 'modern' (default, light/Apple-style) or
    //     // 'classic' (dense MySQL Workbench-style). Env ORION_GUI_THEME sets
    //     // it too; this key wins. Applied at startup — restart, no rebuild.
    //     baseUrl: 'https://orch.example.com',           // magic-link target (this panel's own URL)
    //     mail: {                           // omit entirely for console-mode links (dev)
    //         service: 'gmail',
    //         email: 'ops@example.com',
    //         password: 'app-password',
    //         appName: 'Orion Orchestrator'
    //     }
    // }
});

orchestrator
    .onNodeHello((workerId, hello) => {
        console.log(`[hello] ${workerId} → ${hello?.appName} (orion v${hello?.orionVersion})`);
    })
    .onNodeAlert((workerId, alert) => {
        console.log(`[ALERT:${alert?.severity}] ${workerId} → ${alert?.type}`, alert?.details || {});
    })
    .onNodeGoodbye((workerId, data) => {
        console.log(`[goodbye] ${workerId} → ${data?.reason}`);
    })
    .onClusterStateChange((state, previous, evaluation) => {
        console.log(`[health] ${previous} → ${state} (${evaluation?.unhealthy?.length ?? 0} unhealthy)`);
    });

// Custom escalation channel (Slack/PagerDuty/etc. would go here)
orchestrator.addEscalationChannel('console', e => {
    console.log(`[escalation:${e.severity}] ${e.type}: ${e.message}`);
});

await orchestrator.start();

// Every 60s: print the merged cluster view and run a fleet health vote
setInterval(async () => {
    const status = await orchestrator.getClusterStatus();
    console.log(`[cluster] ${status.health.state} — ${status.summary.online}/${status.summary.total} online, ${status.summary.unhealthy} unhealthy`);

    if (status.summary.online > 0) {
        const vote = await orchestrator.proposeConsensus(ConsensusTopics.NODE_HEALTHY);
        console.log(`[consensus] node-healthy: decided=${vote.decided} accepted=${vote.accepted} (${vote.yes}/${vote.eligible})`);
    }
}, 60_000);
