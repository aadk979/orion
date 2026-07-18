import { OrionOrchestrator } from '../../../server/Orion-Orchestrator/index.js';
import { startDashboard } from './dashboard/server.js';

const CLUSTER = 'todos-demo';
const PORT = 55321;
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT) || 8090;
const DASHBOARD_USER = process.env.DASHBOARD_USER || 'admin';
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'orion-admin';

// The PBAC system-admin plane (panel + API + CLI). Enabled via env so no
// secrets live in the committed file — DB/mail creds are supplied at launch
// (reusing the worker Postgres + Gmail credentials in this deployment). See
// Orion-Orchestrator README § System-admin plane.
const SYSTEM_ADMIN_ENABLED = process.env.SYSTEM_ADMIN_ENABLED === 'true';

const systemAdmin = SYSTEM_ADMIN_ENABLED
    ? {
        enabled: true,
        database: {
            host: process.env.SA_DB_HOST || '127.0.0.1',
            port: Number(process.env.SA_DB_PORT) || 5432,
            database: process.env.SA_DB_NAME,
            user: process.env.SA_DB_USER,
            password: process.env.SA_DB_PASSWORD
        },
        rootAdmin: {
            email: process.env.SA_ROOT_EMAIL,
            initialPassword: process.env.SA_ROOT_PASSWORD
        },
        http: {
            host: process.env.SA_HTTP_HOST || '0.0.0.0',
            port: Number(process.env.SA_HTTP_PORT) || 55330,
            // Behind a TLS-terminating proxy (cloudflared) the browser sees
            // HTTPS, so Secure cookies + trusting the forwarded IP are correct.
            secureCookies: process.env.SA_SECURE_COOKIES !== 'false',
            trustProxy: process.env.SA_TRUST_PROXY === 'true'
        },
        baseUrl: process.env.SA_BASE_URL || null,
        mail: process.env.SA_MAIL_EMAIL
            ? {
                service: process.env.SA_MAIL_SERVICE || 'gmail',
                email: process.env.SA_MAIL_EMAIL,
                password: process.env.SA_MAIL_PASSWORD,
                from: process.env.SA_MAIL_FROM || process.env.SA_MAIL_EMAIL,
                appName: process.env.SA_MAIL_APPNAME || 'Orion Orchestrator (Todos Demo)'
            }
            : {}
    }
    : { enabled: false };

const orchestrator = new OrionOrchestrator({
    cluster: CLUSTER,
    publicIp: '127.0.0.1',
    port: PORT,
    encryptionAlg: 'ECC_256',
    nodeStaleAfterSeconds: 120,
    systemAdmin
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

if (SYSTEM_ADMIN_ENABLED) {
    console.log(
        `System-admin plane (PBAC panel + API) up on port ${systemAdmin.http.port} — ` +
        `root: ${systemAdmin.rootAdmin.email}${systemAdmin.baseUrl ? `, panel: ${systemAdmin.baseUrl}` : ''}`
    );
}

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
