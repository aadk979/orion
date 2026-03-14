import { ApiInterface } from '../Utils/Api-2.js';
import { getAuthHeader } from '../Utils/Authorisation.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';
import { startAuthentication } from '../External-Scripts/webAuthn.js';

const renderDeviceAuthorizationUI = async (serverURL, nameSpace, slug) => {
    try {
        // --- Elements ---
        const overlay = document.createElement('div');
        const modal = document.createElement('div');
        const style = document.createElement('style');

        // --- Configuration ---
        const Api = new ApiInterface(serverURL, nameSpace, slug);
        const ENDPOINTS = {
            METHODS: `/${nameSpace}/api/v1/request/available-2fa-methods`,
            SEND_EMAIL: `/${nameSpace}/api/v1/action/send-device-authorization-email`,
            AUTH_EMAIL: `/${nameSpace}/api/v1/action/authorize-me`,
            AUTH_PASSKEY: `/${nameSpace}/api/v1/action/authorize-device-with-passkey`,
            AUTH_TOTP: `/${nameSpace}/api/v1/action/authorize-device-with-totp`
        };

        // Overlay
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.55)';
        overlay.style.backdropFilter = 'blur(6px)';
        overlay.style.zIndex = '9998';

        // Modal base
        modal.style.position = 'fixed';
        modal.style.top = '50%';
        modal.style.left = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
        modal.style.zIndex = '9999';
        modal.style.backgroundColor = '#ffffff';
        modal.style.padding = '2rem';
        modal.style.borderRadius = '16px';
        modal.style.boxShadow = '0 8px 32px rgba(0,0,0,0.12)';
        modal.style.width = '380px';
        modal.style.maxWidth = '90vw';
        modal.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
        modal.style.display = 'flex';
        modal.style.flexDirection = 'column';
        modal.style.alignItems = 'stretch';
        modal.style.gap = '1.25rem';
        modal.style.animation = 'fadeIn 0.25s ease-out';

        // Animations
        style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translate(-50%, -47%); }
        to { opacity: 1; transform: translate(-50%, -50%); }
      }
      .shake {
        animation: shake 0.4s ease-in-out;
      }
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-6px); }
        40%, 80% { transform: translateX(6px); }
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      @keyframes pop {
        0% { transform: scale(0); opacity: 0; }
        60% { transform: scale(1.1); opacity: 1; }
        100% { transform: scale(1); }
      }
      .orion-btn {
        width: 100%; min-height: 2.5rem; padding: 0.85rem;
        background-color: #2563eb; color: #ffffff;
        border: none; border-radius: 8px; font-size: 0.95rem; font-weight: 600;
        cursor: pointer; transition: background-color 0.2s, opacity 0.2s;
        display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      }
      .orion-btn:hover:not(:disabled) { background-color: #1d4ed8; }
      .orion-btn-secondary {
        background-color: #f3f4f6; color: #374151;
      }
      .orion-btn-secondary:hover:not(:disabled) { background-color: #e5e7eb; }
      .orion-input {
        width: 100%; padding: 0.75rem 1rem; border: 1px solid #e5e7eb;
        border-radius: 8px; font-size: 0.95rem; transition: border-color 0.2s, box-shadow 0.2s;
        color: black; box-sizing: border-box;
      }
      .orion-input:focus {
        border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25); outline: none;
      }
      .spinner {
        width: 0.95rem; height: 0.95rem; border: 3px solid rgba(255,255,255,0.3);
        border-radius: 50%; border-top-color: inherit; animation: spin 1s linear infinite;
      }
    `;
        document.head.appendChild(style);
        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        // API Helpers
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

        // --- View Renderers ---
        const renderLoading = (text) => {
            modal.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:1rem; padding: 2rem 0;">
                    <div class="spinner" style="border-top-color: #2563eb; border-color: rgba(37, 99, 235, 0.2); width: 2rem; height: 2rem; border-width: 4px;"></div>
                    <p style="color: #4b5563; font-size: 0.95rem; margin:0;">${text}</p>
                </div>
            `;
        };

        const renderSuccess = () => {
            modal.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;">
                    <div style="width: 80px; height: 80px; border-radius: 50%; background-color: #22c55e; display: flex; align-items: center; justify-content: center; animation: pop 0.4s ease-out;">
                        <div style="width: 35px; height: 18px; border-left: 4px solid #fff; border-bottom: 4px solid #fff; transform: rotate(-45deg);"></div>
                    </div>
                    <h3 style="color: #16a34a; font-size: 1.25rem; font-weight: 600; margin: 0; text-align: center;">Device Authorized</h3>
                    <p id="countdown-text" style="color: #4b5563; font-size: 0.95rem; margin: 0; text-align: center;">Reloading in 5 seconds...</p>
                    <button class="orion-btn" onclick="location.reload()">Reload Now</button>
                </div>
            `;
            let seconds = 5;
            const textElement = document.getElementById('countdown-text');
            const countdown = setInterval(() => {
                seconds--;
                if (seconds <= 0) {
                    clearInterval(countdown);
                    location.reload();
                }
            }, 1000);
        };

        const renderError = (msg, retryCallback) => {
            modal.classList.remove('shake');
            void modal.offsetWidth;
            modal.classList.add('shake');

            const errDiv = document.getElementById('error-msg');
            if (errDiv) {
                errDiv.textContent = msg;
            } else {
                modal.innerHTML = `
                    <h2 style="margin: 0; color: #1a202c; font-size: 1.25rem; font-weight: 600; text-align: center;">Error</h2>
                    <p style="margin: 0; color: #dc2626; font-size: 0.95rem; text-align: center;">${msg}</p>
                    <button class="orion-btn" id="retry-btn">Try Again</button>
                    <span style="font-size: 0.75rem; color: #a0aec0; text-align: center; margin-top: 0.5rem;">Secured by Orion</span>
                `;
                document.getElementById('retry-btn').onclick = retryCallback;
            }
        };

        const renderCodeInput = (title, description, submitHandler, backHandler) => {
            modal.innerHTML = `
                    <h2 style="margin: 0; color: #1a202c; font-size: 1.25rem; font-weight: 600; text-align: center;">${title}</h2>
                <p style="margin: 0; color: #4a5568; font-size: 0.95rem; text-align: center;">${description}</p>
                <div><input type="text" id="auth-code-input" class="orion-input" placeholder="Enter Code" autocomplete="off" spellcheck="false" /></div>
                <button class="orion-btn" id="submit-code-btn"><span>Verify</span><div class="spinner" style="display:none;"></div></button>
                <button class="orion-btn orion-btn-secondary" id="back-btn">Back to Methods</button>
                <div id="error-msg" style="color: #dc2626; font-size: 0.85rem; min-height: 1rem; text-align: center;"></div>
                <span style="font-size: 0.75rem; color: #a0aec0; text-align: center; margin-top: 0.5rem;">Secured by Orion</span>
                `;
            const input = document.getElementById('auth-code-input');
            const btn = document.getElementById('submit-code-btn');
            const backBtn = document.getElementById('back-btn');

            setTimeout(() => input.focus(), 100);

            const onSubmit = async () => {
                const code = input.value.trim();
                if (!code) return renderError('Please enter a code.');
                input.disabled = true;
                btn.disabled = true;
                backBtn.disabled = true;
                btn.querySelector('span').style.display = 'none';
                btn.querySelector('.spinner').style.display = 'block';

                await submitHandler(code);

                if (document.body.contains(btn)) {
                    input.disabled = false;
                    btn.disabled = false;
                    backBtn.disabled = false;
                    btn.querySelector('span').style.display = 'block';
                    btn.querySelector('.spinner').style.display = 'none';
                    input.value = '';
                    input.focus();
                }
            };

            btn.onclick = onSubmit;
            backBtn.onclick = backHandler;
            input.onkeypress = (e) => { if (e.key === 'Enter') onSubmit(); };
        };

        const renderMethodSelection = (methods) => {
            let buttonsHtml = '';

            if (methods.passkey) {
                buttonsHtml += `<button class="orion-btn" id="btn-passkey" style="background-color: #10b981;">Use Passkey</button>`;
            }
            if (methods.totp) {
                buttonsHtml += `<button class="orion-btn" id="btn-totp" style="background-color: #8b5cf6;">Authenticator App (TOTP)</button>`;
            }
            if (methods['email-code']) {
                buttonsHtml += `<button class="orion-btn" id="btn-email">Email Code</button>`;
            }

            modal.innerHTML = `
                    <h2 style="margin: 0; color: #1a202c; font-size: 1.25rem; font-weight: 600; text-align: center;">Verify it's you</h2>
                    <p style="margin: 0; color: #4a5568; font-size: 0.95rem; text-align: center;">Select a 2FA method to authorize this device.</p>
                <div style="display:flex; flex-direction:column; gap:0.75rem;">
                    ${buttonsHtml}
                </div>
                <div id="error-msg" style="color: #dc2626; font-size: 0.85rem; min-height: 1rem; text-align: center;"></div>
                <span style="font-size: 0.75rem; color: #a0aec0; text-align: center; margin-top: 0.5rem;">Secured by Orion</span>
                `;

            if (methods.passkey) {
                document.getElementById('btn-passkey').onclick = async () => {
                    renderLoading('Waiting for Passkey...');
                    try {
                        const passkeyResponse = await startAuthentication({});
                        const verifyData = await apiCall(ENDPOINTS.AUTH_PASSKEY, { authenticationResponse: passkeyResponse }, ['authenticationResponse']);
                        if (verifyData.error) throw new Error(verifyData.errorData?.context[0] || 'Passkey verification failed');
                        renderSuccess();
                    } catch (e) {
                        renderError(e.message, () => renderMethodSelection(methods));
                    }
                };
            }

            if (methods.totp) {
                document.getElementById('btn-totp').onclick = () => {
                    renderCodeInput('Authenticator App', 'Enter the 6-digit code from your authenticator app.', async (code) => {
                        const res = await apiCall(ENDPOINTS.AUTH_TOTP, { totpCode: code }, ['totpCode']);
                        if (res.error) renderError(res.errorData?.context[0] || 'Invalid TOTP code.');
                        else renderSuccess();
                    }, () => renderMethodSelection(methods));
                };
            }

            if (methods['email-code']) {
                document.getElementById('btn-email').onclick = async () => {
                    renderLoading('Sending email...');
                    const res = await apiCall(ENDPOINTS.SEND_EMAIL);
                    if (res.error) {
                        renderError(res.errorData?.context[0] || 'Failed to send email.', () => renderMethodSelection(methods));
                        return;
                    }
                    renderCodeInput('Email Code', 'Enter the authorization code sent to your email.', async (code) => {
                        const verifyRes = await apiCall(ENDPOINTS.AUTH_EMAIL, { authorizationCode: code }, ['authorizationCode']);
                        if (verifyRes.error) renderError(verifyRes.errorData?.context[0] || 'Invalid email code.');
                        else renderSuccess();
                    }, () => renderMethodSelection(methods));
                };
            }
        };

        // --- Initialization ---
        renderLoading('Loading security methods...');
        const methodsRes = await apiCall(ENDPOINTS.METHODS);

        if (methodsRes.error) {
            renderError('Unable to load 2FA methods.', () => renderDeviceAuthorizationUI(serverURL, nameSpace, slug));
        } else {
            renderMethodSelection(methodsRes.data.methods);
        }

    } catch (e) {
        throw new Error(e);
    }
};

export { renderDeviceAuthorizationUI };
