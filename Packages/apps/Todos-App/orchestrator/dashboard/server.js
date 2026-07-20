/**
 * Orion-Orchestrator observability + command dashboard.
 *
 * A dependency-free HTTP server (Node's built-in `http`) that shares the LIVE
 * OrionOrchestrator instance from start.js. Serves a single-page UI and a small
 * JSON API over the orchestrator's read methods and command surface.
 *
 * Protected by HTTP Basic Auth because command endpoints can lock the cluster.
 */
import http from 'http';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { ClusterCommands, ConsensusTopics } from '../../../../server/Orion-Orchestrator/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const timingSafeEqual = (a, b) => {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
};

const sendJson = (res, status, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
    res.end(payload);
};

const readBody = req =>
    new Promise(resolve => {
        let data = '';
        req.on('data', c => {
            data += c;
            if (data.length > 1_000_000) req.destroy();
        });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch {
                resolve({});
            }
        });
    });

/**
 * @param {import('../../../../server/Orion-Orchestrator/index.js').OrionOrchestrator} orchestrator
 * @param {{ port: number, username: string, password: string }} options
 */
export function startDashboard(orchestrator, { port, username, password }) {
    const checkAuth = req => {
        const header = req.headers['authorization'] || '';
        if (!header.startsWith('Basic ')) return false;
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const idx = decoded.indexOf(':');
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        return timingSafeEqual(user, username) && timingSafeEqual(pass, password);
    };

    const runAction = async payload => {
        const { kind, workerId, action, args = {}, topic } = payload;

        switch (kind) {
            case 'lock-cluster':
                return orchestrator.lockCluster();
            case 'unlock-cluster':
                return orchestrator.unlockCluster();
            case 'lock-node':
                return orchestrator.lockNode(workerId);
            case 'unlock-node':
                return orchestrator.unlockNode(workerId);
            case 'ping':
                return orchestrator.pingNode(workerId);
            case 'get-status':
                return orchestrator.getNodeStatus(workerId);
            case 'clear-ets':
                return orchestrator.clearNodeEtsLockdown(workerId);
            case 'declare-incident':
                return orchestrator.declareIncident('dashboard');
            case 'resolve-incident':
                return orchestrator.resolveIncident('dashboard');
            case 'consensus':
                return orchestrator.proposeConsensus(topic || ConsensusTopics.NODE_HEALTHY);
            case 'command':
                return orchestrator.command(workerId, action, args);
            case 'command-all':
                return orchestrator.commandAll(action, args);
            default:
                return { error: true, message: `Unknown action kind: ${kind}` };
        }
    };

    const server = http.createServer(async (req, res) => {
        if (!checkAuth(req)) {
            res.writeHead(401, {
                'WWW-Authenticate': 'Basic realm="Orion Orchestrator Dashboard"',
                'Content-Type': 'text/plain'
            });
            res.end('Authentication required');
            return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);

        try {
            if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                const html = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(html);
                return;
            }

            if (req.method === 'GET' && url.pathname === '/api/status') {
                return sendJson(res, 200, await orchestrator.getClusterStatus());
            }
            if (req.method === 'GET' && url.pathname === '/api/escalations') {
                return sendJson(res, 200, { escalations: orchestrator.getEscalations(50) });
            }
            if (req.method === 'GET' && url.pathname === '/api/commands') {
                return sendJson(res, 200, { commands: orchestrator.getCommandLog(50) });
            }
            if (req.method === 'GET' && url.pathname === '/api/consensus') {
                return sendJson(res, 200, { history: orchestrator.getConsensusHistory(10) });
            }
            if (req.method === 'GET' && url.pathname === '/api/policies') {
                return sendJson(res, 200, {
                    rules: orchestrator.getPolicyRules(),
                    outcomes: orchestrator.getPolicyOutcomes(20)
                });
            }
            if (req.method === 'GET' && url.pathname === '/api/meta') {
                return sendJson(res, 200, {
                    commands: ClusterCommands,
                    topics: ConsensusTopics
                });
            }

            if (req.method === 'POST' && url.pathname === '/api/action') {
                const payload = await readBody(req);
                const result = await runAction(payload);
                return sendJson(res, 200, { ok: true, result });
            }

            sendJson(res, 404, { error: true, message: 'Not found' });
        } catch (err) {
            sendJson(res, 500, { error: true, message: err.message });
        }
    });

    server.listen(port, () => {
        console.log(`Dashboard: http://localhost:${port} (Basic Auth: ${username})`);
    });

    return server;
}
