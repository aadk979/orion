import { orionVault } from '../../Utils/OrionVault.js';
import { resetKey } from '../../Utils/DpopKey.js';
import { resetDeviceFingerprint } from '../../Utils/DevicePrint.js';

async function signOutUser({ Api, getAuthHeader, This }) {
    const authHeader = await getAuthHeader(true, 'ACCESS_BEARER');

    const request = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/sign-out-user`, 'POST', authHeader.authHead, {});

    const data = await request.json();
    if (data.error) return data.errorData;

    await orionVault.deleteItem('USER_EMAIL');

    // Drop the device signing key. It is only reachable from this browser
    // profile either way, but on a shared machine it means the next person's
    // session is bound to a key that never covered the previous one — and a
    // key with no live session bound to it has no reason to persist. Done after
    // the server call, which still needs a valid proof to be accepted.
    await resetKey();

    // The device signal is a persisted per-origin identifier, so it is dropped
    // with the key for the same reason — on a shared machine the next session
    // should not inherit the previous one's device identity.
    await resetDeviceFingerprint();

    This.setUserSignedInState(false);

    return { error: false, complete: true };
}

export { signOutUser };
