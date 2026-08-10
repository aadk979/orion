import { ApiInterface } from './Utils/Api.js';
import { getAuthHeader } from './Utils/Authorisation.js';
import { checkAndDeployCaptcha } from './Utils/Captcha.js';
import { orionVault } from './Utils/OrionVault.js';
import { signInUser } from './API-Handlers/Auth/SignInUser.js';
import { signUpUser } from './API-Handlers/Auth/SignUpUser.js';
import { registerPasskey } from './API-Handlers/Auth/Passkey/RegisterPasskey.js';
import { signInWithPasskey } from './API-Handlers/Auth/Passkey/SignInWithPasskey.js';
import { signUpWithPasskey } from './API-Handlers/Auth/Passkey/SignUpWithPasskey.js';
import { signOutUser } from './API-Handlers/Auth/SignOutUser.js';
import { generateOAuthRedirectURL } from './API-Handlers/Auth/OAuth/GenerateOAuthRedirectURL.js';
import { handleOAuthCallback } from './API-Handlers/Auth/OAuth/HandleOAuthCallback.js';
import { setupTOTP, verifyAndEnableTOTP } from './API-Handlers/Auth/SetupTOTP.js';
import { initiate2FAMethodRemoval, complete2FAMethodRemoval } from './API-Handlers/Auth/Remove2FAMethod.js';
import { getUserProfile } from './API-Handlers/Auth/GetUserProfile.js';
import { listActiveSessions, revokeSession, revokeAllSessions } from './API-Handlers/Auth/SessionManagement.js';
import { globalAccessPoint } from './Utils/GlobalAccessPoint.js';
import { getDeviceFingerprint } from './Utils/DevicePrint.js';
import { renderNotificationsUI } from './Flows/NotificationsFlow.js';

class Orion {
    #authState = { status: 'IDLE' };
    #authListeners = new Set();
    #notificationsInFlight = false;

    static initialized = false;
    static initPromise = null;

    constructor(systemConfig) {
        if (Orion.systemConfig) {
            throw new Error('The Orion class is a singleton class! Initialize it once and export it for use in other files!');
        }

        if (!systemConfig?.serverUrl) {
            throw new Error('The Orion class expects a server url even if the server and client use the same url!');
        }

        systemConfig.nameSpace = 'alpine';

        Orion.systemConfig = systemConfig;

        this.systemConfig = systemConfig;

        globalAccessPoint.setValue('systemConfig', systemConfig);

        // Proof-of-possession binding. Must match the server's `tokens.binding`:
        // a bound server refuses requests without a proof, and an unbound one
        // ignores proofs it is sent. Accepts the explicit `tokens.binding`
        // string so client and server config read identically, or the shorter
        // `useDpop` boolean.
        const bindingEnabled = systemConfig?.tokens?.binding === 'dpop' || systemConfig?.useDpop === true;

        this.Api = new ApiInterface(systemConfig.serverUrl, systemConfig.nameSpace, systemConfig?.slug || '', {
            useDpop: bindingEnabled
        });

        // Whenever the server flags a response with orion-session-logout (any
        // logout-flagged token/auth error, or a revocation of this session),
        // drop the local auth state instead of leaving the app to interpret
        // raw token error codes.
        this.Api.onSessionInvalid = () => this.#handleSessionInvalidated();
    }

    async #handleSessionInvalidated() {
        try {
            await orionVault.deleteItem('USER_EMAIL');
        } catch (e) {
            // vault may not be initialized yet — losing this cleanup is fine
        }

