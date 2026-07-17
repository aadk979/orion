'use client';

/**
 * Governance (root only) — system admins, PBAC policies, and policy groups.
 * Every mutation here is a root-gated API call recorded in the immutable
 * audit trail; non-root admins never see this page (and the API refuses them
 * regardless).
 */

import { useCallback, useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { get, post, patch, del, fmtTime, ApiError } from '../../lib/api';

const errText = (err) => err instanceof ApiError ? `${err.code}: ${err.message}` : err.message;

const EXAMPLE_POLICY = JSON.stringify({
    version: 1,
    statements: [
        { sid: 'observe', effect: 'allow', actions: ['cluster:read:*', 'audit:read'], resources: ['*'] },
        { sid: 'ping-only', effect: 'allow', actions: ['cluster:command:node:ping'], resources: ['*'] }
    ]
}, null, 2);

// ── Admins tab ───────────────────────────────────────────────────────────────

function AdminsTab({ policies, groups }) {
    const [admins, setAdmins] = useState(null);
    const [msg, setMsg] = useState(null);
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [policyId, setPolicyId] = useState('');
    const [groupId, setGroupId] = useState('');

    const refresh = useCallback(() => {
        get('/api/admins').then(r => setAdmins(r.admins)).catch(err => setMsg({ ok: false, text: errText(err) }));
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const act = (fn, okText) => async () => {
        setMsg(null);
        try {
            await fn();
            setMsg({ ok: true, text: okText });
            refresh();
        } catch (err) {
            setMsg({ ok: false, text: errText(err) });
        }
    };

    return (
        <>
            {msg && <div className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Create system admin</h2>
                <p className="sub">Passwordless — the invite email carries their first magic link; TOTP enrollment is mandatory before the account activates. With no policy or group selected, the built-in read-only policy is attached.</p>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                    <label className="field" style={{ flex: 2, marginBottom: 0 }}><span>Email</span>
                        <input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
                    <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Display name</span>
                        <input value={name} onChange={e => setName(e.target.value)} /></label>
                    <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Policy</span>
                        <select value={policyId} onChange={e => setPolicyId(e.target.value)}>
                            <option value="">(default read-only)</option>
                            {policies?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select></label>
                    <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Group</span>
                        <select value={groupId} onChange={e => setGroupId(e.target.value)}>
                            <option value="">(none)</option>
                            {groups?.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select></label>
                    <button
                        disabled={!email}
                        onClick={act(() => post('/api/admins', { email, displayName: name || null, policyId: policyId || null, groupId: groupId || null }), `Admin ${email} created and invited`)}
                    >
                        Create &amp; invite
                    </button>
                </div>
            </div>

            <div className="panel table-wrap">
                <table>
                    <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>MFA</th><th>Last login</th><th>Actions</th></tr></thead>
                    <tbody>
                        {admins === null && <tr><td colSpan={6} className="sub">Loading…</td></tr>}
                        {admins?.map(a => (
                            <tr key={a.id}>
                                <td className="mono">{a.email}<div className="sub" style={{ fontSize: 11 }}>{a.id}</div></td>
                                <td><span className={`badge ${a.role === 'root' ? 'crit' : 'info'}`}>{a.role}</span></td>
                                <td><span className={`badge ${a.status === 'active' ? 'ok' : a.status === 'suspended' ? 'crit' : 'warn'}`}>{a.status}</span></td>
                                <td>{a.totpEnrolled ? <span className="badge ok">TOTP</span> : <span className="badge dim">none</span>}</td>
                                <td className="mono">{fmtTime(a.lastLoginAt)}</td>
                                <td>
                                    {a.role !== 'root' && (
                                        <div className="row">
                                            {a.status !== 'suspended'
                                                ? <button className="ghost small" onClick={act(() => post(`/api/admins/${a.id}/status`, { status: 'suspended' }), `${a.email} suspended`)}>Suspend</button>
                                                : <button className="ghost small" onClick={act(() => post(`/api/admins/${a.id}/status`, { status: 'active' }), `${a.email} reinstated`)}>Reinstate</button>}
                                            <button className="danger small" onClick={act(() => {
                                                if (!window.confirm(`Delete ${a.email}? This cannot be undone.`)) throw new Error('cancelled');
                                                return del(`/api/admins/${a.id}`);
                                            }, `${a.email} deleted`)}>Delete</button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Policies tab ─────────────────────────────────────────────────────────────

function PoliciesTab({ policies, refreshPolicies, admins, groups }) {
    const [msg, setMsg] = useState(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [doc, setDoc] = useState(EXAMPLE_POLICY);
    const [attach, setAttach] = useState({ policyId: '', principalType: 'admin', principalId: '' });

    const act = (fn, okText) => async () => {
        setMsg(null);
        try {
            await fn();
            setMsg({ ok: true, text: okText });
            refreshPolicies();
        } catch (err) {
            setMsg({ ok: false, text: errText(err) });
        }
    };

    return (
        <>
            {msg && <div className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Create policy</h2>
                <div className="row">
                    <label className="field" style={{ flex: 1 }}><span>Name</span>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="ops-oncall" /></label>
                    <label className="field" style={{ flex: 2 }}><span>Description</span>
                        <input value={description} onChange={e => setDescription(e.target.value)} /></label>
                </div>
                <label className="field"><span>Policy document (deny overrides; default deny)</span>
                    <textarea className="mono" value={doc} onChange={e => setDoc(e.target.value)} /></label>
                <button
                    disabled={!name}
                    onClick={act(() => post('/api/policies', { name, description: description || null, document: JSON.parse(doc) }), `Policy ${name} created`)}
                >
                    Create policy
                </button>
            </div>

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Attach / detach</h2>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                    <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Policy</span>
                        <select value={attach.policyId} onChange={e => setAttach({ ...attach, policyId: e.target.value })}>
                            <option value="">select…</option>
                            {policies?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select></label>
                    <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Principal type</span>
                        <select value={attach.principalType} onChange={e => setAttach({ ...attach, principalType: e.target.value, principalId: '' })}>
                            <option value="admin">admin</option>
                            <option value="group">group</option>
                        </select></label>
                    <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Principal</span>
                        <select value={attach.principalId} onChange={e => setAttach({ ...attach, principalId: e.target.value })}>
                            <option value="">select…</option>
                            {(attach.principalType === 'admin' ? admins : groups)?.map(p => (
                                <option key={p.id} value={p.id}>{p.email || p.name}</option>
                            ))}
                        </select></label>
                    <button
                        disabled={!attach.policyId || !attach.principalId}
                        onClick={act(() => post(`/api/policies/${attach.policyId}/attach`, attach), 'Policy attached')}
                    >Attach</button>
                    <button
                        className="ghost"
                        disabled={!attach.policyId || !attach.principalId}
                        onClick={act(() => post(`/api/policies/${attach.policyId}/detach`, attach), 'Policy detached')}
                    >Detach</button>
                </div>
            </div>

            <div className="panel table-wrap">
                <table>
                    <thead><tr><th>Name</th><th>Description</th><th>Document</th><th>Actions</th></tr></thead>
                    <tbody>
                        {policies?.map(p => (
                            <tr key={p.id}>
                                <td className="mono">{p.name}{p.managed && <div><span className="badge dim">built-in</span></div>}<div className="sub" style={{ fontSize: 11 }}>{p.id}</div></td>
                                <td>{p.description || '—'}</td>
                                <td><pre className="json" style={{ maxHeight: 140, maxWidth: 420 }}>{JSON.stringify(p.document, null, 1)}</pre></td>
                                <td>
                                    {!p.managed && (
                                        <button className="danger small" onClick={act(() => {
                                            if (!window.confirm(`Delete policy ${p.name}?`)) throw new Error('cancelled');
                                            return del(`/api/policies/${p.id}`);
                                        }, `Policy ${p.name} deleted`)}>Delete</button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Groups tab ───────────────────────────────────────────────────────────────

function GroupsTab({ groups, refreshGroups, admins }) {
    const [msg, setMsg] = useState(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [members, setMembers] = useState({});
    const [addSel, setAddSel] = useState({});

    const act = (fn, okText) => async () => {
        setMsg(null);
        try {
            await fn();
            setMsg({ ok: true, text: okText });
            refreshGroups();
        } catch (err) {
            setMsg({ ok: false, text: errText(err) });
        }
    };

    const loadMembers = (groupId) => {
        get(`/api/groups/${groupId}/members`)
            .then(r => setMembers(m => ({ ...m, [groupId]: r.members })))
            .catch(() => { });
    };

    return (
        <>
            {msg && <div className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}

            <div className="panel">
                <h2 style={{ marginTop: 0 }}>Create group</h2>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                    <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>Name</span>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="sre-oncall" /></label>
                    <label className="field" style={{ flex: 2, marginBottom: 0 }}><span>Description</span>
                        <input value={description} onChange={e => setDescription(e.target.value)} /></label>
                    <button disabled={!name} onClick={act(() => post('/api/groups', { name, description: description || null }), `Group ${name} created`)}>
                        Create group
                    </button>
                </div>
            </div>

            {groups?.map(g => (
                <div className="panel" key={g.id}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                        <div>
                            <b className="mono">{g.name}</b> <span className="sub">({g.member_count} member{g.member_count === 1 ? '' : 's'})</span>
                            <div className="sub" style={{ fontSize: 11 }}>{g.id}</div>
                        </div>
                        <div className="row">
                            <button className="ghost small" onClick={() => loadMembers(g.id)}>Show members</button>
                            <button className="danger small" onClick={act(() => {
                                if (!window.confirm(`Delete group ${g.name}?`)) throw new Error('cancelled');
                                return del(`/api/groups/${g.id}`);
                            }, `Group ${g.name} deleted`)}>Delete</button>
                        </div>
                    </div>

                    {members[g.id] && (
                        <div style={{ marginTop: 12 }}>
                            <table>
                                <tbody>
                                    {members[g.id].length === 0 && <tr><td className="sub">No members.</td></tr>}
                                    {members[g.id].map(m => (
                                        <tr key={m.id}>
                                            <td className="mono">{m.email}</td>
                                            <td><span className="badge dim">{m.status}</span></td>
                                            <td>
                                                <button className="ghost small" onClick={act(async () => {
                                                    await del(`/api/groups/${g.id}/members/${m.id}`);
                                                    loadMembers(g.id);
                                                }, `${m.email} removed from ${g.name}`)}>Remove</button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="row" style={{ marginTop: 10 }}>
                                <select value={addSel[g.id] || ''} onChange={e => setAddSel(s => ({ ...s, [g.id]: e.target.value }))} style={{ width: 'auto' }}>
                                    <option value="">add member…</option>
                                    {admins?.filter(a => a.role !== 'root').map(a => <option key={a.id} value={a.id}>{a.email}</option>)}
                                </select>
                                <button className="small" disabled={!addSel[g.id]} onClick={act(async () => {
                                    await post(`/api/groups/${g.id}/members`, { adminId: addSel[g.id] });
                                    loadMembers(g.id);
                                }, 'Member added')}>Add</button>
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Governance() {
    const [tab, setTab] = useState('admins');
    const [admins, setAdmins] = useState(null);
    const [policies, setPolicies] = useState(null);
    const [groups, setGroups] = useState(null);

    const refreshAdmins = useCallback(() => { get('/api/admins').then(r => setAdmins(r.admins)).catch(() => { }); }, []);
    const refreshPolicies = useCallback(() => { get('/api/policies').then(r => setPolicies(r.policies)).catch(() => { }); }, []);
    const refreshGroups = useCallback(() => { get('/api/groups').then(r => setGroups(r.groups)).catch(() => { }); }, []);

    useEffect(() => {
        refreshAdmins();
        refreshPolicies();
        refreshGroups();
    }, [refreshAdmins, refreshPolicies, refreshGroups]);

    return (
        <Shell>
            <h1>Governance</h1>
            <p className="sub">Root-only: system admins, PBAC policies, and policy groups. Every change is audited immutably.</p>

            <div className="tabs">
                <button className={tab === 'admins' ? 'active' : ''} onClick={() => { setTab('admins'); refreshAdmins(); }}>Admins</button>
                <button className={tab === 'policies' ? 'active' : ''} onClick={() => { setTab('policies'); refreshPolicies(); }}>Policies</button>
                <button className={tab === 'groups' ? 'active' : ''} onClick={() => { setTab('groups'); refreshGroups(); }}>Groups</button>
            </div>

            {tab === 'admins' && <AdminsTab policies={policies} groups={groups} />}
            {tab === 'policies' && <PoliciesTab policies={policies} refreshPolicies={refreshPolicies} admins={admins} groups={groups} />}
            {tab === 'groups' && <GroupsTab groups={groups} refreshGroups={refreshGroups} admins={admins} />}
        </Shell>
    );
}
