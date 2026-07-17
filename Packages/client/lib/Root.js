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
import { globalAccessPoint } from './Utils/GlobalAccessPoint.js';
import { getDeviceFingerprint } from './Utils/DevicePrint.js';

class Orion {
    #authState = { status: 'IDLE' };
    #authListeners = new Set();

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

        this.Api = new ApiInterface(systemConfig.serverUrl, systemConfig.nameSpace, systemConfig?.slug || '');
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
        } else {
            this.#emitAuthState({ status: 'UNAUTHENTICATED' });
        }
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

                const allowedErrors = ['AUTH::MISSING-TOKEN::A::p', 'TOKEN-ACCESS::EXPIRED::A::p', 'TOKEN-REFRESH::EXPIRED::A::p', 'AUTH::MISSING-SESSION-CREDENTIALS::A::p'];

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
            const compatCb = (state) => {
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
        if (!this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await signOutUser({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    async registerPasskey() {
        await this.initialize();
        if (!this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

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
        if (!this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await setupTOTP({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }

    async verifyAndEnableTOTP(totpCode) {
        await this.initialize();
        if (!this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await verifyAndEnableTOTP({
            Api: this.Api,
            getAuthHeader,
            This: this,
            totpCode
        });
    }

    async initiate2FAMethodRemoval(method) {
        await this.initialize();
        if (!this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await initiate2FAMethodRemoval({
            Api: this.Api,
            getAuthHeader,
            This: this,
            method
        });
    }

    async complete2FAMethodRemoval(code) {
        await this.initialize();
        if (!this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await complete2FAMethodRemoval({
            Api: this.Api,
            getAuthHeader,
            This: this,
            code
        });
    }

    async getUserProfile() {
        await this.initialize();
        if (!this.#authState.status === 'AUTHENTICATED') return { error: true, errorCode: 'CLIENT-AUTH-NO-AUTHED-USER-PRESENT' };

        return await getUserProfile({
            Api: this.Api,
            getAuthHeader,
            This: this
        });
    }
}

export { Orion, getDeviceFingerprint };

