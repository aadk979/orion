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
    { href: '/observability/', label: 'Observability' },
    { href: '/audit/', label: 'Audit trail' },
    { href: '/governance/', label: 'Governance', rootOnly: true },
    { href: '/account/', label: 'Account' }
];

export default function Shell({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const [session, setSession] = useState(null);
    const [checked, setChecked] = useState(false);

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

    if (!checked) {
        return <div className="login-wrap"><p className="sub">Checking session…</p></div>;
    }

    const admin = session.admin;

    const logout = async () => {
        try { await post('/api/auth/logout'); } catch (_) { /* session may be gone */ }
        router.replace('/login/');
    };

    return (
        <div className="shell">
            <nav className="sidebar">
                <div className="brand">Orion <span>Orch</span> Panel</div>
                {NAV.filter(item => !item.rootOnly || admin.role === 'root').map(item => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={pathname === item.href || pathname === item.href.replace(/\/$/, '') ? 'active' : ''}
                    >
                        {item.label}
                    </Link>
                ))}
                <div className="spacer" />
                <div className="whoami">
                    {admin.email}
                    <div style={{ marginTop: 6 }}>
                        <span className={`badge ${admin.role === 'root' ? 'crit' : 'info'}`}>{admin.role}</span>
                    </div>
                    <div style={{ marginTop: 10 }}>
                        <button className="ghost small" onClick={logout}>Sign out</button>
                    </div>
                </div>
            </nav>
            <main className="main">{children}</main>
        </div>
    );
}