        if (this.#authState.status === 'AUTHENTICATED') {
            this.#emitAuthState({ status: 'UNAUTHENTICATED' });
        }
    }

    #emitAuthState(newState) {
        this.#authState = newState;
        this.#authListeners.forEach(cb => cb(this.#authState));
    }

    onAuthStateChanged(callback) {
        this.#authListeners.add(callback);

        callback(this.#authState);

        if (this.#authState.status === 'IDLE') {
            this.initialize();
        }

        return () => this.#authListeners.delete(callback);
    }

    setUserSignedInState(signedIn, userData = null) {
        if (signedIn) {
            this.#emitAuthState({ status: 'AUTHENTICATED', user: userData });
            this.#checkNotifications();
        } else {
            this.#emitAuthState({ status: 'UNAUTHENTICATED' });
        }
    }

    /**
     * Orion-owned account notices. Runs on every transition into an
     * authenticated state — which covers both a fresh sign-in and a page reload
     * that restores a session — and the SERVER decides whether anything is
     * actually raised. There is no opt-out: these are security facts about the
     * user's own account (a second factor that stopped working, a fleet-wide
     * 2FA reset) that a host application must not be able to hide.
     *
     * Deliberately fire-and-forget: it must never delay or fail the auth state
     * the application is waiting on.
     */
    #checkNotifications() {
        if (this.#notificationsInFlight) return;
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        this.#notificationsInFlight = true;

        renderNotificationsUI(this.systemConfig.serverUrl, this.systemConfig.nameSpace, this.systemConfig?.slug || '', this.systemConfig?.notificationStyles || {})
            .catch(() => {
                /* advisory surface — never surfaced as an auth error */
            })
            .finally(() => {
                this.#notificationsInFlight = false;
            });
    }

    /**
     * Manual trigger for hosts that want to surface pending notices from their
     * own UI (a bell icon, a settings page). The server still decides what is
     * shown; this only asks earlier than the automatic check would.
     */
    async showNotifications() {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await renderNotificationsUI(
            this.systemConfig.serverUrl,
            this.systemConfig.nameSpace,
            this.systemConfig?.slug || '',
            this.systemConfig?.notificationStyles || {}
        );
    }

    async initialize() {
        if (this.#authState.status !== 'IDLE') return;
        if (Orion.initPromise) return Orion.initPromise;

        this.#emitAuthState({ status: 'LOADING' });

        Orion.initPromise = (async () => {
            try {
                await orionVault.initDB();
                await checkAndDeployCaptcha(this.systemConfig.serverUrl, this.systemConfig.nameSpace, this.systemConfig?.slug || '');

                const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');
                const request = await this.Api.fetch(`/${this.systemConfig.nameSpace}/api/v1/action/get-current-auth-state`, 'POST', authHeader.authHead);
                const data = await request.json();

                const allowedErrors = [
                    'AUTH::MISSING-TOKEN::A::p',
                    'TOKEN-ACCESS::EXPIRED::A::p',
                    'TOKEN-REFRESH::EXPIRED::A::p',
                    'AUTH::MISSING-SESSION-CREDENTIALS::A::p'
                ];

                if (data.error && !allowedErrors.includes(data.errorData?.errorCode)) {
                    throw new Error('Unknown error: ' + JSON.stringify(data));
                }

                if (data.data?.authed) {
                    this.setUserSignedInState(true, data.data.user);
                } else {
                    this.setUserSignedInState(false);
                }
                Orion.initialized = true;
            } catch (e) {
                await orionVault.reset();
                this.#emitAuthState({
                    status: 'ERROR',
                    error: { code: 'INIT_FAILED', message: e.message }
                });
            } finally {
                Orion.initPromise = null;
            }
        })();

        return Orion.initPromise;
    }

    async authState(callback) {
        await this.initialize();

        if (typeof callback === 'function') {
            const compatCb = state => {
                callback({
                    signedIn: state.status === 'AUTHENTICATED',
                    loading: state.status === 'IDLE' || state.status === 'LOADING'
                });
            };
            this.#authListeners.add(compatCb);

            callback({
                signedIn: this.#authState.status === 'AUTHENTICATED',
                loading: false
            });

            return () => this.#authListeners.delete(compatCb);
        }
    }

    async signInUser(email, password) {
        await this.initialize();
        if (this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-AUTHED-USER-PRESENT' };

        const args = {
            Api: this.Api,
            orionVault,
            email,
            password,
            getAuthHeader,
            This: this
        };

        try {
            return await signInUser(args);
        } catch (e) {
            if (e._orionDeviceAuthCompleted) {
                // Device was just authorized — retry the sign-in transparently
                return await signInUser(args);
            }
            throw e;
        }
    }

    async signUpUser(email, password) {
        await this.initialize();
        if (this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-AUTHED-USER-PRESENT' };

        return await signUpUser({
            Api: this.Api,
            email,
            password,
            getAuthHeader,
            This: this
        });
    }

    async signOutUser() {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await signOutUser({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    async registerPasskey() {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await registerPasskey({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    async signInWithPasskey(email) {
        await this.initialize();
        if (this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-AUTHED-USER-PRESENT' };

        const args = {
            email,
            Api: this.Api,
            getAuthHeader,
            This: this
        };

        try {
            return await signInWithPasskey(args);
        } catch (e) {
            if (e._orionDeviceAuthCompleted) {
                // Device was just authorized — retry passkey sign-in (fresh challenge)
                return await signInWithPasskey(args);
            }
            throw e;
        }
    }

    async signUpWithPasskey(email) {
        await this.initialize();
        if (this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-AUTHED-USER-PRESENT' };

        return await signUpWithPasskey({
            email,
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    async generateOAuthRedirectURLAndRedirect(providerName) {
        await this.initialize();
        if (this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-AUTHED-USER-PRESENT' };

        const result = await generateOAuthRedirectURL({
            Api: this.Api,
            getAuthHeader,
            This: this,
            providerName
        });

        if (result.error) {
            return result;
        }

        // Persist provider so the callback page can restart the flow after device auth
        sessionStorage.setItem('orion_oauth_provider', providerName);

        window.location.replace(result.redirectURL);
    }

    async handleOAuthCallback() {
        await this.initialize();
        if (this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-AUTHED-USER-PRESENT' };

        let result;
        try {
            result = await handleOAuthCallback({
                Api: this.Api,
                getAuthHeader,
                This: this
            });
        } catch (e) {
            if (e._orionDeviceAuthCompleted) {
                // OAuth codes are single-use — re-initiate a fresh OAuth redirect for the same provider.
                const provider = sessionStorage.getItem('orion_oauth_provider');
                sessionStorage.removeItem('orion_oauth_provider');

                if (provider) {
                    return await this.generateOAuthRedirectURLAndRedirect(provider);
                }
                // Fallback: no saved provider, go to app root
                const { postAuthRedirect = window.location.origin } = globalAccessPoint.getValue('systemConfig') || {};
                window.location.replace(postAuthRedirect.toString());
                return { error: false, signedIn: false };
            }
            throw e;
        }

        // Successful callback — clear any stale provider key
        sessionStorage.removeItem('orion_oauth_provider');

        if (result.error) {
            return result;
        }

        if (result.signedIn) {
            this.setUserSignedInState(true);
        }

        return { error: false, signedIn: result.signedIn };
    }

    async setupTOTP() {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await setupTOTP({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    async verifyAndEnableTOTP(totpCode) {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await verifyAndEnableTOTP({
            Api: this.Api,
            getAuthHeader,
            This: this,
            totpCode
        });
    }

    async initiate2FAMethodRemoval(method) {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await initiate2FAMethodRemoval({
            Api: this.Api,
            getAuthHeader,
            This: this,
            method
        });
    }

    async complete2FAMethodRemoval(code) {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await complete2FAMethodRemoval({
            Api: this.Api,
            getAuthHeader,
            This: this,
            code
        });
    }

    async getUserProfile() {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await getUserProfile({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    /**
     * Active sessions for the signed-in user, grouped by session (one access +
     * refresh token pair per entry). The entry whose `current` flag is true is
     * the session making this call.
     */
    async listActiveSessions() {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await listActiveSessions({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    /**
     * Revoke a single session or token. Pass exactly one of:
     *   { linkCode } — revoke a whole session (access + refresh pair)
     *   { tokenId }  — revoke one specific token
     * If the revoked session is the current one, local auth state is torn down.
     */
    async revokeSession({ tokenId, linkCode } = {}) {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await revokeSession({
            Api: this.Api,
            getAuthHeader,
            This: this,
            tokenId,
            linkCode
        });
    }

    /**
     * Revoke every session for this user. keepCurrent: true (default) spares
     * the session making the call ("sign out everywhere else"); false signs
     * out this device too.
     */
    async revokeAllSessions({ keepCurrent = true } = {}) {
        await this.initialize();
        if (this.#authState.status !== 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await revokeAllSessions({
            Api: this.Api,
            getAuthHeader,
            This: this,
            keepCurrent
        });
    }
}

export { Orion, getDeviceFingerprint };