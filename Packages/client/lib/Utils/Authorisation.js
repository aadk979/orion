const authConfigs = new Map([
    ["ACCESS_BEARER", "SIGNED-IN"],
    ["REFRESH_BEARER", "SIGNED-IN"],
    ["NO_AUTH_BEARER", "SIGNED-OUT"],
    ["NO_BEARER", "SIGNED-OUT"],
]);

const handlers = {
    ACCESS_BEARER: async () => {
        return { authHead: `ACCESS_BEARER` };
    },
    REFRESH_BEARER: async () => {
        return { authHead: `REFRESH_BEARER` };
    },
    NO_AUTH_BEARER: async () => {
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