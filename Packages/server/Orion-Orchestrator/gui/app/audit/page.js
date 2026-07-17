'use client';

/**
 * Audit trail — the immutable, hash-chained record of every admin-plane
 * request and auth event on the orchestrator. Root can verify the chain.
 */

import { useCallback, useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { get, fmtTime, ApiError } from '../../lib/api';

export default function AuditPage() {
    const [rows, setRows] = useState(null);
    const [error, setError] = useState(null);
    const [actionFilter, setActionFilter] = useState('');
    const [verify, setVerify] = useState(null);

    const refresh = useCallback(() => {
        const qs = new URLSearchParams({ limit: '200' });
        if (actionFilter) qs.set('action', actionFilter);
        get(`/api/audit?${qs}`)
            .then(r => { setRows(r.audit); setError(null); })
            .catch(err => setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message));
    }, [actionFilter]);

    useEffect(() => { refresh(); }, [refresh]);

    const runVerify = async () => {
        try {
            setVerify(await get('/api/audit/verify'));
        } catch (err) {
            setVerify({ valid: null, message: err.message });
        }
    };

    const decisionBadge = (d) => <span className={`badge ${d === 'allow' ? 'ok' : d === 'deny' ? 'crit' : 'warn'}`}>{d}</span>;

    return (
        <Shell>
            <h1>Audit trail</h1>
            <p className="sub">Append-only and hash-chained — UPDATE/DELETE are rejected by the database itself.</p>

            {error && <div className="msg error">{error}</div>}

            <div className="row" style={{ marginBottom: 14 }}>
                <input
                    style={{ maxWidth: 320 }}
                    placeholder="Filter by action prefix (e.g. auth:, governance:)"
                    value={actionFilter}
                    onChange={e => setActionFilter(e.target.value)}
                />
                <button className="ghost small" onClick={refresh}>Refresh</button>
                <button className="ghost small" onClick={runVerify}>Verify hash chain (root)</button>
                {verify && (
                    verify.valid === true
                        ? <span className="badge ok">chain intact · {verify.checked} rows</span>
                        : verify.valid === false
                            ? <span className="badge crit">BROKEN at row {verify.brokenAtId}</span>
                            : <span className="badge dim">{verify.message}</span>
                )}
            </div>

            <div className="panel table-wrap">
                <table>
                    <thead>
                        <tr><th>At</th><th>Admin</th><th>Action</th><th>Resource</th><th>Decision</th><th>Status</th><th>IP</th></tr>
                    </thead>
                    <tbody>
                        {rows === null && <tr><td colSpan={7} className="sub">Loading…</td></tr>}
                        {rows?.length === 0 && <tr><td colSpan={7} className="sub">No audit rows match.</td></tr>}
                        {rows?.map(row => (
                            <tr key={row.id}>
                                <td className="mono">{fmtTime(row.at)}</td>
                                <td className="mono">{row.admin_email || '—'}</td>
                                <td className="mono">{row.action}</td>
                                <td className="mono">{row.resource || '—'}</td>
                                <td>{decisionBadge(row.decision)}</td>
                                <td className="mono">{row.status_code ?? '—'}</td>
                                <td className="mono">{row.ip || '—'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Shell>
    );
}
