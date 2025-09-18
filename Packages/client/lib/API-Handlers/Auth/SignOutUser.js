import { orionVault } from "../../Utils/OrionVault";

async function signOutUser({ Api, getAuthHeader, This, dipConfig }) {
    const authHeader = await getAuthHeader(true, "ACCESS_BEARER");

    const request = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/sign-out-user`,
        "POST",
        authHeader.authHead,
        {},
        null,
        null
    );

    const data = await request.json();
    if (data.error) return data.errorData;

    await orionVault.deleteItem("USER_EMAIL", cleanedEmail);

    This.setUserSignedInState(false);
    This.setUser(null)

    return { error: false, complete: true };
}

export { signOutUser };