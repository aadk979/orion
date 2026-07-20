'use client';

/**
 * Account — current session details; password rotation for root.
 */

import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { get, post, fmtTime, ApiError } from '../../lib/api';

export default function AccountPage() {
    const [session, setSession] = useState(null);
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [newPw2, setNewPw2] = useState('');
    const [msg, setMsg] = useState(null);

    useEffect(() => {
        get('/api/auth/session')
            .then(setSession)
            .catch(() => {});
    }, []);

    const rotate = async () => {
        setMsg(null);
        try {
            if (newPw !== newPw2) throw new Error('New passwords do not match');
            await post('/api/auth/root/change-password', { currentPassword: currentPw, newPassword: newPw });
            setMsg({ ok: true, text: 'Password rotated.' });
            setCurrentPw('');
            setNewPw('');
            setNewPw2('');
        } catch (err) {
            setMsg({ ok: false, text: err instanceof ApiError ? `${err.code}: ${err.message}` : err.message });
        }
    };

    return (
        <Shell>
            <h1>Account</h1>
            <p className="sub">Your session and credentials.</p>

            {session && (
                <div className="panel">
                    <table>
                        <tbody>
                            <tr>
                                <td className="sub">Email</td>
                                <td className="mono">{session.admin.email}</td>
                            </tr>
                            <tr>
                                <td className="sub">Role</td>
                                <td>
                                    <span className={`badge ${session.admin.role === 'root' ? 'crit' : 'info'}`}>{session.admin.role}</span>
                                </td>
                            </tr>
                            <tr>
                                <td className="sub">Status</td>
                                <td>
                                    <span className="badge ok">{session.admin.status}</span>
                                </td>
                            </tr>
                            <tr>
                                <td className="sub">MFA</td>
                                <td>
                                    {session.admin.totpEnrolled ? (
                                        <span className="badge ok">TOTP enrolled</span>
                                    ) : (
                                        <span className="badge crit">not enrolled</span>
                                    )}
                                </td>
                            </tr>
                            <tr>
                                <td className="sub">Session expires</td>
                                <td className="mono">{fmtTime(session.expiresAt)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {session?.admin.role === 'root' && (
                <div className="panel">
                    <h2 style={{ marginTop: 0 }}>Rotate root password</h2>
                    {msg && <div className={`msg ${msg.ok ? 'ok' : 'error'}`}>{msg.text}</div>}
                    <label className="field">
                        <span>Current password</span>
                        <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                    </label>
                    <label className="field">
                        <span>New password (min 12 characters)</span>
                        <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                    </label>
                    <label className="field">
                        <span>Repeat new password</span>
                        <input type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)} />
                    </label>
                    <button disabled={!currentPw || newPw.length < 12 || newPw !== newPw2} onClick={rotate}>
                        Rotate password
                    </button>
                </div>
            )}
        </Shell>
    );
}
