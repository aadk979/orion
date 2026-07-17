import { OrionOrchestrator } from '../../../server/Orion-Orchestrator/index.js';
import { startDashboard } from './dashboard/server.js';

const CLUSTER = 'todos-demo';
const PORT = 55321;
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT) || 8090;
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'orion-admin';

const orchestrator = new OrionOrchestrator({
    cluster: CLUSTER,
    publicIp: '127.0.0.1',
    port: PORT,
    encryptionAlg: 'ECC_256',
    nodeStaleAfterSeconds: 120
});

orchestrator
    .onNodeHello((workerId, hello) => {
        console.log(`[hello] ${workerId} -> ${hello?.appName} (orion v${hello?.orionVersion})`);
    })
    .onNodeAlert((workerId, alert) => {
        console.log(`[ALERT:${alert?.severity}] ${workerId} -> ${alert?.type}`, alert?.details || {});
    })
    .onNodeGoodbye((workerId, data) => {
        console.log(`[goodbye] ${workerId} -> ${data?.reason}`);
    })
    .onClusterStateChange((state, previous, evaluation) => {
        console.log(`[health] ${previous} -> ${state} (${evaluation?.unhealthy?.length ?? 0} unhealthy)`);
    });

await orchestrator.start();

console.log(`Orion-Orchestrator up — cluster "${CLUSTER}" listening on port ${PORT}`);

startDashboard(orchestrator, {
    port: DASHBOARD_PORT,
    username: DASHBOARD_USER,
    password: DASHBOARD_PASSWORD
});

setInterval(async () => {
    const status = await orchestrator.getClusterStatus();
    console.log(
        `[cluster] ${status.health.state} - ${status.summary.online}/${status.summary.total} online, ${status.summary.unhealthy} unhealthy`
    );
}, 30_000);
