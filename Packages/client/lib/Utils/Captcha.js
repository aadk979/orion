import { getDeviceFingerprint } from "./DevicePrint.js"; // Import the fingerprint function

async function createModalCaptcha(serverURL, nameSpace) {
  (function async() {
    // --- Elements ---
    const overlay = document.createElement("div");
    const modal = document.createElement("div");
    const style = document.createElement("style");
    const title = document.createElement("h2");
    const description = document.createElement("p");
    const captchaContainer = document.createElement("div");
    const refreshButton = document.createElement("button");
    const inputContainer = document.createElement("div");
    const input = document.createElement("input");
    const button = document.createElement("button");
    const spinner = document.createElement("div");
    const spinnerStyle = document.createElement("style");
    const errorMsg = document.createElement("div");
    const orionTag = document.createElement("span");

    // --- State ---
    let captchaToken = "";
    let captchaSystemVersion = "";
    let startTime = 0;

    // --- Configuration ---
    const API_BASE_URL = `${serverURL}/${nameSpace}/api/v1`;
    const GENERATE_ENDPOINT = `${API_BASE_URL}/action/generate-no-auth-token-transaction`;
    const VERIFY_ENDPOINT = `${API_BASE_URL}/action/generate-no-auth-token`;

    // Clerk-style overlay
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.55)";
    overlay.style.backdropFilter = "blur(6px)";
    overlay.style.zIndex = "9998";

    // Clerk-style modal
    modal.style.position = "fixed";
    modal.style.top = "50%";
    modal.style.left = "50%";
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.zIndex = "9999";
    modal.style.backgroundColor = "#ffffff";
    modal.style.padding = "2rem";
    modal.style.borderRadius = "16px";
    modal.style.boxShadow = "0 8px 32px rgba(0,0,0,0.12)";
    modal.style.width = "380px";
    modal.style.maxWidth = "90vw";
    modal.style.fontFamily =
      "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    modal.style.display = "flex";
    modal.style.flexDirection = "column";
    modal.style.alignItems = "stretch";
    modal.style.gap = "1.25rem";
    modal.style.animation = "fadeIn 0.25s ease-out";

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
    `;
    document.head.appendChild(style);

    // Title
    title.textContent = "Security Check";
    title.style.margin = "0";
    title.style.color = "#1a202c";
    title.style.fontSize = "1.25rem";
    title.style.fontWeight = "600";
    title.style.textAlign = "center";

    // Description
    description.textContent = "Please solve the CAPTCHA to continue.";
    description.style.margin = "0";
    description.style.color = "#4a5568";
    description.style.fontSize = "0.95rem";
    description.style.textAlign = "center";

    // CAPTCHA box
    captchaContainer.style.display = "flex";
    captchaContainer.style.justifyContent = "center";
    captchaContainer.style.alignItems = "center";
    captchaContainer.style.width = "100%";
    captchaContainer.style.minHeight = "80px";
    captchaContainer.style.backgroundColor = "#f9fafb";
    captchaContainer.style.border = "1px solid #e5e7eb";
    captchaContainer.style.borderRadius = "8px";
    captchaContainer.style.overflow = "hidden";

    // Refresh button
    refreshButton.innerHTML = "↻";
    refreshButton.style.alignSelf = "flex-end";
    refreshButton.style.background = "transparent";
    refreshButton.style.border = "none";
    refreshButton.style.fontSize = "1.2rem";
    refreshButton.style.color = "#718096";
    refreshButton.style.cursor = "pointer";
    refreshButton.style.transition = "color 0.2s, transform 0.2s";
    refreshButton.onmouseenter = () => {
      refreshButton.style.color = "#2563eb";
      refreshButton.style.transform = "rotate(180deg)";
    };
    refreshButton.onmouseleave = () => {
      refreshButton.style.color = "#718096";
      refreshButton.style.transform = "rotate(0deg)";
    };

    // Input container
    inputContainer.style.width = "100%";
    inputContainer.style.display = "flex";
    inputContainer.style.flexDirection = "column";
    inputContainer.style.gap = "0.5rem";

    // Input
    input.type = "text";
    input.placeholder = "Enter CAPTCHA";
    input.setAttribute("autocomplete", "off");
    input.setAttribute("spellcheck", "false");
    input.style.width = "100%";
    input.style.padding = "0.75rem 1rem";
    input.style.border = "1px solid #e5e7eb";
    input.style.borderRadius = "8px";
    input.style.fontSize = "0.95rem";
    input.style.transition = "border-color 0.2s, box-shadow 0.2s";
    input.addEventListener("focus", () => {
      input.style.borderColor = "#2563eb";
      input.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.25)";
      errorMsg.textContent = "";
    });
    input.addEventListener("blur", () => {
      input.style.borderColor = "#e5e7eb";
      input.style.boxShadow = "none";
    });

    // Verify button
    button.textContent = "Verify";
    button.style.width = "100%";
    button.style.padding = "0.85rem";
    button.style.backgroundColor = "#2563eb";
    button.style.color = "#ffffff";
    button.style.border = "none";
    button.style.borderRadius = "8px";
    button.style.fontSize = "0.95rem";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    button.style.transition = "background-color 0.2s, opacity 0.2s";
    button.style.position = "relative";
    button.onmouseenter = () => {
      if (!button.disabled) button.style.backgroundColor = "#1d4ed8";
    };
    button.onmouseleave = () => {
      if (!button.disabled) button.style.backgroundColor = "#2563eb";
    };

    // Spinner
    spinner.style.display = "none";
    spinner.style.width = "18px";
    spinner.style.height = "18px";
    spinner.style.border = "3px solid rgba(255,255,255,0.3)";
    spinner.style.borderRadius = "50%";
    spinner.style.borderTopColor = "#fff";
    spinner.style.animation = "spin 1s linear infinite";
    spinner.style.position = "absolute";
    spinner.style.right = "1rem";
    spinner.style.top = "50%";
    spinner.style.transform = "translateY(-50%)";

    spinnerStyle.textContent = `
      @keyframes spin {
        to { transform: translateY(-50%) rotate(360deg); }
      }
    `;
    document.head.appendChild(spinnerStyle);

    // Error text
    errorMsg.style.color = "#dc2626";
    errorMsg.style.fontSize = "0.85rem";
    errorMsg.style.minHeight = "1rem";
    errorMsg.style.textAlign = "center";

    // Orion branding
    orionTag.textContent = "Secured by Orion";
    orionTag.style.fontSize = "0.75rem";
    orionTag.style.color = "#a0aec0";
    orionTag.style.textAlign = "center";
    orionTag.style.marginTop = "0.5rem";

    // Build structure
    inputContainer.appendChild(input);
    button.appendChild(spinner);

    modal.appendChild(title);
    modal.appendChild(description);
    modal.appendChild(captchaContainer);
    modal.appendChild(refreshButton);
    modal.appendChild(inputContainer);
    modal.appendChild(button);
    modal.appendChild(errorMsg);
    modal.appendChild(orionTag);

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    setTimeout(() => input.focus(), 100);

    // --- Functions ---
    function cleanupModal() {
      overlay.remove();
      modal.remove();
      style.remove();
      spinnerStyle.remove();
    }

    async function fetchCaptcha() {
      captchaContainer.innerHTML =
        '<div style="padding: 20px; color:#6b7280; text-align: center;">Loading CAPTCHA...</div>';
      button.disabled = true;
      button.style.opacity = "0.7";
      input.disabled = true;
      errorMsg.textContent = "";
      refreshButton.disabled = true;
      startTime = Date.now();

      try {
        const response = await fetch(GENERATE_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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
          },
          credentials: "include",
        });

        if (!response.ok) throw new Error("Failed to fetch CAPTCHA");

        const data = await response.json();

        if (
          !data.error &&
          data.data &&
          data.data.captchaBase64Img &&
          data.data.transactionId
        ) {
          const img = document.createElement("img");
          img.src = `data:image/png;base64,${data.data.captchaBase64Img}`;
          img.alt = "CAPTCHA image";
          img.style.userSelect = "none";

          captchaContainer.innerHTML = "";
          captchaContainer.appendChild(img);

          captchaToken = data.data.transactionId;
          captchaSystemVersion = data.data.captchaSystemVersion;
          button.disabled = false;
          button.style.opacity = "1";
          input.disabled = false;
          refreshButton.disabled = false;
          input.value = "";
          input.focus();
        } else {
          throw new Error("Invalid CAPTCHA data");
        }
      } catch (err) {
        errorMsg.textContent = `Failed to load CAPTCHA. ${err.message}`;
        captchaContainer.innerHTML =
          '<div style="padding: 20px; color:#dc2626; text-align: center;">Error loading!</div>';
        button.disabled = true;
        input.disabled = true;
        refreshButton.disabled = false;
      }
    }

    async function verifyCaptcha() {
      const userInput = input.value.trim();
      const endTime = Date.now();
      const solveTime = endTime - startTime;

      if (!userInput) {
        errorMsg.textContent = "Please enter the CAPTCHA code.";
        modal.classList.add("shake");
        setTimeout(() => modal.classList.remove("shake"), 500);
        return;
      }

      if (!captchaToken) {
        errorMsg.textContent =
          "Session expired. Please refresh the CAPTCHA.";
        return;
      }

      button.disabled = true;
      button.style.opacity = "0.7";
      const originalButtonText = button.firstChild.textContent;
      if (button.firstChild) button.firstChild.textContent = "Verifying...";
      spinner.style.display = "inline-block";
      errorMsg.textContent = "";
      input.disabled = true;
      refreshButton.disabled = true;

      try {
        const response = await fetch(VERIFY_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
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
          },
          credentials: "include",
          body: JSON.stringify({
            packet: {
              recaptchaResponse: {
                captchaCode: userInput,
                startTime,
                endTime,
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

        cleanupModal();
        const event = new CustomEvent("captchaSuccess", {
          detail: {
            message: "CAPTCHA verified successfully.",
            responseData: data.data,
          },
        });
        document.dispatchEvent(event);
        window.location.reload();
      } catch (err) {
        errorMsg.textContent = `Verification failed: ${err.message}`;
        modal.classList.add("shake");
        setTimeout(() => modal.classList.remove("shake"), 500);
        window.location.reload();
      } finally {
        spinner.style.display = "none";
        if (button.firstChild)
          button.firstChild.textContent = originalButtonText;
      }
    }

    button.addEventListener("click", verifyCaptcha);
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !button.disabled) verifyCaptcha();
    });
    refreshButton.addEventListener("click", () => {
      if (!refreshButton.disabled) fetchCaptcha();
    });

    fetchCaptcha();
  })();
}

async function checkAndDeployCaptcha(serverURL, nameSpace) {
  const req = await fetch(
    `${serverURL}/${nameSpace}/api/v1/request/have-no-auth-token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
      },
      credentials: "include",
    }
  );

  const data = await req.json();
  if (!data?.data?.valid || data.error) {
    await createModalCaptcha(serverURL, nameSpace);
  }
}

export { checkAndDeployCaptcha };
