import { getDeviceFingerprint } from "./DevicePrint.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STYLE_ID  = 'orion-captcha-styles';
const ROOT_ID   = 'orion-captcha-root';
const FETCH_TIMEOUT_MS = 15_000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Safely set text content — prevents XSS from server error messages */
const safeSetText = (el, text) => {
  if (el) el.textContent = String(text || '');
};

/** Create a text element safely (no innerHTML for user/server data) */
const createTextEl = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = String(text || '');
  return el;
};

/** Build the standard Orion headers for unauthenticated requests */
const buildNoAuthHeaders = async () => ({
  "Content-Type": "application/json",
  "Accept-Encoding": "gzip, deflate, br",
  Authorization: "NO_BEARER",
  "orion-fingerprint": await getDeviceFingerprint(),
  "orion-user-agent": navigator.userAgent,
  "orion-dip-state": "NONE",
  "orion-dip-id": "DEFAULT NONE",
  "orion-dip-signature": "DEFAULT NONE",
  "orion-dip-salt": "DEFAULT NONE",
  "orion-dip-timestamp": "DEFAULT NONE",
  "orion-encryption-status": "NONE",
  "orion-encryption-request-id": "NONE",
  "orion-api-system-version": "1.0.0[BETA]",
});

/** Wrap a fetch call with an AbortController timeout */
const fetchWithTimeout = async (url, options, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles builder
// ─────────────────────────────────────────────────────────────────────────────

const buildCaptchaStyles = (mergedStyles) => {
  const styleMappings = {
    overlayBg: "--orion-overlay-bg",
    overlayBlur: "--orion-overlay-blur",
    modalBg: "--orion-modal-bg",
    modalRadius: "--orion-modal-radius",
    modalShadow: "--orion-modal-shadow",
    fontFamily: "--orion-font-family",
    headingColor: "--orion-heading-color",
    textColor: "--orion-text-color",
    primaryBtnBg: "--orion-primary-btn-bg",
    primaryBtnHoverBg: "--orion-primary-btn-hover-bg",
    primaryBtnText: "--orion-primary-btn-text",
    inputBorder: "--orion-input-border",
    inputFocusBorder: "--orion-input-focus-border",
    inputFocusRing: "--orion-input-focus-ring",
    errorColor: "--orion-error-color",
    brandColor: "--orion-brand-color",
    captchaBg: "--orion-captcha-bg",
    captchaBorder: "--orion-captcha-border",
    refreshColor: "--orion-refresh-color",
    refreshHoverColor: "--orion-refresh-hover-color",
  };

  const cssVariables = Object.entries(mergedStyles)
    .map(([k, v]) => `${styleMappings[k] || `--orion-${k}`}: ${v};`)
    .join(" ");

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
      animation: orionCaptchaFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 9999;
    }
    #${ROOT_ID} .orion-shake { animation: orionCaptchaShake 0.4s ease-in-out; }
    @keyframes orionCaptchaFadeIn {
      from { opacity: 0; transform: scale(0.96) translateY(10px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes orionCaptchaShake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
    @keyframes orionCaptchaSpin { to { transform: rotate(360deg); } }
    #${ROOT_ID} .orion-title {
      margin: 0; color: var(--orion-heading-color); font-size: 1.25rem; font-weight: 600; text-align: center;
    }
    #${ROOT_ID} .orion-desc {
      margin: 0; color: var(--orion-text-color); font-size: 0.95rem; text-align: center; line-height: 1.4;
    }
    #${ROOT_ID} .orion-captcha-box {
      display: flex; justify-content: center; align-items: center; width: 100%; min-height: 80px;
      background-color: var(--orion-captcha-bg); border: 1px solid var(--orion-captcha-border);
      border-radius: 8px; overflow: hidden; position: relative; box-sizing: border-box;
    }
    #${ROOT_ID} .orion-captcha-img {
      user-select: none; max-width: 100%; display: block;
    }
    #${ROOT_ID} .orion-refresh-btn {
      align-self: flex-end; background: transparent; border: none; padding: 4px; border-radius: 4px;
      color: var(--orion-refresh-color); cursor: pointer; transition: color 0.2s, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex; align-items: center; justify-content: center;
    }
    #${ROOT_ID} .orion-refresh-btn:hover:not(:disabled) {
      color: var(--orion-refresh-hover-color);
    }
    #${ROOT_ID} .orion-refresh-btn svg {
      width: 18px; height: 18px; display: block; transition: transform 0.3s;
    }
    #${ROOT_ID} .orion-refresh-btn:hover:not(:disabled) svg {
      transform: rotate(180deg);
    }
    #${ROOT_ID} .orion-input-group {
      display: flex; flex-direction: column; gap: 0.5rem; width: 100%;
    }
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
    #${ROOT_ID} .orion-btn {
      width: 100%; min-height: 2.75rem; padding: 0 1rem; background-color: var(--orion-primary-btn-bg);
      color: var(--orion-primary-btn-text); border: none; border-radius: 8px; box-sizing: border-box;
      font-size: 0.95rem; font-weight: 500; cursor: pointer; transition: background-color 0.2s, opacity 0.2s;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
      font-family: inherit;
    }
    #${ROOT_ID} .orion-btn:hover:not(:disabled) { background-color: var(--orion-primary-btn-hover-bg); }
    #${ROOT_ID} .orion-btn:disabled { opacity: 0.7; cursor: not-allowed; }
    #${ROOT_ID} .orion-spinner {
      width: 18px; height: 18px; border: 2px solid rgba(255,255,255,0.3); box-sizing: border-box;
      border-radius: 50%; border-top-color: inherit; animation: orionCaptchaSpin 0.8s linear infinite;
      display: none;
    }
    #${ROOT_ID} .orion-error {
      color: var(--orion-error-color); font-size: 0.85rem; min-height: 1rem; text-align: center;
    }
    #${ROOT_ID} .orion-brand {
      font-size: 0.75rem; color: var(--orion-brand-color); text-align: center; margin-top: 0.25rem; user-select: none;
    }
  `;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main captcha modal
// ─────────────────────────────────────────────────────────────────────────────

async function createModalCaptcha(serverURL, nameSpace, slug, customStyles = {}) {
  return new Promise(async (resolve, reject) => {
    // ── Track listeners for cleanup ───────────────────────────────────────
    const trackedListeners = [];
    const addTrackedListener = (el, event, handler) => {
      el.addEventListener(event, handler);
      trackedListeners.push({ el, event, handler });
    };

    // ── Prevent duplicate overlays / styles ──────────────────────────────
    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) existingRoot.remove();
    const existingStyle = document.getElementById(STYLE_ID);
    if (existingStyle) existingStyle.remove();

    // ── Merge styles ────────────────────────────────────────────────────
    const defaultStyles = {
      overlayBg: "rgba(0,0,0,0.4)",
      overlayBlur: "blur(8px)",
      modalBg: "#ffffff",
      modalRadius: "16px",
      modalShadow: "0 20px 40px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)",
      fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      headingColor: "#111827",
      textColor: "#4b5563",
      primaryBtnBg: "#111827",
      primaryBtnHoverBg: "#374151",
      primaryBtnText: "#ffffff",
      inputBorder: "#d1d5db",
      inputFocusBorder: "#111827",
      inputFocusRing: "0 0 0 1px #111827",
      errorColor: "#ef4444",
      brandColor: "#9ca3af",
      captchaBg: "#f9fafb",
      captchaBorder: "#e5e7eb",
      refreshColor: "#9ca3af",
      refreshHoverColor: "#111827"
    };

    const mergedStyles = { ...defaultStyles, ...customStyles };

    // ── Configuration ───────────────────────────────────────────────────
    const API_BASE_URL = `${serverURL}${slug !== "" ? "/" + slug : ""}/${nameSpace}/api/v1`;
    const GENERATE_ENDPOINT = `${API_BASE_URL}/action/generate-no-auth-token-transaction`;
    const VERIFY_ENDPOINT = `${API_BASE_URL}/action/generate-no-auth-token`;

    // ── State ───────────────────────────────────────────────────────────
    let captchaToken = "";
    let captchaSystemVersion = "";
    let startTime = 0;

    // ── DOM setup ───────────────────────────────────────────────────────
    const container = document.createElement("div");
    container.id = ROOT_ID;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = buildCaptchaStyles(mergedStyles);

    document.head.appendChild(style);
    document.body.appendChild(container);

    // Build modal structure using createElement for all static content
    // (innerHTML only used for trusted SVG — never for user/server data)
    const overlay = document.createElement("div");
    overlay.className = "orion-overlay";

    const modalEl = document.createElement("div");
    modalEl.className = "orion-modal";
    modalEl.id = "orion-modal";
    modalEl.setAttribute("role", "dialog");
    modalEl.setAttribute("aria-modal", "true");
    modalEl.setAttribute("aria-labelledby", "orion-captcha-title");

    const titleEl = createTextEl("h2", "orion-title", "Security Check");
    titleEl.id = "orion-captcha-title";

    const descEl = createTextEl("p", "orion-desc", "Please solve the CAPTCHA to continue.");

    const captchaBox = document.createElement("div");
    captchaBox.className = "orion-captcha-box";
    captchaBox.id = "orion-captcha-box";
    const loadingText = createTextEl("div", null, "Loading...");
    loadingText.style.cssText = "color:var(--orion-text-color); font-size:0.9rem;";
    captchaBox.appendChild(loadingText);

    const refreshBtn = document.createElement("button");
    refreshBtn.className = "orion-refresh-btn";
    refreshBtn.id = "orion-refresh";
    refreshBtn.setAttribute("aria-label", "Refresh CAPTCHA");
    refreshBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';

    const inputGroup = document.createElement("div");
    inputGroup.className = "orion-input-group";
    const inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.id = "orion-input";
    inputEl.className = "orion-input";
    inputEl.placeholder = "Enter CAPTCHA code";
    inputEl.autocomplete = "off";
    inputEl.spellcheck = false;
    inputEl.setAttribute("aria-label", "Enter CAPTCHA verification code");
    inputGroup.appendChild(inputEl);

    const verifyBtn = document.createElement("button");
    verifyBtn.className = "orion-btn";
    verifyBtn.id = "orion-verify";
    verifyBtn.setAttribute("aria-label", "Verify CAPTCHA code");
    const verifyText = document.createElement("span");
    verifyText.textContent = "Verify";
    const spinnerEl = document.createElement("div");
    spinnerEl.className = "orion-spinner";
    spinnerEl.id = "orion-spinner";
    verifyBtn.appendChild(verifyText);
    verifyBtn.appendChild(spinnerEl);

    const errorEl = document.createElement("div");
    errorEl.className = "orion-error";
    errorEl.id = "orion-error";
    errorEl.setAttribute("role", "alert");
    errorEl.setAttribute("aria-live", "polite");

    const brandEl = createTextEl("div", "orion-brand", "Secured by Orion");

    modalEl.append(titleEl, descEl, captchaBox, refreshBtn, inputGroup, verifyBtn, errorEl, brandEl);
    overlay.appendChild(modalEl);
    container.appendChild(overlay);

    // ── Cleanup ─────────────────────────────────────────────────────────
    const cleanup = () => {
      for (const { el, event, handler } of trackedListeners) {
        try { el.removeEventListener(event, handler); } catch (_) { /* noop */ }
      }
      trackedListeners.length = 0;
      if (document.body.contains(container)) container.remove();
      if (document.head.contains(style)) style.remove();
    };

    // ── Keyboard: Escape to close ───────────────────────────────────────
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        cleanup();
        reject(new Error('User cancelled CAPTCHA verification.'));
      }
    };
    addTrackedListener(document, 'keydown', onKeyDown);

    // ── Focus trap ──────────────────────────────────────────────────────
    const trapFocus = (e) => {
      if (!container.contains(e.target)) {
        const focusable = modalEl.querySelector('button:not(:disabled), input:not(:disabled)');
        if (focusable) focusable.focus();
      }
    };
    addTrackedListener(document, 'focusin', trapFocus);

    // Clear error on input focus
    addTrackedListener(inputEl, "focus", () => { safeSetText(errorEl, ""); });

    // Focus input after modal mounts
    setTimeout(() => inputEl.focus(), 100);

    // ── Shake helper ────────────────────────────────────────────────────
    const shakeModal = () => {
      modalEl.classList.remove("orion-shake");
      void modalEl.offsetWidth;
      modalEl.classList.add("orion-shake");
    };

    // ── Fetch CAPTCHA ───────────────────────────────────────────────────
    async function fetchCaptcha(preserveError = false) {
      // Show loading state in captcha box
      captchaBox.innerHTML = '';
      const loadingEl = createTextEl("div", null, "Loading...");
      loadingEl.style.cssText = "color:var(--orion-text-color); font-size:0.9rem;";
      captchaBox.appendChild(loadingEl);

      verifyBtn.disabled = true;
      inputEl.disabled = true;
      refreshBtn.disabled = true;
      if (!preserveError) safeSetText(errorEl, "");
      startTime = Date.now();

      try {
        const headers = await buildNoAuthHeaders();
        const response = await fetchWithTimeout(GENERATE_ENDPOINT, {
          method: "POST",
          headers,
          credentials: "include",
        });

        if (!response.ok) throw new Error("Failed to fetch CAPTCHA.");

        const data = await response.json();

        if (data.data && data.data.captchaBase64Img && data.data.transactionId) {
          // Safe: base64 image data from our own server, rendered as img src
          captchaBox.innerHTML = '';
          const img = document.createElement('img');
          img.className = 'orion-captcha-img';
          img.src = `data:image/png;base64,${data.data.captchaBase64Img}`;
          img.alt = 'CAPTCHA image';
          img.draggable = false;
          captchaBox.appendChild(img);

          captchaToken = data.data.transactionId;
          captchaSystemVersion = data.data.captchaSystemVersion;
          verifyBtn.disabled = false;
          inputEl.disabled = false;
          refreshBtn.disabled = false;
          inputEl.value = "";
          inputEl.focus();
        } else {
          throw new Error("Invalid CAPTCHA payload.");
        }
      } catch (err) {
        safeSetText(errorEl, `Unable to load CAPTCHA: ${err.message}`);
        captchaBox.innerHTML = '';
        const errText = createTextEl("div", null, "Error loading!");
        errText.style.cssText = "color:var(--orion-error-color); font-size:0.9rem;";
        captchaBox.appendChild(errText);
        refreshBtn.disabled = false;
      }
    }

    // ── Verify CAPTCHA ──────────────────────────────────────────────────
    async function verifyCaptchaCode() {
      const userInput = inputEl.value.trim();
      const solveTime = Date.now() - startTime;

      if (!userInput) {
        safeSetText(errorEl, "Please enter the CAPTCHA code.");
        shakeModal();
        return;
      }

      if (!captchaToken) {
        safeSetText(errorEl, "Session expired. Please refresh the CAPTCHA.");
        return;
      }

      verifyBtn.disabled = true;
      verifyText.textContent = "Verifying...";
      spinnerEl.style.display = "block";
      safeSetText(errorEl, "");
      inputEl.disabled = true;
      refreshBtn.disabled = true;

      try {
        const headers = await buildNoAuthHeaders();
        const response = await fetchWithTimeout(VERIFY_ENDPOINT, {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({
            packet: {
              recaptchaResponse: {
                captchaCode: userInput,
                startTime,
                endTime: Date.now(),
                solveTimeMs: solveTime,
              },
              transactionId: captchaToken,
              captchaSystemVersion,
            },
          }),
        });

        const data = await response.json();
        if (!response.ok || data.error) {
          throw new Error(data?.message || "Incorrect CAPTCHA code.");
        }

        // Success — clean up and notify
        cleanup();
        document.dispatchEvent(new CustomEvent("captchaSuccess", {
          detail: { message: "CAPTCHA verified successfully.", responseData: data.data }
        }));
        resolve({ verified: true, responseData: data.data });
      } catch (err) {
        safeSetText(errorEl, `Verification failed: ${err.message}`);
        shakeModal();

        // Invalidate the used token
        captchaToken = "";

        // Reset verify button state
        spinnerEl.style.display = "none";
        verifyText.textContent = "Verify";
        
        // Auto-refresh the CAPTCHA while preserving the error message
        fetchCaptcha(true);
      }
    }

    // ── Event bindings (tracked for cleanup) ────────────────────────────
    addTrackedListener(verifyBtn, "click", verifyCaptchaCode);
    addTrackedListener(inputEl, "keypress", (e) => {
      if (e.key === "Enter" && !verifyBtn.disabled) verifyCaptchaCode();
    });
    addTrackedListener(refreshBtn, "click", () => {
      if (!refreshBtn.disabled) fetchCaptcha();
    });

    // ── Initial load ────────────────────────────────────────────────────
    try {
      await fetchCaptcha();
    } catch (err) {
      cleanup();
      reject(new Error(`CAPTCHA initialization failed: ${err.message}`));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Check & deploy
// ─────────────────────────────────────────────────────────────────────────────

async function checkAndDeployCaptcha(serverURL, nameSpace, slug, customStyles = {}) {
  const headers = await buildNoAuthHeaders();
  const req = await fetchWithTimeout(
    `${serverURL}${slug !== "" ? "/" + slug : ""}/${nameSpace}/api/v1/request/have-no-auth-token`,
    {
      method: "POST",
      headers,
      credentials: "include",
    }
  );

  const data = await req.json();

  if (data.error && data.errorData.errorCode !== "NO-AUTH-TOKEN-DISABLED") {
    await createModalCaptcha(serverURL, nameSpace, slug, customStyles);
  }
}

export { checkAndDeployCaptcha, createModalCaptcha };