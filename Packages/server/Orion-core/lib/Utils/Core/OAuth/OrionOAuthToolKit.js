import * as oidc from 'openid-client';
import { logger } from '../../logger.js';

// Bounded timeout on every provider call so a slow provider cannot hang a worker.
const HTTP_TIMEOUT_MS = 10 * 1000;

/**
 * Per-provider fetch wrapper: injects provider-specific headers
 * (e.g. GitHub's Accept, Reddit's User-Agent) and enforces the timeout.
 * All openid-client HTTP for a Configuration is routed through this.
 */
const buildProviderFetch =
    extraHeaders =>
    (url, options = {}) => {
        const headers = new Headers(options.headers);
        for (const [name, value] of Object.entries(extraHeaders || {})) {
            headers.set(name, value);
        }
        const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        return fetch(url, { ...options, headers, signal });
    };

class OAuthProviderToolkit {
    constructor(config) {
        // Proper singleton: reuse existing instance
        if (OAuthProviderToolkit.instance) {
            if (config && config !== OAuthProviderToolkit.instance.config) {
                logger.warn(
                    'OAuthProviderToolkit is already instantiated; the new config passed to this constructor is ignored. Restart the server to change OAuth configuration.'
                );
            }
            return OAuthProviderToolkit.instance;
        }

        this.allowedClients = ['google', 'github', 'discord', 'slack', 'microsoft'];

        this.config = config;
        this.clients = {};

        // Provider registry. Flags drive the flow:
        //  - pkce:            send code_challenge / code_verifier (S256)
        //  - sendNonce:       bind the id_token to the request via nonce
        //  - idTokenExpected: fail the exchange when no id_token is returned
        //  - clientAuth:      'basic' for providers that require HTTP Basic at the
        //                     token endpoint; client_secret_post otherwise
        // Identity comes from validated id_token claims when the provider returns
        // one (jwksUri set), from the userinfo endpoint otherwise.
        this.providers = {
            google: {
                issuer: 'https://accounts.google.com',
                authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
                tokenUrl: 'https://oauth2.googleapis.com/token',
                userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
                jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
                scope: 'openid email profile',
                pkce: true,
                sendNonce: true,
                idTokenExpected: true
            },
            github: {
                issuer: 'https://github.com',
                authUrl: 'https://github.com/login/oauth/authorize',
                tokenUrl: 'https://github.com/login/oauth/access_token',
                userInfoUrl: 'https://api.github.com/user',
                emailUrl: 'https://api.github.com/user/emails',
                scope: 'user:email',
                // GitHub returns form-encoded token responses unless JSON is requested
                headers: { Accept: 'application/json' },
                pkce: false
            },
            discord: {
                issuer: 'https://discord.com',
                authUrl: 'https://discord.com/api/oauth2/authorize',
                tokenUrl: 'https://discord.com/api/oauth2/token',
                userInfoUrl: 'https://discord.com/api/users/@me',
                scope: 'identify email',
                pkce: true
            },
            // "Sign in with Slack" (OIDC) — replaces the legacy oauth.v2.access +
            // users.identity flow; the Slack app must be configured with these
            // scopes, not the legacy identity.* ones. Identity comes from the
            // validated id_token (standard OIDC claims). Nonce is not sent:
            // Slack's echo of it is unverified and a missing claim would hard-fail
            // the exchange; Orion's own state/flow-secret binding covers replay.
            slack: {
                issuer: 'https://slack.com',
                authUrl: 'https://slack.com/openid/connect/authorize',
                tokenUrl: 'https://slack.com/api/openid.connect.token',
                userInfoUrl: 'https://slack.com/api/openid.connect.userInfo',
                jwksUri: 'https://slack.com/openid/connect/keys',
                scope: 'openid email profile',
                pkce: false,
                sendNonce: false
            },
            // Multi-tenant ('common') Microsoft cannot pass strict OIDC issuer
            // validation (iss varies per tenant), so the default mode is plain
            // OAuth2 with identity from Microsoft Graph. Pin a single tenant by
            // setting `issuer` in the provider config
            // (https://login.microsoftonline.com/<tenant-id>/v2.0) to get full
            // OIDC id_token validation instead.
            microsoft: {
                issuer: 'https://login.microsoftonline.com/common/v2.0',
                authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
                tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
                scope: 'User.Read',
                pkce: true
            },
            facebook: {
                issuer: 'https://www.facebook.com',
                authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
                tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
                // Facebook only returns id+name by default; fields must be requested explicitly
                userInfoUrl: 'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.width(256)',
                scope: 'email,public_profile',
                pkce: false
            },
            amazon: {
                issuer: 'https://www.amazon.com',
                authUrl: 'https://www.amazon.com/ap/oa',
                tokenUrl: 'https://api.amazon.com/auth/o2/token',
                userInfoUrl: 'https://api.amazon.com/user/profile',
                scope: 'profile',
                pkce: false
            },
            twitter: {
                issuer: 'https://twitter.com',
                authUrl: 'https://twitter.com/i/oauth2/authorize',
                tokenUrl: 'https://api.twitter.com/2/oauth2/token',
                userInfoUrl: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,verified',
                scope: 'tweet.read users.read offline.access',
                // X requires PKCE and Basic auth for confidential clients
                pkce: true,
                clientAuth: 'basic'
            },
            linkedin: {
                issuer: 'https://www.linkedin.com',
                authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
                tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
                userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
                jwksUri: 'https://www.linkedin.com/oauth/openid/jwks',
                scope: 'openid profile email',
                // LinkedIn's OIDC does not reliably echo nonce; identity still
                // comes from the signature/iss/aud-validated id_token
                pkce: false,
                sendNonce: false
            },
            reddit: {
                issuer: 'https://www.reddit.com',
                authUrl: 'https://www.reddit.com/api/v1/authorize',
                tokenUrl: 'https://www.reddit.com/api/v1/access_token',
                userInfoUrl: 'https://oauth.reddit.com/api/v1/me',
                scope: 'identity',
                headers: { 'User-Agent': 'Orion-OAuth/1.0' },
                pkce: false,
                clientAuth: 'basic'
            },
            spotify: {
                issuer: 'https://accounts.spotify.com',
                authUrl: 'https://accounts.spotify.com/authorize',
                tokenUrl: 'https://accounts.spotify.com/api/token',
                userInfoUrl: 'https://api.spotify.com/v1/me',
                scope: 'user-read-email user-read-private',
                pkce: true
            }
        };

        OAuthProviderToolkit.instance = this;
    }

