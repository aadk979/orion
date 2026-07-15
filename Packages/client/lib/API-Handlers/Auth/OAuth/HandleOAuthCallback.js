import { globalAccessPoint } from "../../../Utils/GlobalAccessPoint.js";

async function handleOAuthCallback({ Api, getAuthHeader, This }) {
    // Extract code and state from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (!code || !state) {
        return { error: true, errorCode: 'CLIENT-OAUTH-MISSING-CALLBACK-PARAMETERS' };
    }

    const packet = {
        packet: {
            code: code,
            state: state
        }
    };

    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/handle-o-auth-callback`, 'POST', authHeader.authHead, packet);

    const data = await res.json();

    if (data.error) {
        return data.errorData;
    }

    const { postAuthRedirect = window.location.origin } = globalAccessPoint.getValue("systemConfig");

    window.history.replaceState({}, '', postAuthRedirect.toString());

    return { error: false, signedIn: data.data.signedIn };
}

export { handleOAuthCallback };
