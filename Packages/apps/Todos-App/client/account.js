import { orion } from './orion-client.js';

const alertEl = document.getElementById('alert-global');

// Profile
const pEmail = document.getElementById('p-email');
const p2fa = document.getElementById('p-2fa');
const pDevices = document.getElementById('p-devices');

// Passkey
const passkeyStatus = document.getElementById('passkey-status');
const registerPasskeyBtn = document.getElementById('register-passkey-btn');
const removePasskeyBtn = document.getElementById('remove-passkey-btn');
const passkeyRemoveSection = document.getElementById('passkey-remove-section');

// TOTP
const totpStatus = document.getElementById('totp-status');
const setupTotpBtn = document.getElementById('setup-totp-btn');
const totpSetupSection = document.getElementById('totp-setup-section');
const totpSecretSection = document.getElementById('totp-secret-section');
const totpSecret = document.getElementById('totp-secret');
const totpQr = document.getElementById('totp-qr');
const totpVerifyInput = document.getElementById('totp-verify-input');
const totpVerifyBtn = document.getElementById('totp-verify-btn');
const totpCancelBtn = document.getElementById('totp-cancel-btn');
const removeTotpBtn = document.getElementById('remove-totp-btn');
const totpRemoveSection = document.getElementById('totp-remove-section');

// 2FA removal
const removalCard = document.getElementById('removal-card');
const removalAlert = document.getElementById('removal-alert');
const removalCode = document.getElementById('removal-code');
const removalVerifyBtn = document.getElementById('removal-verify-btn');
const removalCancelBtn = document.getElementById('removal-cancel-btn');
const removalDesc = document.getElementById('removal-desc');

let currentRemovalMethod = null;

function showAlert(el, msg, type = 'error') {
    el.textContent = msg;
    el.className = `alert alert-${type} show`;
    setTimeout(() => el.classList.remove('show'), 5000);
}
function setLoading(btn, loading) {
    btn.classList.toggle('loading', loading);
    btn.disabled = loading;
}
function setStatusBadge(el, active) {
    el.className = active ? 'badge badge-active' : 'badge badge-inactive';
    el.innerHTML = active ? '<span class="status-dot active"></span> Active' : '<span class="status-dot inactive"></span> Inactive';
}

async function loadProfile() {
    try {
        const result = await orion.getUserProfile();
        if (result.error) {
            showAlert(alertEl, result.errorCode || 'Failed to load profile.');
            return;
        }
        const p = result.profile;
        pEmail.textContent = p.email || '—';
        p2fa.textContent = p.security.twoFA ? 'Yes' : 'No';
        pDevices.textContent = p.security.recognizedDevices ?? 0;

        setStatusBadge(passkeyStatus, p.security.passkey.enabled);
        registerPasskeyBtn.style.display = p.security.passkey.enabled ? 'none' : 'block';
        passkeyRemoveSection.style.display = p.security.passkey.enabled ? 'block' : 'none';

        setStatusBadge(totpStatus, p.security.totp.enabled);
        totpSetupSection.style.display = p.security.totp.enabled ? 'none' : 'block';
        totpRemoveSection.style.display = p.security.totp.enabled ? 'block' : 'none';
    } catch (err) {
        showAlert(alertEl, 'Profile load error: ' + err.message);
    }
}

// ── Passkey registration ──
registerPasskeyBtn.addEventListener('click', async () => {
    setLoading(registerPasskeyBtn, true);
    try {
        const result = await orion.registerPasskey();
        if (result.error) {
            showAlert(alertEl, result.errorCode || 'Passkey registration failed.');
        } else {
            showAlert(alertEl, 'Passkey registered!', 'success');
            await loadProfile();
        }
    } catch (err) {
        showAlert(alertEl, err.message || 'Passkey error.');
    }
    setLoading(registerPasskeyBtn, false);
});

// ── TOTP setup ──
setupTotpBtn.addEventListener('click', async () => {
    setLoading(setupTotpBtn, true);
    try {
        const result = await orion.setupTOTP();
        if (result.error) {
            showAlert(alertEl, result.errorCode || 'TOTP setup failed.');
        } else {
            totpSecret.textContent = result.secret;
            totpQr.src = result.qrCode;
            totpSetupSection.style.display = 'none';
            totpSecretSection.style.display = 'block';
        }
    } catch (err) {
        showAlert(alertEl, err.message || 'TOTP setup error.');
    }
    setLoading(setupTotpBtn, false);
});

totpCancelBtn.addEventListener('click', () => {
    totpSecretSection.style.display = 'none';
    totpSetupSection.style.display = 'block';
    totpVerifyInput.value = '';
});

totpVerifyBtn.addEventListener('click', async () => {
    const code = totpVerifyInput.value.trim();
    if (code.length < 6) return showAlert(alertEl, 'Enter a valid 6-digit code.');
    setLoading(totpVerifyBtn, true);
    try {
        const result = await orion.verifyAndEnableTOTP(code);
        if (result.error) {
            showAlert(alertEl, result.errorCode || 'TOTP verification failed.');
        } else {
            showAlert(alertEl, 'TOTP enabled!', 'success');
            totpSecretSection.style.display = 'none';
            await loadProfile();
        }
    } catch (err) {
        showAlert(alertEl, err.message || 'TOTP verify error.');
    }
    setLoading(totpVerifyBtn, false);
});

// ── 2FA removal (email OTP) ──
async function initiateRemoval(method) {
    currentRemovalMethod = method;
    const label = method === 'totp' ? 'TOTP' : 'Passkey';
    removalDesc.textContent = `A verification code has been emailed to you. Enter it to confirm ${label} removal.`;
    const btn = method === 'totp' ? removeTotpBtn : removePasskeyBtn;
    setLoading(btn, true);
    try {
        const result = await orion.initiate2FAMethodRemoval(method);
        if (result.error) {
            showAlert(alertEl, result.errorCode || `Failed to initiate ${label} removal.`);
        } else {
            showAlert(alertEl, 'Verification code emailed.', 'success');
            removalCard.style.display = 'block';
            removalCode.value = '';
            removalCode.focus();
        }
    } catch (err) {
        showAlert(alertEl, err.message || 'Removal error.');
    }
    setLoading(btn, false);
}
removeTotpBtn.addEventListener('click', () => initiateRemoval('totp'));
removePasskeyBtn.addEventListener('click', () => initiateRemoval('passkey'));
removalCancelBtn.addEventListener('click', () => {
    removalCard.style.display = 'none';
    currentRemovalMethod = null;
});

removalVerifyBtn.addEventListener('click', async () => {
    const code = removalCode.value.trim();
    if (!code) return showAlert(removalAlert, 'Enter the verification code.');
    setLoading(removalVerifyBtn, true);
    try {
        const result = await orion.complete2FAMethodRemoval(code);
        if (result.error) {
            showAlert(removalAlert, result.errorCode || 'Verification failed.');
        } else {
            const label = currentRemovalMethod === 'totp' ? 'TOTP' : 'Passkey';
            showAlert(alertEl, `${label} removed!`, 'success');
            removalCard.style.display = 'none';
            currentRemovalMethod = null;
            await loadProfile();
        }
    } catch (err) {
        showAlert(removalAlert, err.message || 'Removal error.');
    }
    setLoading(removalVerifyBtn, false);
});

// Load profile once authenticated (app.js owns the loading overlay + redirect)
orion.onAuthStateChanged(state => {
    if (state.status === 'AUTHENTICATED') loadProfile();
});