    /**
     * Initialize a specific provider
     * Returns: true on success, false when skipped (no config / not allowed),
     * or an { error, errorCode } object on failure.
     */
    async initializeProvider(providerName) {
        const config = this.config[providerName];
        if (!config) return false;

        if (!this.allowedClients.includes(providerName) && !config.explicitAllow) {
            return false;
        }

        let provider = this.providers[providerName];
        if (!provider) {
            logger.error(`Provider ${providerName} is not a supported provider`);
            return { error: true, errorCode: 'OAUTH::UNSUPPORTED-PROVIDER::A::p' };
        }
        if (!config.clientId || !config.clientSecret || !config.redirectUri) {
            logger.error(`Provider ${providerName} has incomplete configuration`);
            return { error: true, errorCode: 'OAUTH::INVALID-PROVIDER-CONFIG::A::i' };
        }

        // Tenant-pinned Microsoft: strict issuer validation works, so switch to
        // the full OIDC flow with id_token identity.
        if (providerName === 'microsoft' && config.issuer) {
            provider = {
                ...provider,
                jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
                scope: 'openid email profile User.Read',
                sendNonce: true,
                idTokenExpected: true
            };
        }

        const merged = {
            ...provider,
            // Optional overrides: issuer (Microsoft tenant pinning), jwksUri, scope
            ...(config.issuer && { issuer: config.issuer }),
            ...(config.jwksUri && { jwksUri: config.jwksUri }),
            ...(config.scope && { scope: config.scope })
        };

        const serverMetadata = {
            issuer: merged.issuer,
            authorization_endpoint: merged.authUrl,
            token_endpoint: merged.tokenUrl,
            ...(merged.userInfoUrl && { userinfo_endpoint: merged.userInfoUrl }),
            ...(merged.jwksUri && { jwks_uri: merged.jwksUri })
        };

        const clientAuth = merged.clientAuth === 'basic' ? oidc.ClientSecretBasic(config.clientSecret) : oidc.ClientSecretPost(config.clientSecret);

        let oidcConfig;
        try {
            oidcConfig = new oidc.Configuration(serverMetadata, config.clientId, undefined, clientAuth);
        } catch (error) {
            logger.error(`Provider ${providerName} metadata rejected by openid-client: ${error.message}`);
            return { error: true, errorCode: 'OAUTH::INVALID-PROVIDER-CONFIG::A::i' };
        }
        oidcConfig[oidc.customFetch] = buildProviderFetch(merged.headers);

        this.clients[providerName] = {
            ...merged,
            oidcConfig,
            clientId: config.clientId,
            redirectUri: config.redirectUri
        };

        logger.info(`Initialized OAuth provider: ${providerName}`);
        return true;
    }

