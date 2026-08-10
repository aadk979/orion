'use client';

/**
 * Notifications — the orchestrator's control-plane feed.
 *
 * Read state is per admin: a notification is a fact about the cluster, not a
 * message addressed to one person, so two admins each see it and each dismisses
 * it for themselves.
 */

import { useCallback, useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { get, post, fmtTime, ApiError } from '../../lib/api';

const SEVERITY_BADGE = { info: 'info', warning: 'warn', critical: 'crit' };

/** Short human labels so the feed reads as events rather than as event codes. */
const TYPE_LABEL = {
    'mailing:job-queued': 'Job queued',
    'mailing:job-delayed': 'Job delayed',
    'mailing:job-started': 'Job started',
    'mailing:job-completed': 'Job completed',
    'mailing:job-cancelled': 'Job cancelled',
    'mailing:job-failed': 'Job failed',
    'mailing:group-reassigned': 'Group reassigned',
    'mailing:dead-letters': 'Undeliverable mail',
    'mailing:watchdog-recovered': 'Watchdog recovery',
    'mailing:no-nodes': 'No live nodes'
};

export default function Notifications() {
    const [items, setItems] = useState([]);
    const [unread, setUnread] = useState(0);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        try {
            const result = await get(`/api/notifications?limit=100${unreadOnly ? '&unread=true' : ''}`);
            setItems(result.notifications);
            setUnread(result.unread);
            setError(null);
        } catch (err) {
            setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message);
        }
    }, [unreadOnly]);

    useEffect(() => {
        load();
    }, [load]);

    const markRead = async id => {
        try {
            await post(`/api/notifications/${encodeURIComponent(id)}/read`);
            await load();
        } catch (err) {
            setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message);
        }
    };

    const markAllRead = async () => {
        try {
            await post('/api/notifications/read-all');
            await load();
        } catch (err) {
            setError(err instanceof ApiError ? `${err.code}: ${err.message}` : err.message);
        }
    };

    return (
        <Shell>
            <h1>Notifications</h1>
            <p className="sub">Control-plane events from the orchestrator. Read state is yours alone — marking one read does not hide it from anyone else.</p>

            {error && <div className="msg error">{error}</div>}

            <div className="row" style={{ marginBottom: 18 }}>
                <button className={unreadOnly ? '' : 'ghost'} onClick={() => setUnreadOnly(!unreadOnly)}>
                    {unreadOnly ? 'Showing unread only' : 'Showing all'}
                </button>
                {unread > 0 && (
                    <button className="ghost" onClick={markAllRead}>
                        Mark all {unread} read
                    </button>
                )}
            </div>

            {items.length === 0 && <p className="sub">{unreadOnly ? 'Nothing unread.' : 'No notifications yet.'}</p>}

            {items.map(item => (
                <div key={item.id} className={`panel notification ${item.read ? 'read' : 'unread'}`}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                        <div className="row">
                            <span className={`badge ${SEVERITY_BADGE[item.severity] || 'dim'}`}>{TYPE_LABEL[item.type] || item.type}</span>
                            <strong>{item.title}</strong>
                        </div>
                        <div className="row">
                            <span className="mono sub" style={{ marginBottom: 0 }}>
                                {fmtTime(item.created_at)}
                            </span>
                            {!item.read && (
                                <button className="ghost small" onClick={() => markRead(item.id)}>
                                    Mark read
                                </button>
                            )}
                        </div>
                    </div>
                    <p className="sub" style={{ margin: '10px 0 0' }}>
                        {item.message}
                    </p>
                    {item.job_id && (
                        <p className="mono sub" style={{ margin: '6px 0 0' }}>
                            job {item.job_id}
                        </p>
                    )}
                </div>
            ))}
        </Shell>
    );
}
