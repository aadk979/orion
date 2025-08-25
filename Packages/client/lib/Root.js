import { ApiInterface } from "./Utils/Api.js";
import { getAuthHeader } from "./Utils/Authorisation.js";
import { checkAndDeployCaptcha } from "./Utils/Captcha.js";
import { orionVault } from "./Utils/OrionVault.js";
import { getDIP } from "./API-Handlers/Helper/dip.js";
import { signInUser } from "./API-Handlers/Auth/SignInUser.js";
import { signUpUser } from "./API-Handlers/Auth/SignUpUser.js";
import { registerPasskey } from "./API-Handlers/Auth/Passkey/registerPasskey.js";
import { signInWithPasskey } from "./API-Handlers/Auth/Passkey/signInWithPasskey.js";

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

  async #refreshAccessToken() {
    const refreshToken = await orionVault.getItem("REFRESH_TOKEN");

    if (!refreshToken) {
      return { error: true, errorCode: "CLIENT-NO-REFRESH-TOKEN-PRESENT" };
    }

    const authHeader = await getAuthHeader(this.#signedIn, "REFRESH_BEARER");

    const newToken = await this.Api.fetch(
      `/${this.systemConfig.nameSpace}/api/v1/action/refresh-access-token-blind`,
      "POST",
      authHeader,
      undefined
    );

    if (newToken.error) {
      return { error: true, errorCode: newToken.errorCode };
    }

    const data = await newToken.json();
    const newAccessToken = data.accessToken;

    await orionVault.setItem("ACCESS_TOKEN", newAccessToken);

    return { error: false };
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

      const accessToken = await orionVault.getItem("ACCESS_TOKEN");

      this.#signedIn = !!accessToken;
      Orion.initialized = true;
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