    /**
     * Fresh PKCE code verifier for one authorization request.
     * The caller persists it server-side and passes it back on callback.
     */
    generateCodeVerifier() {
        return oidc.randomPKCECodeVerifier();
    }

    /**
     * Fresh OIDC nonce for one authorization request.
     */
    generateNonce() {
        return oidc.randomNonce();
    }

    /**
     * Generate authorization URL for any provider.
     * pkce: { codeVerifier, nonce } — the code_challenge is derived here (S256);
     * each value is only sent to providers flagged for it.
     */
    async generateAuthUrl(providerName, state = null, pkce = {}) {
        const client = this.clients[providerName];
        if (!client) {
            return { error: true, errorCode: 'OAUTH::PROVIDER-NOT-INITIALIZED::A::i' };
        }

        const parameters = {
            redirect_uri: client.redirectUri,
            scope: client.scope,
            ...(state && { state }),
            ...(client.sendNonce && pkce.nonce && { nonce: pkce.nonce })
        };

        if (client.pkce && pkce.codeVerifier) {
            parameters.code_challenge = await oidc.calculatePKCECodeChallenge(pkce.codeVerifier);
            parameters.code_challenge_method = 'S256';
        }

        const redirectURL = oidc.buildAuthorizationUrl(client.oidcConfig, parameters);
        return { error: false, redirectURL: redirectURL.href };
    }

