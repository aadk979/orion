import { ApiInterface } from '../Utils/Api-2.js';
import { getAuthHeader } from '../Utils/Authorisation.js';

/**
 * Orion Notifications overlay.
 *
 * Renders account-security notices the server says the user has not seen. It
 * is deliberately NOT optional: these are facts about the user's own account
 * (their authenticator stopped working, their 2FA was reset fleet-wide) that a
 * host application must not be able to suppress. What IS configurable is how
 * it looks — it accepts the same style variables as the step-up and
 * device-authorization prompts, so it inherits the host's visual identity.
 *
 * Every scheduling decision belongs to the server:
 *
 *   - the server says whether to prompt (`prompt`), based on database
 *     timestamps, so a client clock or a cleared storage cannot re-trigger or
 *     suppress a notice;
 *   - the client reports back when the overlay actually RENDERED
 *     (mark-notifications-shown), which is what starts the 24-hour quiet
 *     period — a prefetch that never reached a screen must not consume it;
 *   - dismissal is an explicit acknowledgement per notification.
 *
 * Closing the overlay without acknowledging is allowed and harmless: the
 * notice returns on the next login, and again 24h later if still unread.
 */

const STYLE_ID = 'orion-notifications-styles';
const ROOT_ID = 'orion-notifications-root';
const API_TIMEOUT_MS = 15_000;

const SEVERITY_LABELS = Object.freeze({ urgent: 'Action required', important: 'Important', info: 'Notice' });

/** All user- and server-supplied text goes through textContent — never innerHTML. */
const createTextElement = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(text || '');
    return el;
};

const buildStyles = mergedStyles => {
    const styleMappings = {
        overlayBg: '--orion-overlay-bg',
        overlayBlur: '--orion-overlay-blur',
        modalBg: '--orion-modal-bg',
        modalRadius: '--orion-modal-radius',
        modalShadow: '--orion-modal-shadow',
        fontFamily: '--orion-font-family',
        headingColor: '--orion-heading-color',
        textColor: '--orion-text-color',
        primaryBtnBg: '--orion-primary-btn-bg',
        primaryBtnHoverBg: '--orion-primary-btn-hover-bg',
        primaryBtnText: '--orion-primary-btn-text',
        secondaryBtnBg: '--orion-secondary-btn-bg',
        secondaryBtnHoverBg: '--orion-secondary-btn-hover-bg',
        secondaryBtnText: '--orion-secondary-btn-text',
        urgentColor: '--orion-urgent-color',
        importantColor: '--orion-important-color',
        infoColor: '--orion-info-color',
        dividerColor: '--orion-divider-color',
        brandColor: '--orion-brand-color'
    };

    const cssVariables = Object.entries(mergedStyles)
        .map(([k, v]) => `${styleMappings[k] || `--orion-${k}`}: ${v};`)
        .join(' ');

    return `
      #${ROOT_ID} { ${cssVariables} }
      #${ROOT_ID} .orion-overlay {
        position: fixed; inset: 0;
        background-color: var(--orion-overlay-bg);
        backdrop-filter: var(--orion-overlay-blur);
        -webkit-backdrop-filter: var(--orion-overlay-blur);
        z-index: 9998;
        display: flex; align-items: center; justify-content: center; padding: 1rem;
      }
      #${ROOT_ID} .orion-modal {
        position: relative;
        background-color: var(--orion-modal-bg);
        padding: 1.75rem 1.75rem 1.25rem;
        border-radius: var(--orion-modal-radius);
        box-shadow: var(--orion-modal-shadow);
        width: 460px; max-width: 100%; max-height: 85vh;
        box-sizing: border-box; overflow-y: auto;
        font-family: var(--orion-font-family);
        display: flex; flex-direction: column; gap: 1rem;
        animation: orionNotifyIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 9999;
      }
      @keyframes orionNotifyIn {
        from { opacity: 0; transform: scale(0.96) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes orionSpin { to { transform: rotate(360deg); } }
      #${ROOT_ID} .orion-heading {
        margin: 0; color: var(--orion-heading-color); font-size: 1.15rem; font-weight: 600;
      }
      #${ROOT_ID} .orion-count {
        margin: 0; color: var(--orion-text-color); font-size: 0.85rem;
      }
      #${ROOT_ID} .orion-item {
        border-top: 1px solid var(--orion-divider-color);
        padding-top: 1rem; display: flex; flex-direction: column; gap: 0.4rem;
      }
      #${ROOT_ID} .orion-badge {
        align-self: flex-start; font-size: 0.7rem; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.04em;
        padding: 0.15rem 0.5rem; border-radius: 999px; color: #fff;
      }
      #${ROOT_ID} .orion-badge-urgent    { background: var(--orion-urgent-color); }
      #${ROOT_ID} .orion-badge-important { background: var(--orion-important-color); }
      #${ROOT_ID} .orion-badge-info      { background: var(--orion-info-color); }
      #${ROOT_ID} .orion-item-title {
        margin: 0; color: var(--orion-heading-color); font-size: 0.98rem; font-weight: 600;
      }
      #${ROOT_ID} .orion-item-body {
        margin: 0; color: var(--orion-text-color); font-size: 0.9rem; line-height: 1.5;
      }
      #${ROOT_ID} .orion-actions {
        display: flex; gap: 0.6rem; margin-top: 0.5rem;
      }
      #${ROOT_ID} .orion-btn {
        flex: 1; min-height: 2.6rem; padding: 0 1rem;
        background-color: var(--orion-primary-btn-bg); color: var(--orion-primary-btn-text);
        border: none; border-radius: 8px; font-size: 0.92rem; font-weight: 500;
        cursor: pointer; transition: background-color 0.2s, opacity 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 0.5rem;
        font-family: inherit; box-sizing: border-box;
      }
      #${ROOT_ID} .orion-btn:hover:not(:disabled) { background-color: var(--orion-primary-btn-hover-bg); }
      #${ROOT_ID} .orion-btn:disabled { opacity: 0.7; cursor: not-allowed; }
      #${ROOT_ID} .orion-btn-secondary {
        background-color: var(--orion-secondary-btn-bg); color: var(--orion-secondary-btn-text);
      }
      #${ROOT_ID} .orion-btn-secondary:hover:not(:disabled) { background-color: var(--orion-secondary-btn-hover-bg); }
      #${ROOT_ID} .orion-link {
        color: var(--orion-heading-color); font-size: 0.88rem; text-decoration: underline;
        align-self: flex-start;
      }
      #${ROOT_ID} .orion-spinner {
        width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.35); box-sizing: border-box;
        border-radius: 50%; border-top-color: inherit; animation: orionSpin 0.8s linear infinite;
      }
      #${ROOT_ID} .orion-brand {
        font-size: 0.72rem; color: var(--orion-brand-color); text-align: center; user-select: none;
      }
    `;
};

