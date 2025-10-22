async function handleOAuthCallback({ Api, getAuthHeader, dipConfig, This }) {
    // Extract code and state from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');

    if (!code || !state) {
        return { error: true, errorCode: "CLIENT-OAUTH-MISSING-CALLBACK-PARAMETERS" };
    }

    const packet = {
        packet: {
            code: code,
            state: state
        }
    };

    const dipSignature = await Api.prepareDataForDIP(packet, dipConfig);

    const dipOptions = {
        ...dipConfig,
        dipState: "ACTIVE",
        dipSignature: dipSignature.dipSignature,
        salt: dipSignature.salt,
        timestamp: dipSignature.timestamp
    };

    const authHeader = await getAuthHeader(false, "NO_AUTH_BEARER");

    const res = await Api.fetch(
        `/${This.systemConfig.nameSpace}/api/v1/action/handle-o-auth-callback`,
        "POST",
        authHeader.authHead,
        packet,
        dipOptions,
        null
    );

    const data = await res.json();

    if (data.error) {
        return data.errorData;
    }

    // Clear URL parameters after successful callback processing
    const url = new URL(window.location);
    url.searchParams.delete('code');
    url.searchParams.delete('state');
    window.history.replaceState({}, '', url.toString());

    return { error: false, signedIn: data.data.signedIn };
}

export { handleOAuthCallback };
