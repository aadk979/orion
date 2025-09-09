import { ApiInterface } from "./Utils/Api.js";
import { getAuthHeader } from "./Utils/Authorisation.js";
import { checkAndDeployCaptcha } from "./Utils/Captcha.js";
import { orionVault } from "./Utils/OrionVault.js";
import { getDIP } from "./API-Handlers/Helper/dip.js";
import { signInUser } from "./API-Handlers/Auth/SignInUser.js";
import { signUpUser } from "./API-Handlers/Auth/SignUpUser.js";
import { registerPasskey } from "./API-Handlers/Auth/Passkey/RegisterPasskey.js";
import { signInWithPasskey } from "./API-Handlers/Auth/Passkey/SignInWithPasskey.js";

class Orion {
  #signedIn = null;
  #user = null;
  #authListeners = new Set();

  constructor(systemConfig) {
    if (Orion.systemConfig) {
      throw new Error(
        "The Orion class is a singleton class! Initialize it once and export it for use in other files!"
      );
    }

    Orion.systemConfig = systemConfig;
    this.systemConfig = systemConfig;
    Orion.initialized = false;
    this.Api = new ApiInterface(systemConfig.serverUrl, systemConfig.nameSpace);
  }

  setUserSignedInState(state) {
    const changed = this.#signedIn !== state;
    this.#signedIn = state;
    if (changed) {
      this.#authListeners.forEach((cb) => cb(state));
    }
  }

  setUser(user) {
    this.#user = user;
  }

  async initialize() {
    try {
      await orionVault.initDB();
      await checkAndDeployCaptcha(this.systemConfig.serverUrl, this.systemConfig.nameSpace);

      const dipConfig = await getDIP({
        Api: this.Api,
        getAuthHeader,
        nameSpace: this.systemConfig.nameSpace,
      });

      this.dipConfig = dipConfig;

      const authHeader = await getAuthHeader(true, "ACCESS_BEARER");

      const request = await this.Api.fetch(`/${this.systemConfig.nameSpace}/api/v1/action/get-current-auth-state`, 'POST', authHeader.authHead, null, null, null);

      const data = await request.json();

      if (data.error) {
        const allowedErrors = [
          "MISSING-AUTHENTICATION-TOKEN",
          "ACCESS-TOKEN-EXPIRED", // Impossible error code, but added just incase
          "REFRESH-TOKEN-EXPIRED"
        ]

        if (!allowedErrors.includes(data.errorData.errorCode)) {
            throw new Error("Unkown error: " + JSON.stringify(data));
        }

        this.#signedIn = false;
        Orion.initialized = true;
        return;
      }

      if (data.data.authed) {
        this.#signedIn = true;
        Orion.initialized = true;
        return;
      }

      throw new Error("Unkown error: Unexpected API response: " + JSON.stringify(data));
    } catch (e) {
      throw new Error("Error during initialization: " + e.message);
    }
  }

  async signInUser(email, password) {
    if (!Orion.initialized) await this.initialize();
    if (this.#signedIn)
      return { error: true, errorCode: "CLIENT-AUTH-AUTHED-USER-PRESENT" };

    const result = await signInUser({
      Api: this.Api,
      orionVault,
      email,
      password,
      dipConfig: this.dipConfig,
      getAuthHeader,
      This: this,
    });

    return result;
  }

  async signUpUser(email, password) {
    if (!Orion.initialized) await this.initialize();
    if (this.#signedIn)
      return { error: true, errorCode: "CLIENT-AUTH-AUTHED-USER-PRESENT" };

    return await signUpUser({
      Api: this.Api,
      email,
      password,
      getAuthHeader,
      This: this,
      dipConfig: this.dipConfig
    });
  }

  async registerPasskey() {
    if (!Orion.initialized) await this.initialize();
    if (!this.#signedIn)
      return { error: true, errorCode: "CLIENT-AUTH-NO-AUTHED-USER-PRESENT" };

    return await registerPasskey({
      Api: this.Api,
      getAuthHeader,
      dipConfig: this.dipConfig,
      This: this,
    });
  }

  async signInWithPasskey(email) {
    if (!Orion.initialized) await this.initialize();
    if (this.#signedIn)
      return { error: true, errorCode: "CLIENT-AUTH-AUTHED-USER-PRESENT" };

    const result = await signInWithPasskey({
      email,
      Api: this.Api,
      getAuthHeader,
      dipConfig: this.dipConfig,
      This: this,
    });

    return result;
  }

  authState(callback) {
    if (typeof callback === "function") {
      this.#authListeners.add(callback);
      callback(this.#signedIn);
      return () => this.#authListeners.delete(callback);
    }
  }
}

const orion = new Orion({
  nameSpace: "point-break",
  serverUrl: "http://localhost:3495",
});

export { orion };