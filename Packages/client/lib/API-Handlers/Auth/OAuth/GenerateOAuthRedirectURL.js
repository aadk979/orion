const SUPPORTED_PROVIDERS = ['GOOGLE', 'GITHUB', 'MICROSOFT', 'DISCORD', 'FACEBOOK', 'AMAZON', 'SLACK', 'TWITTER', 'LINKEDIN', 'REDDIT', 'SPOTIFY'];

async function generateOAuthRedirectURL({ Api, getAuthHeader, This, providerName }) {
    if (!SUPPORTED_PROVIDERS.includes(providerName.toUpperCase().trim())) {
        return { error: true, errorCode: 'CLIENT-OAUTH-UNSUPPORTED-PROVIDER' };
    }

    const packet = {
        packet: {
            providerName: providerName.trim()
        }
    };

    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/get-o-auth-redirect-url`, 'POST', authHeader.authHead, packet);

    const data = await res.json();

    if (data.error) {
        return data;
    }

    const redirectURL = data.data.redirectURL;

    return { error: false, redirectURL: redirectURL };
}

export { generateOAuthRedirectURL };
