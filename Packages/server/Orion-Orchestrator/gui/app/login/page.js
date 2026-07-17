'use client';

/**
 * Sign-in — the full ladder, driven by API responses:
 *
 *   admins:  email → magic-link code → TOTP verify (or mandatory enrollment)
 *   root:    email + password → TOTP verify/enrollment → forced password
 *            rotation while the bootstrap password is still in place
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { post, ApiError } from '../../lib/api';

const STEP = {
    FIRST_FACTOR: 'first-factor',
    MAGIC_CODE: 'magic-code',
    TOTP_VERIFY: 'totp-verify',
    TOTP_ENROLL: 'totp-enroll',
    ROTATE_PASSWORD: 'rotate-password'
};

function LoginFlow() {
    const router = useRouter();
    const search = useSearchParams();

    const [mode, setMode] = useState('admin');
    const [step, setStep] = useState(STEP.FIRST_FACTOR);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState(search.get('code') || '');
    const [totp, setTotp] = useState('');
    const [enroll, setEnroll] = useState(null);
    const [needsRotation, setNeedsRotation] = useState(false);
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [newPw2, setNewPw2] = useState('');

    const run = async (fn) => {
        setBusy(true);
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message);
        } finally {
            setBusy(false);
        }
    };

    const afterFirstFactor = async (result) => {
        setNeedsRotation(result.passwordChangeRequired === true);
        if (result.totpEnrolled) {
            setStep(STEP.TOTP_VERIFY);
        } else {
            const setup = await post('/api/auth/totp/setup');
            setEnroll(setup);
            setStep(STEP.TOTP_ENROLL);
        }
    };

    const submitFirstFactor = () => run(async () => {
        if (mode === 'root') {
            const result = await post('/api/auth/root/login', { email, password });
            await afterFirstFactor(result);
        } else {
            await post('/api/auth/magic-link', { email });
            setNotice(`If ${email} is a system admin, a sign-in link is on its way. Paste the code from the email (or open the link).`);
            setStep(STEP.MAGIC_CODE);
        }
    });

    const submitMagicCode = () => run(async () => {
        const result = await post('/api/auth/magic-link/verify', { code });
        await afterFirstFactor(result);
    });

    const finishTotp = (endpoint) => run(async () => {
        const result = await post(endpoint, { token: totp });
        if (needsRotation || result.admin?.passwordChangeRequired) {
            setStep(STEP.ROTATE_PASSWORD);
            return;
        }
        router.replace('/');
    });

    const submitRotation = () => run(async () => {
        if (newPw !== newPw2) throw new Error('New passwords do not match');
        await post('/api/auth/root/change-password', { currentPassword: currentPw, newPassword: newPw });
        router.replace('/');
    });

    return (
        <div className="login-wrap">
            <div className="login-box">
                <h1>Orion <span style={{ color: 'var(--accent)' }}>Orch</span> Panel</h1>
                <p className="sub">Policy-governed cluster control plane</p>

                {error && <div className="msg error">{error}</div>}
                {notice && step === STEP.MAGIC_CODE && <div className="msg ok">{notice}</div>}

                {step === STEP.FIRST_FACTOR && (
                    <>
                        <div className="tabs">
                            <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>System admin</button>
                            <button className={mode === 'root' ? 'active' : ''} onClick={() => setMode('root')}>Root</button>
                        </div>
                        <label className="field">
                            <span>Email</span>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
                        </label>
                        {mode === 'root' && (
                            <label className="field">
                                <span>Password</span>
                                <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
                            </label>
                        )}
                        <button disabled={busy || !email || (mode === 'root' && !password)} onClick={submitFirstFactor}>
                            {mode === 'root' ? 'Sign in' : 'Email me a sign-in link'}
                        </button>
                        {mode === 'admin' && (
                            <p className="sub" style={{ marginTop: 14, fontSize: 12 }}>
                                Already have a code? <a href="#" onClick={e => { e.preventDefault(); setStep(STEP.MAGIC_CODE); }}>Enter it directly</a>
                            </p>
                        )}
                    </>
                )}

                {step === STEP.MAGIC_CODE && (
                    <>
                        <label className="field">
                            <span>Sign-in code from the email</span>
                            <input value={code} onChange={e => setCode(e.target.value)} className="mono" autoFocus />
                        </label>
                        <button disabled={busy || !code} onClick={submitMagicCode}>Continue</button>
                    </>
                )}

                {step === STEP.TOTP_VERIFY && (
                    <>
                        <p className="sub">Enter the 6-digit code from your authenticator app.</p>
                        <label className="field">
                            <span>Authenticator code</span>
                            <input value={totp} onChange={e => setTotp(e.target.value)} inputMode="numeric" maxLength={6} className="mono" autoFocus />
                        </label>
                        <button disabled={busy || totp.length !== 6} onClick={() => finishTotp('/api/auth/totp/verify')}>Verify</button>
                    </>
                )}

                {step === STEP.TOTP_ENROLL && enroll && (
                    <>
                        <p className="sub">MFA enrollment is mandatory — scan this with your authenticator app, then confirm with a code.</p>
                        {enroll.qrDataUrl && <img className="qr" src={enroll.qrDataUrl} alt="TOTP enrollment QR code" />}
                        <p className="sub" style={{ fontSize: 12 }}>Manual secret: <span className="mono">{enroll.secret}</span></p>
                        <label className="field">
                            <span>Authenticator code</span>
                            <input value={totp} onChange={e => setTotp(e.target.value)} inputMode="numeric" maxLength={6} className="mono" />
                        </label>
                        <button disabled={busy || totp.length !== 6} onClick={() => finishTotp('/api/auth/totp/activate')}>Activate</button>
                    </>
                )}

                {step === STEP.ROTATE_PASSWORD && (
                    <>
                        <p className="sub">The bootstrap password must be rotated before the root account activates.</p>
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
                        <button disabled={busy || !currentPw || newPw.length < 12 || newPw !== newPw2} onClick={submitRotation}>
                            Rotate password &amp; finish
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <Suspense fallback={<div className="login-wrap"><p className="sub">Loading…</p></div>}>
            <LoginFlow />
        </Suspense>
    );
}
