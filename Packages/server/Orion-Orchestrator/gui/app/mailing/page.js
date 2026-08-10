'use client';

/**
 * Mailing — submit a blast, watch the queue, follow a running job group by
 * group, and inspect what could not be delivered.
 *
 * The running job polls on a short interval. Everything the poll reads is a
 * cheap indexed query on the orchestrator's side (a COUNT of what is left, plus
 * the assignment ledger), so this stays honest without becoming a load source
 * of its own.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Shell from '../../components/Shell';
import { get, post, upload, fmtTime, fmtDuration, ApiError } from '../../lib/api';

const POLL_MS = 5000;

const STATUS_BADGE = {
    running: 'info',
    queued: 'warn',
    completed: 'ok',
    cancelled: 'dim',
    failed: 'crit'
};

const GROUP_BADGE = {
    completed: 'ok',
    running: 'info',
    assigned: 'info',
    waiting: 'dim'
};

const errText = err => (err instanceof ApiError ? `${err.code}: ${err.message}` : err.message);

/** A blast is long-running, so progress is shown as a bar rather than a number. */
const ProgressBar = ({ percent, tone = 'accent' }) => (
    <div className="progress" title={`${percent}%`}>
        <div className={`progress-fill ${tone}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
);

export default function Mailing() {
    const [queue, setQueue] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [deadLetters, setDeadLetters] = useState(null);

    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState(false);
    const [parseErrors, setParseErrors] = useState([]);

    const fileRef = useRef(null);

    const loadOverview = useCallback(async () => {
        try {
            const [q, j] = await Promise.all([get('/api/mailing/queue'), get('/api/mailing/jobs?limit=50')]);
            setQueue(q.queue);
            setJobs(j.jobs);
            setError(null);
        } catch (err) {
            setError(errText(err));
        }
    }, []);

    const loadDetail = useCallback(async jobId => {
        if (!jobId) return;
        try {
            setDetail(await get(`/api/mailing/jobs/${encodeURIComponent(jobId)}`));
        } catch (err) {
            setError(errText(err));
        }
    }, []);

    useEffect(() => {
        loadOverview();
    }, [loadOverview]);

    // Poll only while something is actually moving — a finished job's numbers
    // do not change, and neither does an empty queue.
    useEffect(() => {
        const live = queue?.running || (detail && ['running', 'queued'].includes(detail.job?.status));
        if (!live) return undefined;

        const timer = setInterval(() => {
            loadOverview();
            if (selected) loadDetail(selected);
        }, POLL_MS);
        return () => clearInterval(timer);
    }, [queue?.running, detail?.job?.status, selected, loadOverview, loadDetail]);

    useEffect(() => {
        setDetail(null);
        setDeadLetters(null);
        if (selected) loadDetail(selected);
    }, [selected, loadDetail]);

    const submit = async event => {
        event.preventDefault();
        const file = fileRef.current?.files?.[0];
        if (!file) return;

        setBusy(true);
        setError(null);
        setNotice(null);
        setParseErrors([]);

        try {
            const result = await upload('/api/mailing/jobs', file);
            const { job, plan, generatedJobId, extraColumns } = result;

            setNotice(
                `"${job.name}" accepted — ${plan.totalRecipients} recipients in ${plan.groupCount} group(s) of up to ${plan.groupSize}.` +
                    (generatedJobId ? ` Job id ${job.id} was generated.` : '') +
                    (extraColumns?.length ? ` Extra columns available as tokens: ${extraColumns.join(', ')}.` : '')
            );

            if (fileRef.current) fileRef.current.value = '';
            setSelected(job.id);
            await loadOverview();
        } catch (err) {
            setError(errText(err));
            setParseErrors(err.details || []);
        } finally {
            setBusy(false);
        }
    };

    const cancel = async jobId => {
        const reason = window.prompt('Cancelling stops this job. Unsent recipients are recorded as cancelled.\n\nReason (optional):');
        if (reason === null) return;

        setBusy(true);
        try {
            const result = await post(`/api/mailing/jobs/${encodeURIComponent(jobId)}/cancel`, { reason: reason || null });
            setNotice(`Cancelled — ${result.sent} already sent, ${result.unsent} not reached.`);
            await loadOverview();
            await loadDetail(jobId);
        } catch (err) {
            setError(errText(err));
        } finally {
            setBusy(false);
        }
    };

    const showDeadLetters = async jobId => {
        try {
            const result = await get(`/api/mailing/jobs/${encodeURIComponent(jobId)}/dead-letters?limit=200`);
            setDeadLetters(result.deadLetters);
        } catch (err) {
            setError(errText(err));
        }
    };

    return (
        <Shell>
            <h1>Mailing</h1>
            <p className="sub">
                Spreadsheet-driven mail blasts executed by the fleet. One job runs at a time; the rest wait in priority order, and a cooldown
                separates them.
            </p>

            {error && <div className="msg error">{error}</div>}
            {parseErrors.length > 0 && (
                <div className="panel">
                    <h2>The sheet was not accepted — nothing was queued</h2>
                    <ul className="issue-list">
                        {parseErrors.map((issue, i) => (
                            <li key={i}>{issue}</li>
                        ))}
                    </ul>
                </div>
            )}
            {notice && <div className="msg ok">{notice}</div>}

            {/* ── Queue state ────────────────────────────────────────────── */}
            {queue && (
                <>
                    {queue.blockedReason === 'cooldown' && (
                        <div className="msg warn">
                            {queue.queued.length} job(s) are waiting out the cooldown from the last blast — the next one starts in{' '}
                            {fmtDuration(queue.cooldown?.seconds)}.
                        </div>
                    )}
                    {queue.blockedReason === 'no-live-nodes' && (
                        <div className="msg error">
                            {queue.queued.length} job(s) are queued but no node is live to send them. They will start on their own once a node joins.
                        </div>
                    )}

                    <div className="cards">
                        <div className="card">
                            <div className="label">Running</div>
                            <div className="value">{queue.running ? queue.running.name : '—'}</div>
                            {queue.running && (
                                <>
                                    <ProgressBar
                                        percent={Math.round(
                                            ((queue.running.totalRecipients - queue.running.remaining) / Math.max(1, queue.running.totalRecipients)) * 100
                                        )}
                                    />
                                    <div className="sub" style={{ marginBottom: 0 }}>
                                        {queue.running.totalRecipients - queue.running.remaining} of {queue.running.totalRecipients} sent
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="card">
                            <div className="label">Waiting</div>
                            <div className="value">{queue.queued.length}</div>
                        </div>
                        <div className="card">
                            <div className="label">Live nodes</div>
                            <div className="value">{queue.liveNodeCount}</div>
                        </div>
                        <div className="card">
                            <div className="label">Cooldown</div>
                            <div className="value">{queue.cooldown ? fmtDuration(queue.cooldown.seconds) : 'clear'}</div>
                        </div>
                    </div>
                </>
            )}

            {/* ── Submit ─────────────────────────────────────────────────── */}
            <div className="panel">
                <h2>Submit a job</h2>
                <p className="sub">
                    An .xlsx or .csv with a header row. Required columns: <span className="mono">recipient</span>, <span className="mono">subject</span>,{' '}
                    <span className="mono">content</span>. Optional: <span className="mono">mailing_job_id</span> (32 characters, generated if blank),{' '}
                    <span className="mono">mailing_job_name</span>, <span className="mono">priority</span> (1–9, lower is more urgent),{' '}
                    <span className="mono">content_type</span> (text or html). Every other column becomes a{' '}
                    <span className="mono">&lt;COLUMN_NAME&gt;</span> token you can use in the subject and body.
                </p>
                <form onSubmit={submit} className="row">
                    <input type="file" ref={fileRef} accept=".xlsx,.csv" required />
                    <button type="submit" disabled={busy}>
                        {busy ? 'Uploading…' : 'Queue job'}
                    </button>
                </form>
            </div>

            {/* ── Jobs ───────────────────────────────────────────────────── */}
            <div className="panel table-wrap">
                <h2>Jobs</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Status</th>
                            <th>Priority</th>
                            <th>Recipients</th>
                            <th>Sent</th>
                            <th>Undeliverable</th>
                            <th>Created</th>
                            <th />
                        </tr>
                    </thead>
                    <tbody>
                        {jobs.length === 0 && (
                            <tr>
                                <td colSpan={8} className="sub">
                                    No mailing jobs yet.
                                </td>
                            </tr>
                        )}
                        {jobs.map(job => (
                            <tr key={job.id} className={selected === job.id ? 'selected' : ''}>
                                <td>
                                    <button className="linkish" onClick={() => setSelected(selected === job.id ? null : job.id)}>
                                        {job.name}
                                    </button>
                                    <div className="mono sub" style={{ marginBottom: 0 }}>
                                        {job.id}
                                    </div>
                                </td>
                                <td>
                                    <span className={`badge ${STATUS_BADGE[job.status] || 'dim'}`}>{job.status}</span>
                                </td>
                                <td className="mono">{job.priority}</td>
                                <td className="mono">{job.total_recipients}</td>
                                <td className="mono">{job.sent_count}</td>
                                <td className="mono">{job.failed_count > 0 ? <span className="badge warn">{job.failed_count}</span> : '0'}</td>
                                <td className="mono">{fmtTime(job.created_at)}</td>
                                <td>
                                    {['queued', 'running'].includes(job.status) && (
                                        <button className="danger small" onClick={() => cancel(job.id)} disabled={busy}>
                                            Cancel
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── Selected job detail ────────────────────────────────────── */}
            {detail && (
                <div className="panel">
                    <h2>{detail.job.name}</h2>
                    <p className="sub mono">{detail.job.id}</p>

                    <ProgressBar percent={detail.job.progressPercent} tone={detail.counts.failed > 0 ? 'warn' : 'accent'} />
                    <div className="row" style={{ marginBottom: 18 }}>
                        <span className="badge ok">{detail.counts.sent} sent</span>
                        {detail.counts.failed > 0 && <span className="badge crit">{detail.counts.failed} undeliverable</span>}
                        {detail.counts.cancelled > 0 && <span className="badge dim">{detail.counts.cancelled} cancelled</span>}
                        <span className="badge info">{detail.job.remaining} remaining</span>
                        {detail.job.started_at && (
                            <span className="sub" style={{ marginBottom: 0 }}>
                                started {fmtTime(detail.job.started_at)}
                            </span>
                        )}
                    </div>

                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Group</th>
                                    <th>Status</th>
                                    <th>Node</th>
                                    <th>Sent</th>
                                    <th>Failed</th>
                                    <th>Remaining</th>
                                    <th>Last progress</th>
                                    <th>Attempts</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detail.groups.map(group => (
                                    <tr key={group.groupNumber}>
                                        <td className="mono">#{group.groupNumber}</td>
                                        <td>
                                            <span className={`badge ${GROUP_BADGE[group.status] || 'dim'}`}>{group.status}</span>
                                        </td>
                                        <td className="mono">{group.workerId || '—'}</td>
                                        <td className="mono">{group.sent}</td>
                                        <td className="mono">{group.failed}</td>
                                        <td className="mono">{group.remaining}</td>
                                        <td className="mono">{fmtTime(group.lastProgressAt)}</td>
                                        {/* More than one attempt means the group was reassigned at least once. */}
                                        <td className="mono">{group.attempts > 1 ? <span className="badge warn">{group.attempts}</span> : group.attempts}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {detail.counts.failed > 0 && (
                        <div className="row" style={{ marginTop: 16 }}>
                            <button className="ghost small" onClick={() => showDeadLetters(detail.job.id)}>
                                Show the {detail.counts.failed} undeliverable address(es)
                            </button>
                        </div>
                    )}

                    {deadLetters && (
                        <div className="table-wrap" style={{ marginTop: 16 }}>
                            <table>
                                <thead>
                                    <tr>
                                        <th>Recipient</th>
                                        <th>Attempts</th>
                                        <th>Reason</th>
                                        <th>Node</th>
                                        <th>When</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {deadLetters.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="sub">
                                                No undeliverable addresses recorded.
                                            </td>
                                        </tr>
                                    )}
                                    {deadLetters.map(row => (
                                        <tr key={row.id}>
                                            <td className="mono">{row.recipient}</td>
                                            <td className="mono">{row.attempts}</td>
                                            <td className="sub" style={{ marginBottom: 0 }}>
                                                {row.error || '—'}
                                            </td>
                                            <td className="mono">{row.worker_id || '—'}</td>
                                            <td className="mono">{fmtTime(row.finished_at)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </Shell>
    );
}
