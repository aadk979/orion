import { getDeviceFingerprint } from "./DevicePrint.js"; // Import the fingerprint function

async function createModalCaptcha(serverURL, nameSpace) {
  // --- Security Enhancement: Use an IIFE (Immediately Invoked Function Expression) ---
  // This creates a private scope, preventing variables and functions from leaking
  // into the global scope, making them harder to access directly from the console.
  (function async () {
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
    let captchaToken = ""; // Kept within the private scope
    let captchaSystemVersion = ""; // To track the version of the CAPTCHA system
    let startTime = 0; // To track solving time

    // --- Configuration ---
    const API_BASE_URL = `${serverURL}/${nameSpace}/api/v1`; // Use a constant
    const GENERATE_ENDPOINT = `${API_BASE_URL}/action/generate-no-auth-token-transaction`;
    const VERIFY_ENDPOINT = `${API_BASE_URL}/action/generate-no-auth-token`;

    // --- Styling and Structure Setup (Mostly unchanged, condensed for brevity) ---
    // Orion tag for branding
    orionTag.textContent = "Secured by Orion";
    orionTag.style.position = "absolute";
    orionTag.style.bottom = "10px";
    orionTag.style.right = "10px";
    orionTag.style.color = "#a0aec0";
    orionTag.style.fontSize = "0.8rem";
    orionTag.style.zIndex = "10000"; // Ensure it's above the modal
    orionTag.style.pointerEvents = "none"; // Prevent interaction


    // Overlay styles
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.7)";
    overlay.style.backdropFilter = "blur(8px)";
    overlay.style.zIndex = "9998";
    overlay.style.pointerEvents = "auto"; // Keep pointer events for overlay initially

    // Modal styles
    modal.style.position = "fixed";
    modal.style.top = "50%";
    modal.style.left = "50%";
    modal.style.transform = "translate(-50%, -50%)";
    modal.style.zIndex = "9999";
    modal.style.backgroundColor = "#ffffff";
    modal.style.padding = "2.5rem";
    modal.style.borderRadius = "12px";
    modal.style.boxShadow = "0 10px 30px rgba(0,0,0,0.2)";
    modal.style.width = "380px";
    modal.style.maxWidth = "90vw";
    modal.style.fontFamily = "system-ui, -apple-system, sans-serif";
    modal.style.display = "flex";
    modal.style.flexDirection = "column";
    modal.style.alignItems = "center";
    modal.style.gap = "1.5rem";
    modal.style.animation = "fadeIn 0.3s ease-out";

    // Animation styles
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translate(-50%, -45%); }
        to { opacity: 1; transform: translate(-50%, -50%); }
      }
      .shake {
        animation: shake 0.5s ease-in-out;
      }
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-5px); }
        40%, 80% { transform: translateX(5px); }
      }
    `;
    document.head.appendChild(style);

    // Title
    title.textContent = "Security Verification";
    title.style.margin = "0";
    title.style.color = "#2d3748";
    title.style.fontSize = "1.5rem";
    title.style.fontWeight = "600";

    // Description
    description.textContent = "Please complete the CAPTCHA to continue";
    description.style.margin = "0";
    description.style.color = "#718096";
    description.style.fontSize = "0.95rem";
    description.style.textAlign = "center";

    // CAPTCHA container
    captchaContainer.style.margin = "0.5rem 0";
    captchaContainer.style.display = "flex";
    captchaContainer.style.justifyContent = "center";
    captchaContainer.style.alignItems = "center";
    captchaContainer.style.width = "100%";
    captchaContainer.style.minHeight = "80px"; // Ensure space while loading
    captchaContainer.style.backgroundColor = "#f7fafc";
    captchaContainer.style.border = "1px solid #e2e8f0";
    captchaContainer.style.borderRadius = "6px";
    captchaContainer.style.overflow = "hidden";

    // Refresh button
    refreshButton.innerHTML = "&#x21BB;"; // Unicode refresh symbol
    refreshButton.style.position = "absolute";
    refreshButton.style.top = "10px";
    refreshButton.style.right = "10px"; // Adjust based on title/desc height
    refreshButton.setAttribute("aria-label", "Refresh CAPTCHA");
    refreshButton.style.background = "none";
    refreshButton.style.border = "none";
    refreshButton.style.fontSize = "1.5rem";
    refreshButton.style.lineHeight = "1";
    refreshButton.style.cursor = "pointer";
    refreshButton.style.margin = "20px"
    refreshButton.style.color = "#a0aec0"; // Slightly dimmer color
    refreshButton.style.transition = "transform 0.3s ease-out, color 0.2s";
    refreshButton.onmouseenter = () => {
      refreshButton.style.color = "#4299e1";
      refreshButton.style.transform = "rotate(180deg)";
    };
    refreshButton.onmouseleave = () => {
      refreshButton.style.color = "#a0aec0";
      refreshButton.style.transform = "rotate(0deg)";
    };

    // Input container
    inputContainer.style.width = "100%";
    inputContainer.style.position = "relative";

    // Input field
    input.type = "text";
    input.placeholder = "Enter CAPTCHA code";
    input.setAttribute("aria-label", "CAPTCHA code input");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.style.width = "100%";
    input.style.padding = "0.9rem 1rem";
    input.style.border = "1px solid #e2e8f0";
    input.style.borderRadius = "6px";
    input.style.fontSize = "1rem";
    input.style.transition = "border-color 0.2s, box-shadow 0.2s";
    input.style.boxSizing = "border-box";
    input.addEventListener("focus", () => {
      input.style.borderColor = "#4299e1";
      input.style.boxShadow = "0 0 0 3px rgba(66, 153, 225, 0.2)";
      errorMsg.textContent = "";
    });
    input.addEventListener("blur", () => {
      input.style.borderColor = "#e2e8f0";
      input.style.boxShadow = "none";
    });

    // Verify button
    button.textContent = "Verify";
    button.style.width = "100%";
    button.style.padding = "0.9rem";
    button.style.backgroundColor = "#4299e1";
    button.style.color = "white";
    button.style.border = "none";
    button.style.borderRadius = "6px";
    button.style.fontSize = "1rem";
    button.style.fontWeight = "600";
    button.style.cursor = "pointer";
    button.style.transition = "background-color 0.2s, opacity 0.2s";
    button.style.position = "relative"; // For spinner positioning
    button.onmouseenter = () => {
      if (!button.disabled) button.style.backgroundColor = "#3182ce";
    };
    button.onmouseleave = () => {
      if (!button.disabled) button.style.backgroundColor = "#4299e1";
    };

    // Loading spinner
    spinner.style.display = "none"; // Initially hidden
    spinner.style.width = "20px";
    spinner.style.height = "20px";
    spinner.style.border = "3px solid rgba(255,255,255,0.3)";
    spinner.style.borderRadius = "50%";
    spinner.style.borderTopColor = "#fff";
    spinner.style.animation = "spin 1s linear infinite"; // Use linear for smooth spin
    spinner.style.position = "absolute";
    spinner.style.right = "1rem";
    spinner.style.top = "50%";
    spinner.style.transform = "translateY(-50%)";

    // Spinner animation
    spinnerStyle.textContent = `
      @keyframes spin {
        to { transform: translateY(-50%) rotate(360deg); }
      }
    `;
    document.head.appendChild(spinnerStyle);

    // Error message
    errorMsg.style.color = "#e53e3e";
    errorMsg.style.marginTop = "0.5rem";
    errorMsg.style.fontSize = "0.9rem";
    errorMsg.style.minHeight = "1.2rem"; // Prevent layout shifts
    errorMsg.style.textAlign = "center";
    errorMsg.setAttribute("aria-live", "polite"); // Announce errors to screen readers

    // --- Build Modal Structure ---
    inputContainer.appendChild(input);
    button.appendChild(spinner); // Place spinner inside button
    modal.appendChild(title);
    modal.appendChild(description);
    modal.appendChild(captchaContainer);
    modal.appendChild(refreshButton);
    modal.appendChild(inputContainer);
    modal.appendChild(button);
    modal.appendChild(errorMsg);
    modal.appendChild(orionTag); // Add Orion tag

    // --- Add to Document ---
    // Security: Add overlay and modal at the end to minimize exposure time
    // before event listeners are attached and initial fetch starts.
    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    // Focus input field after a very short delay to ensure it's ready
    setTimeout(() => input.focus(), 50);

    // --- Helper Functions (within scope) ---

    function cleanupModal() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (modal.parentNode) modal.parentNode.removeChild(modal);
      // Optional: remove styles if they are specific only to this modal
      if (style.parentNode) style.parentNode.removeChild(style);
      if (spinnerStyle.parentNode)
        spinnerStyle.parentNode.removeChild(spinnerStyle);
      // Remove event listeners added to document/window if any were added
    }

    async function fetchCaptcha() {
      captchaContainer.innerHTML =
        '<div style="padding: 20px; color:#718096; text-align: center;">Loading CAPTCHA...</div>';
      button.disabled = true;
      button.style.opacity = "0.7";
      input.disabled = true;
      errorMsg.textContent = ""; // Clear previous errors
      refreshButton.disabled = true;
      startTime = Date.now(); // Record start time when challenge is requested

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
          // Add body if needed by this specific endpoint
        });

        if (!response.ok) {
          // Try to get error details from response body if possible
          let errorData = null;
          try {
            errorData = await response.json();
          } catch (parseError) {
            /* Ignore if body isn't JSON */
          }
          console.error(
            "CAPTCHA fetch error response:",
            response.status,
            errorData
          );
          throw new Error(
            `HTTP error ${response.status}: ${
              errorData?.message || response.statusText
            }`
          );
        }

        const data = await response.json();

        if (
          !data.error &&
          data.data &&
          data.data.captchaBase64Img &&
          data.data.transactionId
        ) {

          const img = document.createElement("img");
          img.src = `data:image/png;base64,${data.data.captchaBase64Img}`;
          img.alt = "CAPTCHA image"; // optional: for accessibility
          img.setAttribute("aria-hidden", "true"); // decorative, so hide from screen readers
          img.style.userSelect = "none"; // prevent selection

          captchaContainer.innerHTML = ""; // Clear previous content
          captchaContainer.appendChild(img);

          captchaToken = data.data.transactionId;
          captchaSystemVersion = data.data.captchaSystemVersion;
          button.disabled = false;
          button.style.opacity = "1";
          input.disabled = false;
          refreshButton.disabled = false;
          input.value = ""; // Clear previous input
          input.focus(); // Focus input after loading
        } else {
          console.error("Invalid CAPTCHA response structure:", data);
          throw new Error(data.message || "Invalid CAPTCHA data received.");
        }
      } catch (error) {
        console.error("CAPTCHA fetch failed:", error);
        errorMsg.textContent = `Failed to load CAPTCHA. ${
          error.message || "Check console."
        }`;
        captchaContainer.innerHTML = `<div style="padding: 20px; color:#e53e3e; text-align: center;">Error loading!</div>`;
        // Implement smarter retry logic if needed (e.g., exponential backoff)
        // Consider completely failing after too many retries.
        // setTimeout(fetchCaptcha, 3000); // Simple retry - BE CAREFUL WITH LOOPS
        button.disabled = true; // Keep disabled on error
        input.disabled = true;
        refreshButton.disabled = false; // Allow refresh attempt
      }
    }

    async function verifyCaptcha() {
      const userInput = input.value.trim();
      const endTime = Date.now();
      const solveTime = endTime - startTime; // Time in milliseconds

      if (!userInput) {
        errorMsg.textContent = "Please enter the CAPTCHA code";
        input.style.borderColor = "#e53e3e";
        modal.classList.add("shake");
        setTimeout(() => modal.classList.remove("shake"), 500);
        return;
      }

      if (!captchaToken) {
        errorMsg.textContent =
          "Cannot verify: Missing CAPTCHA session. Please refresh.";
        return;
      }

      // Show loading state
      button.disabled = true;
      button.style.opacity = "0.7";
      // Temporarily change text content, keep spinner inside
      const originalButtonText = button.firstChild.textContent; // Assumes text is first child
      if (button.firstChild) button.firstChild.textContent = "Verifying...";
      spinner.style.display = "inline-block"; // Use inline-block for spinner next to text
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
                // --- Security Enhancement: Send timing info ---
                startTime: startTime, // Send start timestamp (ms since epoch)
                endTime: endTime, // Send end timestamp (ms since epoch)
                solveTimeMs: solveTime, // Send calculated duration (ms)
              },
              transactionId: captchaToken,
              captchaSystemVersion: captchaSystemVersion,
            },
          }),
        });

        // Always try to parse JSON, even for errors, as API might return details
        let data;
        try {
          data = await response.json();
        } catch (parseError) {
          console.error("Failed to parse verification response:", parseError);
          throw new Error(
            `Invalid response from server (Status: ${response.status})`
          );
        }

        if (!response.ok) {
          console.error("Verification HTTP error:", response.status, data);
          throw new Error(
            data?.message ||
              `Verification failed with status ${response.status}`
          );
        }

        // --- CRITICAL: Rely *only* on the server's response ---
        if (!data.error) {
          // Success - remove modal
          cleanupModal();

          // Dispatch success event with potentially useful data from server
          const event = new CustomEvent("captchaSuccess", {
            detail: {
              message: "CAPTCHA verified successfully.",
              responseData: data.data, // Pass along any relevant data from the server response
            },
          });

          document.dispatchEvent(event);

          window.location.reload();
        } else {
          // Verification failed server-side (e.g., wrong code)
          throw new Error(data?.message || "Incorrect CAPTCHA code.");
        }
      } catch (error) {
        console.error("Verification process error:", error);
        errorMsg.textContent = `Verification failed: ${
          error.message || "Please try again."
        }`;
        modal.classList.add("shake");
        setTimeout(() => modal.classList.remove("shake"), 500);

        window.location.reload();
        // input.focus(); // fetchCaptcha will handle focus
      } finally {
        // Restore button state only if fetchCaptcha wasn't called or if it failed immediately
        // Note: fetchCaptcha() handles re-enabling on successful fetch.
        // This 'finally' block might run before fetchCaptcha() completes its async operation.
        // Consider managing state more explicitly if needed.
        if (button.disabled) {
          // Only restore if still disabled
          spinner.style.display = "none";
          if (button.firstChild)
            button.firstChild.textContent = originalButtonText;
          // Re-enable buttons *only if* a new CAPTCHA isn't being fetched or failed to fetch
          // This logic gets tricky with async calls. Best to let fetchCaptcha control enabling.
          // If fetchCaptcha fails, it should leave buttons disabled except 'refresh'.
        }
        // Ensure input is re-enabled ONLY if fetchCaptcha succeeded
        // The logic inside fetchCaptcha handles this better.
      }
    }

    // --- Event Listeners ---
    button.addEventListener("click", verifyCaptcha);

    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter" && !button.disabled) {
        verifyCaptcha();
      }
    });

    refreshButton.addEventListener("click", () => {
      if (!refreshButton.disabled) {
        fetchCaptcha(); // Fetch a new CAPTCHA
      }
    });

    // Optional: Add listener to close on overlay click?
    // overlay.addEventListener('click', cleanupModal); // Be careful not to allow easy dismissal

    // --- Initial CAPTCHA Load ---
    fetchCaptcha();
  })(); // End of IIFE - execute the function immediately
}

async function checkAndDeployCaptcha(serverURL, nameSpace) {
  const req = await fetch(
    `${serverURL}/${nameSpace}/api/v1/request/have-no-auth-token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "NO_BEARER",
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
    return;
  }

  return;
}

export { checkAndDeployCaptcha };
