import { orionVault } from '../../Utils/OrionVault.js';

async function signOutUser({ Api, getAuthHeader, This }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const request = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/sign-out-user`, 'POST', authHeader.authHead, {});

    const data = await request.json();
    if (data.error) return data.errorData;

    await orionVault.deleteItem('USER_EMAIL');

    This.setUserSignedInState(false);

    return { error: false, complete: true };
}

export { signOutUser };
