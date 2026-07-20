'use client';

/**
 * Operations — mutating cluster actions. Each button maps 1:1 to a PBAC
 * action; whether THIS admin can press it is decided by their policy on the
 * server, never in the UI.
 */

import { useState } from 'react';
import Shell from '../../components/Shell';
import { post, ApiError } from '../../lib/api';

export default function Operations() {
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [reason, setReason] = useState('');
    const [topic, setTopic] = useState('node-healthy');
    const [urls, setUrls] = useState('');
    const [cmdAllAction, setCmdAllAction] = useState('node:ping');

    const run = (label, fn) => async () => {
        setBusy(true);
        setError(null);
        try {
            const payload = await fn();
            setResult({ label, payload });
        } catch (err) {
            setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <Shell>
            <h1>Cluster operations</h1>
            <p className="sub">Every action below is evaluated against your attached policy and lands in the immutable audit trail.</p>

            {error && <div className="msg error">{error}</div>}

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Emergency traffic control</h2>
                <div className="row">
                    <button className="danger" disabled={busy} onClick={run('Lock cluster', () => post('/api/cluster/lock'))}>
                        Lock cluster (reject all API traffic)
                    </button>
                    <button disabled={busy} onClick={run('Unlock cluster', () => post('/api/cluster/unlock'))}>
                        Unlock cluster
                    </button>
                </div>
            </div>

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Incident control</h2>
                <label className="field">
                    <span>Reason</span>
                    <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. DB region failover in progress" />
                </label>
                <div className="row">
                    <button className="danger" disabled={busy} onClick={run('Declare incident', () => post('/api/cluster/incident/declare', { reason }))}>
                        Declare INCIDENT
                    </button>
                    <button className="ghost" disabled={busy} onClick={run('Resolve incident', () => post('/api/cluster/incident/resolve', { reason }))}>
                        Resolve incident
                    </button>
                </div>
            </div>

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Fleet consensus</h2>
                <div className="row">
                    <select value={topic} onChange={e => setTopic(e.target.value)} style={{ width: 'auto' }}>
                        {['node-healthy', 'ets-lockdown', 'elm-degraded', 'memory-pressure', 'abuse-high'].map(t => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                    <button disabled={busy} onClick={run(`Consensus: ${topic}`, () => post('/api/cluster/consensus', { topic }))}>
                        Propose vote
                    </button>
                </div>
            </div>

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Cluster-wide command</h2>
                <label className="field">
                    <span>Action (allowlisted node command)</span>
                    <input className="mono" value={cmdAllAction} onChange={e => setCmdAllAction(e.target.value)} />
                </label>
                <button disabled={busy} onClick={run(`Command-all: ${cmdAllAction}`, () => post('/api/cluster/command-all', { action: cmdAllAction }))}>
                    Run on every node
                </button>
            </div>

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Runtime client URLs</h2>
                <label className="field">
                    <span>URLs (comma-separated)</span>
                    <input className="mono" value={urls} onChange={e => setUrls(e.target.value)} placeholder="https://new-frontend.example.com" />
                </label>
                <button
                    disabled={busy || !urls.trim()}
                    onClick={run('Add client URLs', () =>
                        post('/api/cluster/client-urls', {
                            clientUrls: urls
                                .split(',')
                                .map(u => u.trim())
                                .filter(Boolean)
                        })
                    )}
                >
                    Propagate to fleet
                </button>
            </div>

            {result && (
                <>
                    <h2>{result.label} — result</h2>
                    <pre className="json">{JSON.stringify(result.payload, null, 2)}</pre>
                </>
            )}
        </Shell>
    );
}
