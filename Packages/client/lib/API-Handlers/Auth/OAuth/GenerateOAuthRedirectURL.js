const SUPPORTED_PROVIDERS = ['GOOGLE', 'GITHUB', 'MICROSOFT', 'DISCORD', 'FACEBOOK', 'AMAZON', 'SLACK', 'APPLE', 'TWITTER', 'LINKEDIN', 'REDDIT', 'SPOTIFY', 'AUTHCORE'];

async function generateOAuthRedirectURL({ Api, getAuthHeader, dipConfig, This, providerName }) {
    if (!SUPPORTED_PROVIDERS.includes(providerName.toUpperCase().trim())) {
        return { error: true, errorCode: 'CLIENT-OAUTH-UNSUPPORTED-PROVIDER' };
    }

    const packet = {
        packet: {
            providerName: providerName.trim()
        }
    };

    const dipSignature = await Api.prepareDataForDIP(packet, dipConfig);

    const dipOptions = {
        ...dipConfig,
        dipState: 'ACTIVE',
        dipSignature: dipSignature.dipSignature,
        salt: dipSignature.salt,
        timestamp: dipSignature.timestamp
    };

    const authHeader = await getAuthHeader(false, 'NO_AUTH_BEARER');

    const res = await Api.fetch(`/${This.systemConfig.nameSpace}/api/v1/action/get-o-auth-redirect-url`, 'POST', authHeader.authHead, packet, dipOptions, null);

    const data = await res.json();

    if (data.error) {
        return data;
    }

    const redirectURL = data.data.redirectURL;

    return { error: false, redirectURL: redirectURL };
}

export { generateOAuthRedirectURL };
