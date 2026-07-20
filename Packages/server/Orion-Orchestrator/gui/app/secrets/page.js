'use client';

/**
 * Signing keys — fleet-wide signing/verification key inventory with immediate
 * revocation. Revoking a kid broadcasts it to every node: the owner
 * decommissions the pair and rotates in a replacement, everyone else wipes it
 * from their verification pool, and the kid is deleted from the shared Redis
 * fan-out — no further signing or verification anywhere. Whether THIS admin
 * may revoke is decided by their PBAC policy on the server, never in the UI.
 */

import { useCallback, useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { get, post, fmtTime, ApiError } from '../../lib/api';

export default function Secrets() {
    const [nodes, setNodes] = useState(null);
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null);

    const load = useCallback(() => {
        setError(null);
        get('/api/cluster/secrets/keys')
            .then(r => setNodes(r.nodes))
            .catch(err => setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message));
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const run = (label, fn) => async () => {
        setBusy(true);
        setError(null);
        try {
            const payload = await fn();
            setResult({ label, payload });
            load();
        } catch (err) {
            setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message);
        } finally {
            setBusy(false);
        }
    };

    const revokeKid = kid => {
        if (!window.confirm(`Revoke kid ${kid} across the ENTIRE fleet?\n\nIts owner rotates in a replacement; every node stops verifying its signatures immediately.`)) return;
        run(`Revoke ${kid}`, () => post('/api/cluster/secrets/revoke', { kids: [kid] }))();
    };

    const rotateNode = workerId => {
        if (!window.confirm(`Decommission ALL signing keys on ${workerId}?\n\nEvery active signing pair on that node is revoked fleet-wide and regenerated.`)) return;
        run(`Rotate all keys on ${workerId}`, () => post('/api/cluster/secrets/rotate-node', { workerId }))();
    };

    return (
        <Shell>
            <h1>Signing keys</h1>
            <p className="sub">
                Active (non-expired) signing keys per node. Revocation is immediate and fleet-wide: signing stops on the owner, verification stops
                everywhere, and the public key is wiped from Redis.
            </p>

            <div className="row" style={{ marginBottom: 16 }}>
                <button className="ghost" disabled={busy} onClick={load}>
                    Refresh inventory
                </button>
            </div>

            {error && <div className="msg error">{error}</div>}
            {!error && nodes === null && <p className="sub">Loading…</p>}
            {Array.isArray(nodes) && nodes.length === 0 && <p className="sub">No reachable nodes.</p>}

            {Array.isArray(nodes) &&
                nodes.map(node => (
                    <div className="panel" key={node.workerId}>
                        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ margin: 0 }} className="mono">
                                {node.workerId}
                            </h2>
                            {node.ok ? (
                                <button className="danger" disabled={busy} onClick={() => rotateNode(node.workerId)}>
                                    Rotate ALL keys on this node
                                </button>
                            ) : (
                                <span className="badge crit">unreachable</span>
                            )}
                        </div>

                        {!node.ok && <p className="sub">Inventory failed: {node.error?.message || node.error?.code || 'unknown error'}</p>}

                        {node.ok &&
                            (node.managers || []).map(manager => (
                                <div key={`${manager.kind}-${manager.domain}`} style={{ marginTop: 14 }}>
                                    <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                                        <span className="badge info">{manager.kind}</span>
                                        <span className="mono">{manager.domain}</span>
                                        <span className="sub">{manager.algorithm}</span>
                                    </div>

                                    <div className="table-wrap" style={{ marginTop: 8 }}>
                                        <table>
                                            <thead>
                                                <tr>
                                                    <th>Signing kid</th>
                                                    <th>Signs until</th>
                                                    <th>Verifiable until</th>
                                                    <th></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(manager.signing || []).length === 0 && (
                                                    <tr>
                                                        <td colSpan={4} className="sub">
                                                            No active signing pairs.
                                                        </td>
                                                    </tr>
                                                )}
                                                {(manager.signing || []).map(key => (
                                                    <tr key={key.kid}>
                                                        <td className="mono">{key.kid}</td>
                                                        <td className="mono">{fmtTime(key.privateKeyExp)}</td>
                                                        <td className="mono">{fmtTime(key.publicKeyExp)}</td>
                                                        <td style={{ textAlign: 'right' }}>
                                                            <button className="danger small" disabled={busy} onClick={() => revokeKid(key.kid)}>
                                                                Revoke
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    <p className="sub" style={{ marginTop: 6 }}>
                                        Verification pool: {(manager.verification || []).length} kid(s)
                                        {(manager.verification || []).length > 0 && (
                                            <span className="mono"> — {(manager.verification || []).map(k => k.kid).join(', ')}</span>
                                        )}
                                    </p>
                                </div>
                            ))}
                    </div>
                ))}

            {result && (
                <>
                    <h2>{result.label} — result</h2>
                    <pre className="json">{JSON.stringify(result.payload, null, 2)}</pre>
                </>
            )}
        </Shell>
    );
}