const DEFAULT_STYLES = Object.freeze({
    overlayBg: 'rgba(0,0,0,0.4)',
    overlayBlur: 'blur(8px)',
    modalBg: '#ffffff',
    modalRadius: '16px',
    modalShadow: '0 20px 40px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)',
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    headingColor: '#111827',
    textColor: '#4b5563',
    primaryBtnBg: '#111827',
    primaryBtnHoverBg: '#374151',
    primaryBtnText: '#ffffff',
    secondaryBtnBg: '#f3f4f6',
    secondaryBtnHoverBg: '#e5e7eb',
    secondaryBtnText: '#374151',
    urgentColor: '#dc2626',
    importantColor: '#d97706',
    infoColor: '#2563eb',
    dividerColor: '#e5e7eb',
    brandColor: '#9ca3af'
});

const createApiLayer = (serverURL, nameSpace, slug) => {
    const Api = new ApiInterface(serverURL, nameSpace, slug);

    const ENDPOINTS = {
        LIST: `/${nameSpace}/api/v1/request/notifications`,
        SHOWN: `/${nameSpace}/api/v1/action/mark-notifications-shown`,
        ACKNOWLEDGE: `/${nameSpace}/api/v1/action/acknowledge-notifications`
    };

    const apiCall = async (endpoint, payload = null) => {
        const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

        const request = await Promise.race([
            Api.fetch(endpoint, 'POST', authHeader.authHead, payload ? { packet: payload } : null),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), API_TIMEOUT_MS))
        ]);

        return await request.json();
    };

    return { ENDPOINTS, apiCall };
};

/**
 * Asks the server whether anything needs showing, and shows it.
 *
 * Resolves with a summary rather than rejecting on "nothing to show" — this is
 * called on every authenticated page load, and a routine no-op must not look
 * like a failure to the host application.
 *
 * @returns {Promise<{ shown: boolean, acknowledged: number, pending: number }>}
 */
