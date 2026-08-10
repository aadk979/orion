'use client';

/**
 * Authenticated shell: resolves the session once, redirects to /login when
 * there is none, and renders the sidebar + page content. Governance nav is
 * only shown to root — the API enforces it regardless.
 */

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { get, post } from '../lib/api';

const NAV = [
    { href: '/', label: 'Dashboard' },
    { href: '/operations/', label: 'Operations' },
    { href: '/mailing/', label: 'Mailing', mailingOnly: true },
    { href: '/notifications/', label: 'Notifications', mailingOnly: true, badge: 'unread' },
    { href: '/secrets/', label: 'Signing keys' },
    { href: '/observability/', label: 'Observability' },
    { href: '/audit/', label: 'Audit trail' },
    { href: '/governance/', label: 'Governance', rootOnly: true },
    { href: '/account/', label: 'Account' }
];

/** Unread count refresh — slow, because the badge is ambient, not a live feed. */
const UNREAD_POLL_MS = 60_000;

export default function Shell({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const [session, setSession] = useState(null);
    const [checked, setChecked] = useState(false);
    const [mailingAvailable, setMailingAvailable] = useState(false);
    const [unread, setUnread] = useState(0);
    // The delay warning an admin sees on arrival — the whole point of it is to
    // answer "why has my blast not gone out" before anyone has to ask.
    const [queueWarning, setQueueWarning] = useState(null);
    const [warningDismissed, setWarningDismissed] = useState(false);

    useEffect(() => {
        get('/api/auth/session')
            .then(s => {
                if (s.stage !== 'active' || s.admin.status !== 'active') {
                    router.replace('/login/');
                    return;
                }
                setSession(s);
                setChecked(true);
            })
            .catch(() => router.replace('/login/'));
    }, [router]);

    // Mailing is optional. Ask once whether it exists at all, so the nav never
    // offers a page that can only return 503.
    useEffect(() => {
        if (!checked) return;
        get('/api/meta')
            .then(meta => setMailingAvailable(meta.mailingAvailable === true))
            .catch(() => setMailingAvailable(false));
    }, [checked]);

    useEffect(() => {
        if (!checked || !mailingAvailable) return undefined;

        const refresh = () => {
            // Both are PBAC-gated; an admin without the grant simply sees no
            // badge and no banner rather than an error on every page.
            get('/api/notifications?limit=1')
                .then(result => setUnread(result.unread || 0))
                .catch(() => {});

            get('/api/mailing/queue')
                .then(({ queue }) => {
                    if (!queue.blockedReason || queue.queued.length === 0) return setQueueWarning(null);

                    setQueueWarning(
                        queue.blockedReason === 'cooldown'
                            ? `${queue.queued.length} mailing job(s) are waiting out the cooldown from the last blast — the next starts in about ` +
                                  `${Math.ceil((queue.cooldown?.seconds || 0) / 60)} minutes.`
                            : `${queue.queued.length} mailing job(s) are queued but no node is live to send them.`
                    );
                })
                .catch(() => {});
        };

        refresh();
        const timer = setInterval(refresh, UNREAD_POLL_MS);
        return () => clearInterval(timer);
    }, [checked, mailingAvailable]);

    if (!checked) {
        return (
            <div className="login-wrap">
                <p className="sub">Checking session…</p>
            </div>
        );
    }

    const admin = session.admin;

    const logout = async () => {
        try {
            await post('/api/auth/logout');
        } catch (_) {
            /* session may be gone */
        }
        router.replace('/login/');
    };

    return (
        <div className="shell">
            <nav className="sidebar">
                <div className="brand">
                    Orion <span>Orch</span> Panel
                </div>
                {NAV.filter(item => (!item.rootOnly || admin.role === 'root') && (!item.mailingOnly || mailingAvailable)).map(item => (
                    <Link key={item.href} href={item.href} className={pathname === item.href || pathname === item.href.replace(/\/$/, '') ? 'active' : ''}>
                        {item.label}
                        {item.badge === 'unread' && unread > 0 && <span className="nav-badge">{unread > 99 ? '99+' : unread}</span>}
                    </Link>
                ))}
                <div className="spacer" />
                <div className="whoami">
                    {admin.email}
                    <div style={{ marginTop: 6 }}>
                        <span className={`badge ${admin.role === 'root' ? 'crit' : 'info'}`}>{admin.role}</span>
                    </div>
                    <div style={{ marginTop: 10 }}>
                        <button className="ghost small" onClick={logout}>
                            Sign out
                        </button>
                    </div>
                </div>
            </nav>
            <main className="main">
                {queueWarning && !warningDismissed && (
                    <div className="msg warn banner">
                        <span>{queueWarning}</span>
                        <button className="ghost small" onClick={() => setWarningDismissed(true)}>
                            Dismiss
                        </button>
                    </div>
                )}
                {children}
            </main>
            {/* Workbench-style status strip. CSS hides it in the modern theme. */}
            <div className="statusbar">
                <span>Orion Orch Panel</span>
                <span className="sep">|</span>
                <span>{admin.email}</span>
                <span className="sep">|</span>
                <span>role: {admin.role}</span>
                <span className="spacer" />
                <span>{session.stage === 'active' ? 'session active' : session.stage}</span>
            </div>
        </div>
    );
}
