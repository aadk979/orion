import { orionVault } from "./OrionVault.js";

const authConfigs = new Map([
    ["ACCESS_BEARER", "SIGNED-IN"],
    ["REFRESH_BEARER", "SIGNED-IN"],
    ["NO_AUTH_BEARER", "SIGNED-OUT"],
    ["NO_BEARER", "SIGNED-OUT"],
]);

const handlers = {
    ACCESS_BEARER: async () => {
        const accessToken = await orionVault.getItem("ACCESS_TOKEN");
        if (!accessToken) throw new Error("Signed in, but no access token found!");
        return { authHead: `ACCESS_BEARER ${accessToken}` };
    },
    REFRESH_BEARER: async () => {
        const refreshToken = await orionVault.getItem("REFRESH_TOKEN");
        if (!refreshToken) throw new Error("Signed in, but no refresh token found!");
        return { authHead: `REFRESH_BEARER ${refreshToken}` };
    },
    NO_AUTH_BEARER: async () => {
        const token = await orionVault.getItem("ACCESS_TOKEN");
        if (token) throw new Error("Signed out, but access token exists!");
        return { authHead: "NO_AUTH_BEARER" };
    },
    NO_BEARER: async () => ({ authHead: "NO_BEARER" }),
};

const getAuthHeader = async (userState, type) => {
    const internalState = userState ? "SIGNED-IN" : "SIGNED-OUT";
    const expectedState = authConfigs.get(type);

    if (!expectedState) throw new Error("Invalid auth config type!");
    if (internalState !== expectedState) throw new Error("Mismatched user state!");

    return await handlers[type]();
};

export { getAuthHeader };