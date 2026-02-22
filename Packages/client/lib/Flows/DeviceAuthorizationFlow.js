import { ApiInterface } from '../Utils/Api-2.js';
import { getAuthHeader } from '../Utils/Authorisation.js';
import { globalAccessPoint } from '../Utils/GlobalAccessPoint.js';

const renderDeviceAuthorizationUI = async (serverURL, nameSpace, slug) => {
    try {
        // --- Elements ---
        const overlay = document.createElement('div');
        const modal = document.createElement('div');
        const style = document.createElement('style');
        const title = document.createElement('h2');
        const description = document.createElement('p');
        const inputContainer = document.createElement('div');
        const input = document.createElement('input');
        const button = document.createElement('button');
        const buttonText = document.createElement('span');
        const spinner = document.createElement('div');
        const errorMsg = document.createElement('div');
        const orionTag = document.createElement('span');

        // --- Configuration ---
        const Api = new ApiInterface(serverURL, nameSpace, slug);
        const DEVICE_AUTHORIZATION_ENDPOINT = `/${nameSpace}/api/v1/action/authorize-me`;

        // Overlay
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.55)';
        overlay.style.backdropFilter = 'blur(6px)';
        overlay.style.zIndex = '9998';

        // Modal
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
    `;
        document.head.appendChild(style);

        // Title
        title.textContent = 'Device Authorization';
        title.style.margin = '0';
        title.style.color = '#1a202c';
        title.style.fontSize = '1.25rem';
        title.style.fontWeight = '600';
        title.style.textAlign = 'center';

        // Description
        description.textContent = 'Please type in the authorization code sent to your email.';
        description.style.margin = '0';
        description.style.color = '#4a5568';
        description.style.fontSize = '0.95rem';
        description.style.textAlign = 'center';

        // Input
        input.type = 'text';
        input.placeholder = 'Enter Authorization Code';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        input.style.width = '100%';
        input.style.padding = '0.75rem 1rem';
        input.style.border = '1px solid #e5e7eb';
        input.style.borderRadius = '8px';
        input.style.fontSize = '0.95rem';
        input.style.transition = 'border-color 0.2s, box-shadow 0.2s';
        input.style.color = 'black';

        input.addEventListener('focus', () => {
            input.style.borderColor = '#2563eb';
            input.style.boxShadow = '0 0 0 3px rgba(37, 99, 235, 0.25)';
            errorMsg.textContent = '';
        });

        input.addEventListener('blur', () => {
            input.style.borderColor = '#e5e7eb';
            input.style.boxShadow = 'none';
        });

        // Button text span
        buttonText.textContent = 'Authorize Device';
        buttonText.style.display = 'inline-block';
        buttonText.style.backgroundColor = 'transparent';
        buttonText.style.color = 'inherit';
        buttonText.style.boxShadow = 'none';
        buttonText.style.padding = '0px';

        // Verify button
        button.style.width = '100%';
        button.style.minHeight = '2.5rem';
        button.style.padding = '0.85rem';
        button.style.backgroundColor = '#2563eb';
        button.style.color = '#ffffff';
        button.style.border = 'none';
        button.style.borderRadius = '8px';
        button.style.fontSize = '0.95rem';
        button.style.fontWeight = '600';
        button.style.cursor = 'pointer';
        button.style.transition = 'background-color 0.2s, opacity 0.2s';
        button.style.position = 'relative';
        button.style.display = 'flex';
        button.style.flexDirection = 'row';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.gap = '0.5rem';

        button.onmouseenter = () => {
            if (!button.disabled) button.style.backgroundColor = '#1d4ed8';
        };

        button.onmouseleave = () => {
            if (!button.disabled) button.style.backgroundColor = '#2563eb';
        };

        // Spinner
        spinner.style.display = 'none';
        spinner.style.width = '0.95rem';
        spinner.style.height = '0.95rem';
        spinner.style.border = '3px solid rgba(255,255,255,0.3)';
        spinner.style.borderRadius = '50%';
        spinner.style.borderTopColor = '#fff';
        spinner.style.animation = 'spin 1s linear infinite';

        // Error text
        errorMsg.style.color = '#dc2626';
        errorMsg.style.fontSize = '0.85rem';
        errorMsg.style.minHeight = '1rem';
        errorMsg.style.textAlign = 'center';

        // Orion branding
        orionTag.textContent = 'Secured by Orion';
        orionTag.style.fontSize = '0.75rem';
        orionTag.style.color = '#a0aec0';
        orionTag.style.textAlign = 'center';
        orionTag.style.marginTop = '0.5rem';

        // Structure
        inputContainer.appendChild(input);
        button.appendChild(buttonText);
        button.appendChild(spinner);
        modal.appendChild(title);
        modal.appendChild(description);
        modal.appendChild(inputContainer);
        modal.appendChild(button);
        modal.appendChild(errorMsg);
        modal.appendChild(orionTag);

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        setTimeout(() => input.focus(), 100);

        // Helper functions
        const startLoading = () => {
            input.disabled = true;
            button.disabled = true;
            button.style.opacity = '0.7';
            buttonText.style.display = 'none';
            spinner.style.display = 'block';
        };

        const stopLoading = () => {
            input.disabled = false;
            button.disabled = false;
            button.style.opacity = '1';
            buttonText.style.display = 'inline-block';
            spinner.style.display = 'none';
        };

        const showError = message => {
            errorMsg.textContent = message || 'Invalid code. Please try again.';
            modal.classList.remove('shake');
            void modal.offsetWidth;
            modal.classList.add('shake');
            input.value = '';
            input.focus();
        };

        const showSuccess = () => {
            modal.innerHTML = '';

            const checkContainer = document.createElement('div');
            const checkCircle = document.createElement('div');
            const checkmark = document.createElement('div');
            const successText = document.createElement('h3');
            const countdownText = document.createElement('p');
            const reloadButton = document.createElement('button');

            checkContainer.style.display = 'flex';
            checkContainer.style.flexDirection = 'column';
            checkContainer.style.alignItems = 'center';
            checkContainer.style.justifyContent = 'center';
            checkContainer.style.gap = '1rem';

            checkCircle.style.width = '80px';
            checkCircle.style.height = '80px';
            checkCircle.style.borderRadius = '50%';
            checkCircle.style.backgroundColor = '#22c55e';
            checkCircle.style.display = 'flex';
            checkCircle.style.alignItems = 'center';
            checkCircle.style.justifyContent = 'center';
            checkCircle.style.animation = 'pop 0.4s ease-out';

            checkmark.style.width = '35px';
            checkmark.style.height = '18px';
            checkmark.style.borderLeft = '4px solid #fff';
            checkmark.style.borderBottom = '4px solid #fff';
            checkmark.style.transform = 'rotate(-45deg)';

            successText.textContent = 'Device Authorized';
            successText.style.color = '#16a34a';
            successText.style.fontSize = '1.25rem';
            successText.style.fontWeight = '600';
            successText.style.textAlign = 'center';

            countdownText.textContent = 'Reloading in 5 seconds...';
            countdownText.style.color = '#4b5563';
            countdownText.style.fontSize = '0.95rem';
            countdownText.style.textAlign = 'center';

            reloadButton.textContent = 'Reload Now';
            reloadButton.style.backgroundColor = '#2563eb';
            reloadButton.style.color = '#fff';
            reloadButton.style.border = 'none';
            reloadButton.style.padding = '0.7rem 1.2rem';
            reloadButton.style.borderRadius = '8px';
            reloadButton.style.cursor = 'pointer';
            reloadButton.onclick = () => location.reload();

            checkCircle.appendChild(checkmark);
            checkContainer.appendChild(checkCircle);
            checkContainer.appendChild(successText);
            checkContainer.appendChild(countdownText);
            checkContainer.appendChild(reloadButton);

            modal.appendChild(checkContainer);

            let seconds = 5;
            const countdown = setInterval(() => {
                seconds--;
                countdownText.textContent = `Reloading in ${seconds} seconds...`;
                if (seconds <= 0) {
                    clearInterval(countdown);
                    location.reload();
                }
            }, 1000);
        };

        // --- Main authorization handler ---
        const handleAuthorization = async () => {
            startLoading();
            const code = input.value.trim();

            if (code === '') {
                showError('No authorization code provided!');
                stopLoading();
                return;
            }

            const dipConfig = globalAccessPoint.getValue('dipConfig');
            const encryptedPayload = await Api.prepareDataForEncryption({
                authorizationCode: code
            });
            const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

            const postEncryptionPayload = {
                packet: { encryptedString: encryptedPayload.encryptedString }
            };

            const dipSignature = await Api.prepareDataForDIP(postEncryptionPayload, dipConfig);

            const dipOptions = {
                ...dipConfig,
                dipState: 'ACTIVE',
                dipSignature: dipSignature.dipSignature,
                salt: dipSignature.salt,
                timestamp: dipSignature.timestamp
            };

            const request = await Api.fetch(
                DEVICE_AUTHORIZATION_ENDPOINT,
                'POST',
                authHeader.authHead,
                postEncryptionPayload,
                dipOptions,
                encryptedPayload.encryption
            );

            const data = await request.json();
            stopLoading();

            if (data.error) {
                showError(data.errorData?.context[0] || 'Unable to authorize device, try again!');
                return;
            }

            if (data.data.success) showSuccess();
        };

        // Click event
        button.addEventListener('click', handleAuthorization);

        // ✅ Enter key event listener
        input.addEventListener('keypress', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                button.click();
            }
        });
    } catch (e) {
        throw new Error(e);
    }
};

export { renderDeviceAuthorizationUI };