    /**
     * Handle callback and get user information.
     * pkce: { codeVerifier, nonce } — must be the values stored when the
     * authorization URL was generated. Token exchange, id_token signature /
     * issuer / audience / nonce validation and JWKS caching are all handled
     * by openid-client; a failed id_token validation fails the exchange.
     * (state is validated upstream by HandleOAuthCallback.js, not here.)
     */
    async handleCallback(providerName, code, pkce = {}) {
        const client = this.clients[providerName];
        if (!client) {
            return { error: true, errorCode: 'OAUTH::PROVIDER-NOT-INITIALIZED::A::i' };
        }

        // Orion validates state/flow-secret/IP upstream, so the synthetic
        // callback URL carries only the code.
        const callbackUrl = new URL(client.redirectUri);
        callbackUrl.searchParams.set('code', code);

        let tokens;
        try {
            tokens = await oidc.authorizationCodeGrant(client.oidcConfig, callbackUrl, {
                ...(client.pkce && pkce.codeVerifier && { pkceCodeVerifier: pkce.codeVerifier }),
                ...(client.sendNonce && pkce.nonce && { expectedNonce: pkce.nonce }),
                ...(client.idTokenExpected && { idTokenExpected: true })
            });
        } catch (error) {
            logger.error(`Token exchange failed for ${providerName}: ${error.message}`);
            return { error: true, errorCode: 'OAUTH::TOKEN-EXCHANGE-FAILED::A::i' };
        }

        const accessToken = tokens.access_token;

        // claims() is only populated after openid-client validated the id_token
        const idTokenClaims = tokens.claims();

        let normalizedUser = null;

        if (idTokenClaims) {
            normalizedUser = this.normalizeFromIdToken(providerName, idTokenClaims);
        }

        if (!normalizedUser) {
            // Providers without a userinfo endpoint have no fallback: if there
            // are no validated id_token claims, the identity cannot be trusted.
            if (!client.userInfoUrl) {
                return { error: true, errorCode: 'OAUTH::ID-TOKEN-VERIFICATION-FAILED::A::i' };
            }

            if (!accessToken) {
                logger.error(`No access token returned by ${providerName}`);
                return { error: true, errorCode: 'OAUTH::TOKEN-EXCHANGE-FAILED::A::i' };
            }

            const userInfoResponse = await this.getUserInfo(providerName, client, accessToken);
            if (userInfoResponse?.error) {
                return userInfoResponse;
            }
            normalizedUser = await this.normalizeUserInfo(providerName, userInfoResponse.raw, accessToken, client);
            if (normalizedUser?.error) {
                return normalizedUser;
            }
        }

        // An identity without a stable provider id is unusable downstream
        if (!normalizedUser?.id) {
            logger.error(`Provider ${providerName} returned an identity without an id`);
            return { error: true, errorCode: 'OAUTH::USERINFO-FETCH-FAILED::A::i' };
        }

        return {
            error: false,
            ...normalizedUser,
            accessToken,
            refreshToken: tokens.refresh_token || null,
            idToken: tokens.id_token || null
        };
    }

    /**
     * Get user information from provider
     */
    async getUserInfo(providerName, client, accessToken) {
        if (!client.userInfoUrl) {
            return { raw: null };
        }

        try {
            const response = await oidc.fetchProtectedResource(client.oidcConfig, accessToken, new URL(client.userInfoUrl), 'GET');
            if (!response.ok) {
                logger.error(`UserInfo fetch failed for ${providerName}: ${response.status}`);
                return { error: true, errorCode: 'OAUTH::USERINFO-FETCH-FAILED::A::i' };
            }
            return { raw: await response.json() };
        } catch (error) {
            logger.error(`UserInfo fetch failed for ${providerName}: ${error.message}`);
            return { error: true, errorCode: 'OAUTH::USERINFO-FETCH-FAILED::A::i' };
        }
    }

    /**
     * Normalize identity from validated ID token claims
     */
    normalizeFromIdToken(providerName, claims) {
        switch (providerName) {
            case 'google':
            case 'linkedin':
                return {
                    id: claims.sub,
                    email: claims.email || null,
                    name: claims.name || claims.given_name || null,
                    picture: claims.picture || null,
                    verified: claims.email_verified !== false
                };

            case 'microsoft':
                return {
                    id: claims.sub || claims.oid || claims.objectId,
                    email: claims.email || claims.preferred_username || null,
                    name: claims.name || null,
                    picture: null,
                    verified: true
                };

            default:
                // Generic OIDC mapping
                return {
                    id: claims.sub,
                    email: claims.email || null,
                    name: claims.name || null,
                    picture: claims.picture || null,
                    verified: claims.email_verified !== false
                };
        }
    }

