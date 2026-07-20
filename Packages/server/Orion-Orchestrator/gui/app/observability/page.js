'use client';

/**
 * Observability — read surfaces: escalations, consensus history, policy
 * engine rules/outcomes, command log.
 */

import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { get, fmtTime, ApiError } from '../../lib/api';

const TABS = [
    { id: 'escalations', label: 'Escalations', path: '/api/cluster/escalations?limit=100', key: 'escalations' },
    { id: 'consensus', label: 'Consensus history', path: '/api/cluster/consensus-history?limit=25', key: 'history' },
    { id: 'rules', label: 'Policy rules', path: '/api/cluster/policy-rules', key: 'rules' },
    { id: 'outcomes', label: 'Policy outcomes', path: '/api/cluster/policy-outcomes?limit=50', key: 'outcomes' },
    { id: 'commands', label: 'Command log', path: '/api/cluster/command-log?limit=100', key: 'commandLog' }
];

export default function Observability() {
    const [tab, setTab] = useState(TABS[0]);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        setData(null);
        setError(null);
        get(tab.path)
            .then(r => setData(r[tab.key]))
            .catch(err => setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message));
    }, [tab]);

    return (
        <Shell>
            <h1>Observability</h1>
            <p className="sub">Escalation, consensus, policy-engine, and command-plane history from the orchestrator.</p>

            <div className="tabs">
                {TABS.map(t => (
                    <button key={t.id} className={tab.id === t.id ? 'active' : ''} onClick={() => setTab(t)}>
                        {t.label}
                    </button>
                ))}
            </div>

            {error && <div className="msg error">{error}</div>}
            {!error && data === null && <p className="sub">Loading…</p>}

            {tab.id === 'commands' && Array.isArray(data) && (
                <div className="panel table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>At</th>
                                <th>Worker</th>
                                <th>Action</th>
                                <th>Issued by</th>
                                <th>OK</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="sub">
                                        No commands issued yet.
                                    </td>
                                </tr>
                            )}
                            {[...data].reverse().map((entry, i) => (
                                <tr key={i}>
                                    <td className="mono">{fmtTime(entry.at)}</td>
                                    <td className="mono">{entry.workerId}</td>
                                    <td className="mono">{entry.action}</td>
                                    <td className="mono">{entry.issuedBy || 'system'}</td>
                                    <td>{entry.ok ? <span className="badge ok">ok</span> : <span className="badge crit">failed</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {tab.id !== 'commands' && data !== null && (
                <pre className="json" style={{ maxHeight: 600 }}>
                    {JSON.stringify(data, null, 2)}
                </pre>
            )}
        </Shell>
    );
}
