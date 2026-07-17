'use client';

/**
 * Dashboard — cluster health, fleet summary, node list with per-node command
 * execution. Everything shown/done here is PBAC-checked server-side; a 403
 * simply surfaces as the policy denial it is.
 */

import { useCallback, useEffect, useState } from 'react';
import Shell from '../components/Shell';
import { get, post, fmtTime, ApiError } from '../lib/api';

const stateBadge = (state) => {
    const cls = { HEALTHY: 'ok', FORMING: 'info', DEGRADED: 'warn', INCIDENT: 'crit' }[state] || 'dim';
    return <span className={`badge ${cls}`}>{state || 'UNKNOWN'}</span>;
};

function NodeRow({ node, commands, onResult }) {
    const [action, setAction] = useState('node:ping');
    const [busy, setBusy] = useState(false);

    const runCommand = async () => {
        setBusy(true);
        try {
            const result = await post(`/api/cluster/nodes/${encodeURIComponent(node.workerId)}/command`, { action });
            onResult({ workerId: node.workerId, action, ...result.outcome });
        } catch (err) {
            onResult({ workerId: node.workerId, action, denied: true, message: err instanceof ApiError ? `${err.code}: ${err.message}` : err.message });
        } finally {
            setBusy(false);
        }
    };

    return (
        <tr>
            <td className="mono">{node.workerId}</td>
            <td>{node.identity?.appName || node.hello?.appName || '—'}</td>
            <td>{node.online ? <span className="badge ok">online</span> : <span className="badge crit">offline</span>}</td>
            <td>{node.unhealthyReason ? <span className="badge warn">{node.unhealthyReason}</span> : <span className="badge ok">healthy</span>}</td>
            <td className="mono">{fmtTime(node.lastSeen)}</td>
            <td>
                <div className="row">
                    <select value={action} onChange={e => setAction(e.target.value)} style={{ width: 'auto' }}>
                        {commands.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button className="small" disabled={busy} onClick={runCommand}>Run</button>
                </div>
            </td>
        </tr>
    );
}

export default function Dashboard() {
    const [status, setStatus] = useState(null);
    const [commands, setCommands] = useState([]);
    const [error, setError] = useState(null);
    const [lastOutcome, setLastOutcome] = useState(null);

    const refresh = useCallback(() => {
        get('/api/cluster/status')
            .then(r => { setStatus(r.status); setError(null); })
            .catch(err => setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message));
        get('/api/cluster/commands')
            .then(r => setCommands(r.commands))
            .catch(() => setCommands(['node:ping', 'status:get', 'server:lock', 'server:unlock']));
    }, []);

    useEffect(() => {
        refresh();
        const timer = setInterval(refresh, 15_000);
        return () => clearInterval(timer);
    }, [refresh]);

    return (
        <Shell>
            <h1>Cluster dashboard</h1>
            <p className="sub">{status ? <>Cluster <b>{status.cluster}</b> · protocol v{status.protocolVersion} · generated {fmtTime(status.generatedAt)}</> : 'Loading…'}</p>

            {error && <div className="msg error">{error}</div>}

            {status && (
                <>
                    <div className="cards">
                        <div className="card"><div className="label">Health</div><div className="value">{stateBadge(status.health?.state)}</div></div>
                        <div className="card"><div className="label">Nodes</div><div className="value">{status.summary.total}</div></div>
                        <div className="card"><div className="label">Online</div><div className="value">{status.summary.online}</div></div>
                        <div className="card"><div className="label">Unhealthy</div><div className="value">{status.summary.unhealthy}</div></div>
                        <div className="card"><div className="label">Pending cmds</div><div className="value">{status.summary.pendingCommands}</div></div>
                    </div>

                    <h2>Fleet</h2>
                    <div className="panel table-wrap">
                        <table>
                            <thead>
                                <tr><th>Worker</th><th>App</th><th>Link</th><th>Health</th><th>Last seen</th><th>Command</th></tr>
                            </thead>
                            <tbody>
                                {status.nodes.length === 0 && <tr><td colSpan={6} className="sub">No nodes have registered yet.</td></tr>}
                                {status.nodes.map(node => (
                                    <NodeRow key={node.workerId} node={node} commands={commands} onResult={setLastOutcome} />
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {lastOutcome && (
                        <>
                            <h2>Last command result</h2>
                            <pre className="json">{JSON.stringify(lastOutcome, null, 2)}</pre>
                        </>
                    )}
                </>
            )}
        </Shell>
    );
}