    /**
     * Normalize user information across different providers (userinfo-based)
     */
    async normalizeUserInfo(providerName, userData, accessToken, client) {
        if (!userData) {
            logger.error(`Empty userinfo payload for ${providerName}`);
            return { error: true, errorCode: 'OAUTH::USERINFO-FETCH-FAILED::A::i' };
        }

        switch (providerName) {
            case 'google':
                return {
                    id: userData.sub,
                    email: userData.email,
                    name: userData.name,
                    picture: userData.picture,
                    verified: userData.email_verified || false
                };

            case 'github': {
                let email = userData.email;
                if (!email && client.emailUrl) {
                    try {
                        const emailResponse = await oidc.fetchProtectedResource(client.oidcConfig, accessToken, new URL(client.emailUrl), 'GET');
                        if (emailResponse.ok) {
                            const emails = await emailResponse.json();
                            const primaryEmail = emails.find(e => e.primary && e.verified);
                            email = primaryEmail ? primaryEmail.email : null;
                        } else {
                            logger.warn(`Failed to fetch GitHub emails: ${emailResponse.status}`);
                        }
                    } catch (error) {
                        logger.warn(`Failed to fetch GitHub emails: ${error.message}`);
                    }
                }
                return {
                    id: userData.id != null ? userData.id.toString() : null,
                    email,
                    name: userData.name || userData.login,
                    picture: userData.avatar_url,
                    verified: !!email
                };
            }

            case 'microsoft':
                return {
                    id: userData.id,
                    email: userData.mail || userData.userPrincipalName,
                    name: userData.displayName,
                    picture: null,
                    verified: true
                };

            case 'discord':
                return {
                    id: userData.id,
                    email: userData.email,
                    name: userData.username,
                    picture: userData.avatar ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png` : null,
                    verified: userData.verified || false
                };

            case 'facebook': {
                // userInfoUrl requests fields=id,name,email,picture explicitly
                return {
                    id: userData.id,
                    email: userData.email || null,
                    name: userData.name,
                    picture: userData.picture?.data?.url || null,
                    verified: true
                };
            }

            case 'amazon':
                return {
                    id: userData.user_id,
                    email: userData.email,
                    name: userData.name,
                    picture: null,
                    verified: true
                };

            case 'twitter': {
                const twitterUser = userData.data || {};
                return {
                    id: twitterUser.id || null,
                    email: null, // OAuth2 /2 APIs do not surface email
                    name: twitterUser.name || null,
                    picture: twitterUser.profile_image_url || null,
                    // `verified` here would be the blue-check badge, NOT email verification
                    verified: false
                };
            }

            case 'linkedin':
                return {
                    id: userData.sub,
                    email: userData.email,
                    name: userData.name,
                    picture: userData.picture || null,
                    verified: userData.email_verified !== false
                };

            case 'reddit':
                return {
                    id: userData.id,
                    email: null,
                    name: userData.name,
                    picture: userData.icon_img || null,
                    verified: true
                };

            case 'spotify':
                return {
                    id: userData.id,
                    email: userData.email,
                    name: userData.display_name,
                    picture: userData.images?.[0]?.url || null,
                    verified: true
                };

            default:
                // Generic OIDC-ish mapping: never leak raw provider data past this layer
                return {
                    id: userData.sub || userData.id || null,
                    email: userData.email || null,
                    name: userData.name || null,
                    picture: userData.picture || null,
                    verified: userData.email_verified === true
                };
        }
    }

    /**
     * Initialize all configured providers
     */
    async initializeAllProviders() {
        const configuredProviders = Object.keys(this.config);
        if (configuredProviders.length === 0) {
            return;
        }

        const promises = configuredProviders.map(async provider => {
            try {
                const initialized = await this.initializeProvider(provider);
                if (initialized === true) return provider;

                if (!this.allowedClients.includes(provider) && !this.config[provider]?.explicitAllow) {
                    logger.warn(
                        `Initialization of provider ${provider} has been disabled in this release as it has not been fully tested. You may manually override this by setting explicit allow in the config object for the specific provider.`
                    );
                }
            } catch (error) {
                logger.error(`Failed to initialize ${provider}: ${error.message}`);
            }
            return null;
        });

        const results = await Promise.all(promises);
        const successful = results.filter(Boolean);
        return successful;
    }

    getAvailableProviders() {
        return Object.keys(this.clients);
    }

    isProviderAvailable(providerName) {
        return !!this.clients[providerName];
    }
}

export { OAuthProviderToolkit };