const renderNotificationsUI = async (serverURL, nameSpace, slug, customStyles = {}) => {
    const { ENDPOINTS, apiCall } = createApiLayer(serverURL, nameSpace, slug);

    let listed;

    try {
        listed = await apiCall(ENDPOINTS.LIST);
    } catch (error) {
        // Notifications are advisory; a failure here must never break the host
        // application's page load.
        return { shown: false, acknowledged: 0, pending: 0, error: error.message };
    }

    const data = listed?.data || {};
    const notifications = Array.isArray(data.notifications) ? data.notifications : [];

    if (listed?.error || data.prompt !== true || notifications.length === 0) {
        return { shown: false, acknowledged: 0, pending: Number(data.pending || 0) };
    }

    return new Promise(resolve => {
        const trackedListeners = [];
        const addTrackedListener = (el, event, handler) => {
            el.addEventListener(event, handler);
            trackedListeners.push({ el, event, handler });
        };

        document.getElementById(ROOT_ID)?.remove();
        document.getElementById(STYLE_ID)?.remove();

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = buildStyles({ ...DEFAULT_STYLES, ...customStyles });

        const container = document.createElement('div');
        container.id = ROOT_ID;

        const overlay = document.createElement('div');
        overlay.className = 'orion-overlay';

        const modal = document.createElement('div');
        modal.className = 'orion-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Account notifications');

        overlay.appendChild(modal);
        container.appendChild(overlay);
        document.head.appendChild(style);
        document.body.appendChild(container);

        const ids = notifications.map(notification => notification.id);
        let settled = false;

        const cleanup = () => {
            for (const { el, event, handler } of trackedListeners) {
                try {
                    el.removeEventListener(event, handler);
                } catch (_) {
                    /* noop */
                }
            }
            trackedListeners.length = 0;
            container.remove();
            style.remove();
        };

        const finish = (acknowledged = 0) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({ shown: true, acknowledged, pending: notifications.length });
        };

        // ── Content ─────────────────────────────────────────────────────────
        modal.appendChild(createTextElement('h2', 'orion-heading', notifications.length === 1 ? 'A notice about your account' : 'Notices about your account'));
        modal.appendChild(
            createTextElement('p', 'orion-count', notifications.length === 1 ? '1 item needs your attention' : `${notifications.length} items need your attention`)
        );

        for (const notification of notifications) {
            const item = document.createElement('div');
            item.className = 'orion-item';

            const severity = SEVERITY_LABELS[notification.severity] ? notification.severity : 'info';
            item.appendChild(createTextElement('span', `orion-badge orion-badge-${severity}`, SEVERITY_LABELS[severity]));
            item.appendChild(createTextElement('h3', 'orion-item-title', notification.title));
            item.appendChild(createTextElement('p', 'orion-item-body', notification.body));

            // Only same-origin or absolute http(s) destinations are linked, and
            // never as markup — a notification body must not become an
            // injection vector into the host page.
            if (notification.actionUrl && notification.actionLabel) {
                try {
                    const target = new URL(notification.actionUrl, window.location.origin);

                    if (target.protocol === 'https:' || target.protocol === 'http:') {
                        const link = createTextElement('a', 'orion-link', notification.actionLabel);
                        link.href = target.href;
                        link.rel = 'noopener noreferrer';
                        item.appendChild(link);
                    }
                } catch (_) {
                    /* malformed url — the body text still carries the message */
                }
            }

            modal.appendChild(item);
        }

        const actions = document.createElement('div');
        actions.className = 'orion-actions';

        const later = createTextElement('button', 'orion-btn orion-btn-secondary', 'Remind me later');
        later.type = 'button';

        const acknowledge = createTextElement('button', 'orion-btn', 'Got it');
        acknowledge.type = 'button';

        actions.appendChild(later);
        actions.appendChild(acknowledge);
        modal.appendChild(actions);
        modal.appendChild(createTextElement('p', 'orion-brand', 'Secured by Orion'));

        // The overlay is on screen: this is the moment that starts the server's
        // quiet period, not the moment the data was fetched.
        apiCall(ENDPOINTS.SHOWN, { ids }).catch(() => {
            /* best effort — the notice simply prompts again next load */
        });

        addTrackedListener(later, 'click', () => finish(0));

        addTrackedListener(acknowledge, 'click', async () => {
            acknowledge.disabled = true;
            later.disabled = true;

            const spinner = document.createElement('div');
            spinner.className = 'orion-spinner';
            acknowledge.textContent = '';
            acknowledge.appendChild(spinner);

            try {
                await apiCall(ENDPOINTS.ACKNOWLEDGE, { ids });
                finish(ids.length);
            } catch (_) {
                // Acknowledgement failed — close anyway rather than trapping the
                // user, and let the server re-raise it on the next load.
                finish(0);
            }
        });

        addTrackedListener(document, 'keydown', event => {
            if (event.key === 'Escape') finish(0);
        });

        acknowledge.focus();
    });
};

export { renderNotificationsUI };
