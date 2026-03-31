import { ApiInterface } from '../Utils/Api-2.js';
import { getAuthHeader } from '../Utils/Authorisation.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';
import { startAuthentication } from '../External-Scripts/webAuthn.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_ID = 'orion-auth-styles';
const ROOT_ID = 'orion-auth-root';
const API_TIMEOUT_MS = 15_000;
const SUCCESS_DISPLAY_MS = 800;

// ─────────────────────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────────────────────

const STATE = Object.freeze({
    LOADING: 'LOADING',
    METHOD_SELECTION: 'METHOD_SELECTION',
    CODE_INPUT: 'CODE_INPUT',
    SUCCESS: 'SUCCESS',
    ERROR: 'ERROR'
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Safely set text content — prevents XSS from server error messages */
const safeSetText = (el, text) => {
    if (el) el.textContent = String(text || '');
};

/** Create a text element safely (no innerHTML) */
const createTextElement = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(text || '');
    return el;
};

/** Wrap a promise with an AbortController timeout */
const withTimeout = (promiseFn, timeoutMs = API_TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return promiseFn(controller.signal)
        .then(result => { clearTimeout(timer); return result; })
        .catch(err => {
            clearTimeout(timer);
            if (err.name === 'AbortError') {
                throw new Error('Request timed out. Please try again.');
            }
            throw err;
        });
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const buildStyles = (mergedStyles) => {
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
        inputBorder: '--orion-input-border',
        inputFocusBorder: '--orion-input-focus-border',
        inputFocusRing: '--orion-input-focus-ring',
        errorColor: '--orion-error-color',
        successColor: '--orion-success-color',
        brandColor: '--orion-brand-color'
    };

    const cssVariables = Object.entries(mergedStyles)
        .map(([k, v]) => `${styleMappings[k] || `--orion-${k}`}: ${v};`)
        .join(' ');

    return `
      #${ROOT_ID} { ${cssVariables} }
      #${ROOT_ID} .orion-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: var(--orion-overlay-bg);
        backdrop-filter: var(--orion-overlay-blur);
        -webkit-backdrop-filter: var(--orion-overlay-blur);
        z-index: 9998;
        display: flex; align-items: center; justify-content: center;
      }
      #${ROOT_ID} .orion-modal {
        position: relative;
        background-color: var(--orion-modal-bg);
        padding: 2.25rem 2rem;
        border-radius: var(--orion-modal-radius);
        box-shadow: var(--orion-modal-shadow);
        width: 380px; max-width: 90vw;
        box-sizing: border-box;
        font-family: var(--orion-font-family);
        display: flex; flex-direction: column; align-items: stretch; gap: 1.25rem;
        animation: orionFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 9999;
      }
      #${ROOT_ID} .orion-shake { animation: orionShake 0.4s ease-in-out; }
      @keyframes orionFadeIn {
        from { opacity: 0; transform: scale(0.96) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      @keyframes orionShake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-6px); }
        40%, 80% { transform: translateX(6px); }
      }
      @keyframes orionSpin { to { transform: rotate(360deg); } }
      @keyframes orionPop {
        0% { transform: scale(0.8); opacity: 0; }
        60% { transform: scale(1.05); opacity: 1; }
        100% { transform: scale(1); }
      }
      #${ROOT_ID} .orion-btn {
        width: 100%; min-height: 2.75rem; padding: 0 1rem;
        background-color: var(--orion-primary-btn-bg); color: var(--orion-primary-btn-text);
        border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 500;
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
      #${ROOT_ID} .orion-input {
        width: 100%; padding: 0.75rem 1rem; border: 1px solid var(--orion-input-border);
        border-radius: 8px; font-size: 0.95rem; box-sizing: border-box;
        transition: border-color 0.2s, box-shadow 0.2s; color: var(--orion-heading-color);
        background: transparent; font-family: inherit;
      }
      #${ROOT_ID} .orion-input:focus {
        border-color: var(--orion-input-focus-border);
        box-shadow: var(--orion-input-focus-ring);
        outline: none;
      }
      #${ROOT_ID} .orion-spinner {
        width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); box-sizing: border-box;
        border-radius: 50%; border-top-color: inherit; animation: orionSpin 0.8s linear infinite;
      }
      #${ROOT_ID} .orion-heading {
        margin: 0; color: var(--orion-heading-color); font-size: 1.25rem; font-weight: 600; text-align: center;
      }
      #${ROOT_ID} .orion-subhead {
        margin: 0; color: var(--orion-text-color); font-size: 0.95rem; text-align: center; line-height: 1.4;
      }
      #${ROOT_ID} .orion-err {
        color: var(--orion-error-color); font-size: 0.85rem; min-height: 1rem; text-align: center;
      }
      #${ROOT_ID} .orion-brand {
        font-size: 0.75rem; color: var(--orion-brand-color); text-align: center; margin-top: 0.25rem; user-select: none;
      }
    `;
};

// ─────────────────────────────────────────────────────────────────────────────
// API Layer (decoupled from UI)
// ─────────────────────────────────────────────────────────────────────────────

const createApiLayer = (serverURL, nameSpace, slug) => {
    const Api = new ApiInterface(serverURL, nameSpace, slug);

    const ENDPOINTS = {
        METHODS:         `/${nameSpace}/api/v1/request/step-up-methods`,
        SEND_EMAIL:      `/${nameSpace}/api/v1/action/initiate-step-up-email`,
        AUTH_EMAIL:      `/${nameSpace}/api/v1/action/verify-step-up-email`,
        PASSKEY_OPTIONS: `/${nameSpace}/api/v1/action/generate-step-up-passkey-options`,
        AUTH_PASSKEY:    `/${nameSpace}/api/v1/action/verify-step-up-passkey`,
        AUTH_TOTP:       `/${nameSpace}/api/v1/action/verify-step-up-totp`
    };

    const apiCall = async (endpoint, payload = null, encryptKeys = []) => {
        const dipConfig = globalAccessPoint.getValue('dipConfig');
        const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

        let reqPayload = payload ? { packet: payload } : null;
        let encryptionMeta = null;

        if (payload && encryptKeys.length > 0) {
            const encryptedData = await Api.prepareDataForEncryption(payload);
            reqPayload = { packet: { encryptedString: encryptedData.encryptedString } };
            encryptionMeta = encryptedData.encryption;
        }

        let dipOptions = null;
        if (reqPayload) {
            const signature = await Api.prepareDataForDIP(reqPayload, dipConfig);
            dipOptions = {
                ...dipConfig, dipState: 'ACTIVE',
                dipSignature: signature.dipSignature, salt: signature.salt, timestamp: signature.timestamp
            };
        }

        const req = await Api.fetch(endpoint, 'POST', authHeader.authHead, reqPayload, dipOptions, encryptionMeta);
        return await req.json();
    };

    return { ENDPOINTS, apiCall };
};

// ─────────────────────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────────────────────

const renderStepUpAuthUI = (serverURL, nameSpace, slug, customStyles = {}) => {
    return new Promise(async (resolve, reject) => {

        // ── Track state & listeners for cleanup ─────────────────────────────
        let currentState = STATE.LOADING;
        const trackedListeners = [];

        const addTrackedListener = (el, event, handler) => {
            el.addEventListener(event, handler);
            trackedListeners.push({ el, event, handler });
        };

        // ── Prevent duplicate overlays ──────────────────────────────────────
        const existingRoot = document.getElementById(ROOT_ID);
        if (existingRoot) existingRoot.remove();
        const existingStyle = document.getElementById(STYLE_ID);
        if (existingStyle) existingStyle.remove();

        // ── Styles ──────────────────────────────────────────────────────────
        const defaultStyles = {
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
            inputBorder: '#d1d5db',
            inputFocusBorder: '#111827',
            inputFocusRing: '0 0 0 1px #111827',
            errorColor: '#ef4444',
            successColor: '#22c55e',
            brandColor: '#9ca3af'
        };

        const mergedStyles = { ...defaultStyles, ...customStyles };

        // ── DOM Elements ────────────────────────────────────────────────────
        const container = document.createElement('div');
        container.id = ROOT_ID;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = buildStyles(mergedStyles);

        document.head.appendChild(style);
        document.body.appendChild(container);

        container.innerHTML = `
          <div class="orion-overlay">
            <div class="orion-modal" id="orion-auth-modal" role="dialog" aria-modal="true" aria-labelledby="orion-modal-heading">
               <!-- Content gets injected here -->
            </div>
          </div>
        `;

        const modal = document.getElementById('orion-auth-modal');

        // ── API layer ───────────────────────────────────────────────────────
        const { ENDPOINTS, apiCall } = createApiLayer(serverURL, nameSpace, slug);

        // ── Cleanup ─────────────────────────────────────────────────────────
        const cleanup = () => {
            // Remove all tracked event listeners
            for (const { el, event, handler } of trackedListeners) {
                try { el.removeEventListener(event, handler); } catch (_) { /* noop */ }
            }
            trackedListeners.length = 0;

            // Remove DOM elements
            if (document.body.contains(container)) document.body.removeChild(container);
            if (document.head.contains(style)) document.head.removeChild(style);
        };

        // ── Keyboard handler (Escape to close) ─────────────────────────────
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                reject(new Error('User cancelled step-up authorization.'));
            }
        };
        addTrackedListener(document, 'keydown', onKeyDown);

        // ── Focus trap ──────────────────────────────────────────────────────
        const trapFocus = (e) => {
            if (!container.contains(e.target)) {
                const focusable = modal.querySelector('button, input, [tabindex]');
                if (focusable) focusable.focus();
            }
        };
        addTrackedListener(document, 'focusin', trapFocus);

        // ── View Renderers ──────────────────────────────────────────────────
        const renderLoading = (text) => {
            currentState = STATE.LOADING;
            modal.innerHTML = '';
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:1.25rem; padding: 1.5rem 0;';

            const spinner = document.createElement('div');
            spinner.className = 'orion-spinner';
            spinner.style.cssText = 'border-width: 3px; border-color: rgba(17, 24, 39, 0.1); border-top-color: var(--orion-heading-color); width: 28px; height: 28px;';
            spinner.setAttribute('role', 'status');
            spinner.setAttribute('aria-label', 'Loading');

            const p = createTextElement('p', 'orion-subhead', text);

            wrapper.appendChild(spinner);
            wrapper.appendChild(p);
            modal.appendChild(wrapper);
        };

        const renderSuccess = () => {
            currentState = STATE.SUCCESS;
            modal.innerHTML = '';

            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.25rem; animation: orionFadeIn 0.3s ease-out;';

            const circle = document.createElement('div');
            circle.style.cssText = 'width: 64px; height: 64px; border-radius: 50%; background-color: var(--orion-success-color); display: flex; align-items: center; justify-content: center; animation: orionPop 0.4s cubic-bezier(0.16, 1, 0.3, 1);';
            circle.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

            const heading = createTextElement('h3', 'orion-heading', 'Identity Verified');
            heading.style.color = 'var(--orion-success-color)';
            heading.setAttribute('aria-live', 'polite');

            wrapper.appendChild(circle);
            wrapper.appendChild(heading);
            modal.appendChild(wrapper);

            setTimeout(() => {
                cleanup();
                resolve();
            }, SUCCESS_DISPLAY_MS);
        };

        const renderError = (msg, retryCallback) => {
            currentState = STATE.ERROR;
            modal.classList.remove('orion-shake');
            void modal.offsetWidth;
            modal.classList.add('orion-shake');

            const errDiv = document.getElementById('error-msg');
            if (errDiv) {
                safeSetText(errDiv, msg);
            } else {
                modal.innerHTML = '';

                const heading = createTextElement('h2', 'orion-heading', 'Verification Failed');
                heading.id = 'orion-modal-heading';

                const errP = createTextElement('p', 'orion-subhead', msg);
                errP.style.color = 'var(--orion-error-color)';
                errP.style.padding = '0.5rem 0';
                errP.setAttribute('role', 'alert');

                const retryBtn = document.createElement('button');
                retryBtn.className = 'orion-btn';
                retryBtn.textContent = 'Try Again';
                retryBtn.setAttribute('aria-label', 'Try again');
                retryBtn.onclick = retryCallback;

                const brand = createTextElement('div', 'orion-brand', 'Secured by Orion');

                modal.append(heading, errP, retryBtn, brand);
            }
        };

        const renderCodeInput = (title, description, submitHandler, backHandler) => {
            currentState = STATE.CODE_INPUT;
            modal.innerHTML = '';

            const heading = createTextElement('h2', 'orion-heading', title);
            heading.id = 'orion-modal-heading';

            const desc = createTextElement('p', 'orion-subhead', description);

            const inputWrapper = document.createElement('div');
            inputWrapper.style.margin = '0.5rem 0';

            const input = document.createElement('input');
            input.type = 'text';
            input.id = 'auth-code-input';
            input.className = 'orion-input';
            input.placeholder = 'Enter Code';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.setAttribute('aria-label', `Enter ${title} verification code`);
            inputWrapper.appendChild(input);

            const btnWrapper = document.createElement('div');
            btnWrapper.style.cssText = 'display:flex; flex-direction:column; gap:0.75rem;';

            const submitBtn = document.createElement('button');
            submitBtn.className = 'orion-btn';
            submitBtn.id = 'submit-code-btn';
            submitBtn.setAttribute('aria-label', 'Verify OTP');
            const submitSpan = document.createElement('span');
            submitSpan.textContent = 'Verify OTP';
            const submitSpinner = document.createElement('div');
            submitSpinner.className = 'orion-spinner';
            submitSpinner.style.display = 'none';
            submitBtn.append(submitSpan, submitSpinner);

            const backBtn = document.createElement('button');
            backBtn.className = 'orion-btn orion-btn-secondary';
            backBtn.id = 'back-btn';
            backBtn.textContent = 'Choose another method';
            backBtn.setAttribute('aria-label', 'Go back to method selection');
            btnWrapper.append(submitBtn, backBtn);

            const errDiv = document.createElement('div');
            errDiv.id = 'error-msg';
            errDiv.className = 'orion-err';
            errDiv.setAttribute('role', 'alert');
            errDiv.setAttribute('aria-live', 'polite');

            const brand = createTextElement('div', 'orion-brand', 'Secured by Orion');

            modal.append(heading, desc, inputWrapper, btnWrapper, errDiv, brand);

            setTimeout(() => input.focus(), 100);

            const onSubmit = async () => {
                const code = input.value.trim();
                if (!code) return renderError('Please enter a valid code.');

                input.disabled = true;
                submitBtn.disabled = true;
                backBtn.disabled = true;
                submitSpan.style.display = 'none';
                submitSpinner.style.display = 'block';

                try {
                    await submitHandler(code);
                } catch (err) {
                    renderError(err.message || 'Verification failed.', () => renderCodeInput(title, description, submitHandler, backHandler));
                }

                if (document.body.contains(submitBtn)) {
                    input.disabled = false;
                    submitBtn.disabled = false;
                    backBtn.disabled = false;
                    submitSpan.style.display = 'block';
                    submitSpinner.style.display = 'none';
                    input.value = '';
                    input.focus();
                }
            };

            submitBtn.onclick = onSubmit;
            backBtn.onclick = backHandler;
            addTrackedListener(input, 'keypress', (e) => { if (e.key === 'Enter') onSubmit(); });
        };

        const renderMethodSelection = (methods) => {
            currentState = STATE.METHOD_SELECTION;
            modal.innerHTML = '';

            const heading = createTextElement('h2', 'orion-heading', 'Verify your identity');
            heading.id = 'orion-modal-heading';

            const subhead = createTextElement('p', 'orion-subhead', 'A risk signal was detected. Please confirm your identity to continue.');

            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display:flex; flex-direction:column; gap:0.75rem; margin-top: 0.5rem;';

            if (methods.passkey) {
                const btn = document.createElement('button');
                btn.className = 'orion-btn';
                btn.id = 'btn-passkey';
                btn.style.backgroundColor = 'var(--orion-heading-color)';
                btn.setAttribute('aria-label', 'Verify with Passkey');
                btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>`;
                const label = document.createTextNode(' Passkey');
                btn.appendChild(label);
                btnContainer.appendChild(btn);

                btn.onclick = async () => {
                    renderLoading('Waiting for Passkey...');
                    try {
                        const optionsRes = await withTimeout(() => apiCall(ENDPOINTS.PASSKEY_OPTIONS));
                        if (optionsRes.error) throw new Error(optionsRes.errorData?.context?.[0] || 'Failed to retrieve passkey options.');
                        const options = optionsRes.data.options;
                        const passkeyResponse = await withTimeout(() => startAuthentication(options));
                        const verifyData = await withTimeout(() =>
                            apiCall(ENDPOINTS.AUTH_PASSKEY, { authenticationResponse: passkeyResponse }, ['authenticationResponse'])
                        );
                        if (verifyData.error) throw new Error(verifyData.errorData?.context?.[0] || 'Passkey verification failed.');
                        renderSuccess();
                    } catch (e) {
                        renderError(e.message, () => renderMethodSelection(methods));
                    }
                };
            }

            if (methods.totp) {
                const btn = document.createElement('button');
                btn.className = 'orion-btn orion-btn-secondary';
                btn.id = 'btn-totp';
                btn.setAttribute('aria-label', 'Verify with Authenticator App');
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`;
                const label = document.createTextNode(' Authenticator App');
                btn.appendChild(label);
                btnContainer.appendChild(btn);

                btn.onclick = () => {
                    renderCodeInput('Authenticator App', 'Enter the 6-digit code from your authenticator application.', async (code) => {
                        const res = await withTimeout(() => apiCall(ENDPOINTS.AUTH_TOTP, { totpCode: code }, ['totpCode']));
                        if (res.error) renderError(res.errorData?.context?.[0] || 'Invalid authenticator code.');
                        else renderSuccess();
                    }, () => renderMethodSelection(methods));
                };
            }

            if (methods['email-code']) {
                const btn = document.createElement('button');
                btn.className = 'orion-btn orion-btn-secondary';
                btn.id = 'btn-email';
                btn.setAttribute('aria-label', 'Verify with Email OTP');
                btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;
                const label = document.createTextNode(' Email OTP');
                btn.appendChild(label);
                btnContainer.appendChild(btn);

                btn.onclick = async () => {
                    renderLoading('Sending verification email...');
                    try {
                        const res = await withTimeout(() => apiCall(ENDPOINTS.SEND_EMAIL));
                        if (res.error) {
                            renderError(res.errorData?.context?.[0] || 'Failed to send verification email.', () => renderMethodSelection(methods));
                            return;
                        }
                        renderCodeInput('Email OTP', 'Enter the 6-digit code sent to your registered email.', async (code) => {
                            const verifyRes = await withTimeout(() =>
                                apiCall(ENDPOINTS.AUTH_EMAIL, { code: code }, ['code'])
                            );
                            if (verifyRes.error) renderError(verifyRes.errorData?.context?.[0] || 'Invalid email verification code.');
                            else renderSuccess();
                        }, () => renderMethodSelection(methods));
                    } catch (e) {
                        renderError(e.message, () => renderMethodSelection(methods));
                    }
                };
            }

            const errDiv = document.createElement('div');
            errDiv.id = 'error-msg';
            errDiv.className = 'orion-err';
            errDiv.setAttribute('role', 'alert');
            errDiv.setAttribute('aria-live', 'polite');

            const brand = createTextElement('div', 'orion-brand', 'Secured by Orion');

            modal.append(heading, subhead, btnContainer, errDiv, brand);
        };

        // ── Initialization ──────────────────────────────────────────────────
        try {
            renderLoading('Loading security methods...');
            const methodsRes = await withTimeout(() => apiCall(ENDPOINTS.METHODS));

            if (methodsRes.error) {
                renderError('Unable to load available verification methods.', () => {
                    cleanup();
                    renderStepUpAuthUI(serverURL, nameSpace, slug, customStyles).then(resolve).catch(reject);
                });
            } else {
                renderMethodSelection(methodsRes.data.methods);
            }
        } catch (e) {
            cleanup();
            reject(new Error(e.message || 'Step-up authorization failed.'));
        }
    });
};

export { renderStepUpAuthUI };
