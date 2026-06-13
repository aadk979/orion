import axios from 'axios';
import jwt from 'jsonwebtoken'; // or jose; adjust as needed
import jwkToPem from 'jwk-to-pem'; // or use jose JWK utilities
import { logger } from '../../logger.js';

/**
 * Utility: fetch and cache JWKS per issuer
 */
class JwksCache {
    constructor() {
        this.cache = new Map(); // issuer -> { keys, fetchedAt }
        this.ttlMs = 10 * 60 * 1000; // 10 minutes
    }

    async getKeys(jwksUri, issuer) {
        const now = Date.now();
        const cached = this.cache.get(issuer);
        if (cached && now - cached.fetchedAt < this.ttlMs) {
            return cached.keys;
        }

        const res = await axios.get(jwksUri);
        this.cache.set(issuer, { keys: res.data.keys || [], fetchedAt: now });
        return res.data.keys || [];
    }

    async getKey(jwksUri, issuer, kid) {
        const keys = await this.getKeys(jwksUri, issuer);
        // If kid is present, match; otherwise fall back to first signing key
        const jwk = kid ? keys.find(k => k.kid === kid) : keys[0];
        if (!jwk) {
            throw new Error(`No matching JWK for issuer ${issuer} kid=${kid || 'none'}`);
        }
        return jwkToPem(jwk);
    }
}

const jwksCache = new JwksCache();

class OAuthProviderToolkit {
    constructor(config) {
        // Proper singleton: reuse existing instance
        if (OAuthProviderToolkit.instance) {
            return OAuthProviderToolkit.instance;
        }

        this.allowedClients = ['google', 'github', 'discord', 'slack', 'microsoft', 'authcore'];

        this.config = config;
        this.clients = {};

        // Provider metadata extended with OIDC discovery bits where relevant
        this.providers = {
            google: {
                authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
                tokenUrl: 'https://oauth2.googleapis.com/token',
                userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
                jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
                issuer: 'https://accounts.google.com',
                scope: 'openid email profile',
                requiresPKCE: true
            },
            github: {
                authUrl: 'https://github.com/login/oauth/authorize',
                tokenUrl: 'https://github.com/login/oauth/access_token',
                userInfoUrl: 'https://api.github.com/user',
                emailUrl: 'https://api.github.com/user/emails',
                scope: 'user:email',
                // GitHub is not OIDC here; no id_token
                requiresPKCE: true
            },
            discord: {
                authUrl: 'https://discord.com/api/oauth2/authorize',
                tokenUrl: 'https://discord.com/api/oauth2/token',
                userInfoUrl: 'https://discord.com/api/users/@me',
                scope: 'identify email',
                requiresPKCE: true
            },
            slack: {
                authUrl: 'https://slack.com/oauth/v2/authorize',
                tokenUrl: 'https://slack.com/api/oauth.v2.access',
                userInfoUrl: 'https://slack.com/api/users.identity',
                scope: 'identity.basic,identity.email,identity.avatar',
                specialHandling: 'slack',
                requiresPKCE: true
            },
            microsoft: {
                authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
                tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
                // OIDC metadata
                jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
                issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0', // we relax tenant match
                scope: 'openid email profile User.Read',
                requiresPKCE: true
            },
            facebook: {
                // Update to a currently supported version; your app can override via config
                authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
                tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
                userInfoUrl: 'https://graph.facebook.com/me',
                scope: 'email,public_profile',
                requiresPKCE: true
            },
            amazon: {
                authUrl: 'https://www.amazon.com/ap/oa',
                tokenUrl: 'https://api.amazon.com/auth/o2/token',
                userInfoUrl: 'https://api.amazon.com/user/profile',
                scope: 'profile',
                requiresPKCE: true
            },
            apple: {
                authUrl: 'https://appleid.apple.com/auth/authorize',
                tokenUrl: 'https://appleid.apple.com/auth/token',
                // Apple does NOT expose a normal userInfoUrl; identity comes from id_token
                userInfoUrl: null,
                jwksUri: 'https://appleid.apple.com/auth/keys',
                issuer: 'https://appleid.apple.com',
                scope: 'email name',
                specialHandling: 'apple',
                requiresPKCE: true
            },
            twitter: {
                authUrl: 'https://twitter.com/i/oauth2/authorize',
                tokenUrl: 'https://api.twitter.com/2/oauth2/token',
                userInfoUrl: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,verified',
                scope: 'tweet.read users.read offline.access',
                requiresPKCE: true
            },
            linkedin: {
                authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
                tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
                userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
                jwksUri: 'https://www.linkedin.com/oauth/openid/jwks',
                issuer: 'https://www.linkedin.com',
                scope: 'openid profile email',
                requiresPKCE: true
            },
            reddit: {
                authUrl: 'https://www.reddit.com/api/v1/authorize',
                tokenUrl: 'https://www.reddit.com/api/v1/access_token',
                userInfoUrl: 'https://oauth.reddit.com/api/v1/me',
                scope: 'identity',
                requiresBasicAuth: true,
                requiresPKCE: true
            },
            spotify: {
                authUrl: 'https://accounts.spotify.com/authorize',
                tokenUrl: 'https://accounts.spotify.com/api/token',
                userInfoUrl: 'https://api.spotify.com/v1/me',
                scope: 'user-read-email user-read-private',
                requiresPKCE: true
            }

        };

        OAuthProviderToolkit.instance = this;
    }

    /**
     * Initialize a specific provider
     */
    async initializeProvider(providerName) {
        const provider = this.providers[providerName];
        const config = this.config[providerName];

        if (!this.allowedClients.includes(providerName) && !config?.explicitAllow) {
            return;
        }

        if (!config) return false;
        if (!provider) {
            logger.error(`Provider ${providerName} is not supported`);
            return { error: true, errorCode: 'O-AUTH-UNSUPPORTED-PROVIDER' };
        }
        if (!config.clientId || !config.clientSecret || !config.redirectUri) {
            logger.error(`Provider ${providerName} has incomplete configuration`);
            return { error: true, errorCode: 'O-AUTH-INVALID-PROVIDER-CONFIG' };
        }

        this.clients[providerName] = {
            ...provider,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            redirectUri: config.redirectUri,
            // Optional overrides: jwksUri, issuer, etc.
            ...(config.jwksUri && { jwksUri: config.jwksUri }),
            ...(config.issuer && { issuer: config.issuer })
        };

        logger.info(`Initialized OAuth provider: ${providerName}`);
        return true;
    }

    /**
     * Generate authorization URL for any provider
     * PKCE values are provided by the caller to keep the outward API compatible.
     */
    generateAuthUrl(providerName, state = null, pkce = {}) {
        const client = this.clients[providerName];
        if (!client) {
            return { error: true, errorCode: 'O-AUTH-PROVIDER-NOT-INITIALIZED' };
        }

        const params = new URLSearchParams({
            client_id: client.clientId,
            redirect_uri: client.redirectUri,
            response_type: 'code',
            scope: client.scope,
            ...(state && { state })
        });

        // Provider-specific parameters
        if (client.specialHandling === 'slack') {
            params.delete('scope');
            params.append('user_scope', client.scope);
        }

        if (client.specialHandling === 'apple') {
            params.append('response_mode', 'form_post');
            params.append('response_type', 'code id_token');
        }

        // PKCE support: caller passes code_challenge and method
        if (client.requiresPKCE && pkce.codeChallenge && pkce.codeChallengeMethod) {
            params.append('code_challenge', pkce.codeChallenge);
            params.append('code_challenge_method', pkce.codeChallengeMethod);
        }

        return { error: false, redirectURL: `${client.authUrl}?${params.toString()}` };
    }

    /**
     * Handle callback and get user information
     * idToken is passed in when available (e.g. from Apple form_post or OIDC providers).
     */
    async handleCallback(providerName, code, state = null, pkce = {}, idTokenFromCallback = null) {
        const client = this.clients[providerName];
        if (!client) {
            return { error: true, errorCode: 'O-AUTH-PROVIDER-NOT-INITIALIZED' };
        }

        const tokenResponse = await this.exchangeCodeForToken(providerName, client, code, pkce);
        if (tokenResponse?.error) {
            return tokenResponse;
        }

        const accessToken =
            providerName !== 'slack'
                ? tokenResponse.access_token
                : tokenResponse.authed_user?.access_token;

        // Prefer id_token from tokenResponse, but allow external submission (Apple)
        const rawIdToken = tokenResponse.id_token || idTokenFromCallback || null;

        let normalizedUser = null;

        if (rawIdToken && client.jwksUri) {
            try {
                const verified = await this.verifyIdToken(providerName, client, rawIdToken, pkce);
                normalizedUser = this.normalizeFromIdToken(providerName, verified);
            } catch (e) {
                logger.error(`Failed to verify id_token for ${providerName}: ${e.message}`);
                // fallback to userinfo below
            }
        }

        if (!normalizedUser) {
            const userInfoResponse = await this.getUserInfo(providerName, client, accessToken);
            if (userInfoResponse?.error) {
                return userInfoResponse;
            }
            normalizedUser = await this.normalizeUserInfo(
                providerName,
                userInfoResponse.raw,
                accessToken,
                client
            );
        }

        return {
            error: false,
            ...normalizedUser,
            accessToken,
            refreshToken: tokenResponse.refresh_token || null,
            idToken: rawIdToken || null
        };
    }

    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(providerName, client, code, pkce = {}) {
        const params = new URLSearchParams({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            code,
            redirect_uri: client.redirectUri,
            grant_type: 'authorization_code'
        });

        // PKCE verifier
        if (client.requiresPKCE && pkce.codeVerifier) {
            params.append('code_verifier', pkce.codeVerifier);
        }

        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        // Reddit requires Basic Auth
        if (client.requiresBasicAuth) {
            const credentials = Buffer.from(
                `${client.clientId}:${client.clientSecret}`
            ).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
            params.delete('client_id');
            params.delete('client_secret');
        }

        // Apple requires JWT client_secret; allow caller to pre-generate
        if (client.specialHandling === 'apple' && client.generateClientSecret) {
            params.set('client_secret', await client.generateClientSecret());
        }

        try {
            const response = await axios.post(client.tokenUrl, params.toString(), { headers });
            return response.data;
        } catch (error) {
            logger.error(
                `Token exchange failed for ${providerName}: ${error.response?.status} ${error.message}`
            );
            return { error: true, errorCode: 'O-AUTH-TOKEN-EXCHANGE-FAILED' };
        }
    }

    /**
     * Get user information from provider
     */
    async getUserInfo(providerName, client, accessToken) {
        if (!client.userInfoUrl) {
            // e.g. Apple: identity from id_token only
            return { raw: null };
        }

        try {
            const userResponse = await axios.get(client.userInfoUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    ...(providerName === 'reddit' && { 'User-Agent': 'Orion-OAuth/1.0' })
                }
            });
            return { raw: userResponse.data };
        } catch (error) {
            logger.error(
                `UserInfo fetch failed for ${providerName}: ${error.response?.status} ${error.message}`
            );
            return { error: true, errorCode: 'O-AUTH-USERINFO-FAILED' };
        }
    }

    /**
     * Verify and decode id_token via provider JWKS
     */
    async verifyIdToken(providerName, client, idToken, pkce = {}) {
        const decodedHeader = jwt.decode(idToken, { complete: true });
        if (!decodedHeader || !decodedHeader.header) {
            throw new Error('Invalid id_token format');
        }

        const kid = decodedHeader.header.kid;
        const alg = decodedHeader.header.alg;

        if (!alg || !alg.startsWith('RS') && !alg.startsWith('ES')) {
            throw new Error(`Unsupported JWS alg: ${alg}`);
        }

        const issuer = client.issuer;
        if (!issuer || !client.jwksUri) {
            throw new Error('Missing issuer or jwksUri for provider');
        }

        const publicKey = await jwksCache.getKey(client.jwksUri, issuer, kid);

        const options = {
            algorithms: [alg],
            issuer: issuer === 'https://login.microsoftonline.com/{tenantid}/v2.0'
                ? undefined // relax issuer check for multi-tenant unless overridden
                : issuer,
            audience: client.clientId,
            ...(pkce.nonce && { nonce: pkce.nonce })
        };

        // For MS multi-tenant we do audience only and manual iss check
        const payload = jwt.verify(idToken, publicKey, options);

        if (
            issuer === 'https://login.microsoftonline.com/{tenantid}/v2.0' &&
            typeof payload.iss === 'string' &&
            !payload.iss.endsWith('/v2.0')
        ) {
            throw new Error('Unexpected issuer for Microsoft id_token');
        }

        return payload;
    }

    /**
     * Normalize identity from a verified ID token
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

            case 'apple':
                // Apple email is often private relay; name may come only on first auth
                return {
                    id: claims.sub,
                    email: claims.email || null,
                    name: claims.name || null,
                    picture: null,
                    verified: claims.email_verified !== false
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
                        const emailResponse = await axios.get(client.emailUrl, {
                            headers: { Authorization: `Bearer ${accessToken}` }
                        });
                        const primaryEmail = emailResponse.data.find(
                            e => e.primary && e.verified
                        );
                        email = primaryEmail ? primaryEmail.email : null;
                    } catch (error) {
                        logger.warn(
                            `Failed to fetch GitHub emails: ${error.response?.status} ${error.message}`
                        );
                    }
                }
                return {
                    id: userData.id.toString(),
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
                    picture: userData.avatar
                        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
                        : null,
                    verified: userData.verified || false
                };

            case 'facebook': {
                // userData expected to already have fields=id,name,email,picture
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

            case 'slack': {
                const user = userData.user || userData; // be tolerant
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    picture: user.image_192 || user.image_72 || user.image_24 || null,
                    verified: true
                };
            }

            case 'apple':
                // Apple userinfo should not normally be hit; handled by id_token
                return {
                    id: userData.sub,
                    email: userData.email || null,
                    name: userData.name || null,
                    picture: null,
                    verified: userData.email_verified !== false
                };

            case 'twitter':
                return {
                    id: userData.data.id,
                    email: null, // OAuth2 /2 APIs do not surface email
                    name: userData.data.name,
                    picture: userData.data.profile_image_url,
                    verified: userData.data.verified || false
                };

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

            case 'authcore':
                return {
                    id: userData.sub,
                    email: userData.email,
                    name: userData.name || `${userData.given_name || ''} ${userData.family_name || ''}`.trim(),
                    picture: userData.picture || null,
                    verified: userData.email_verified || false
                };

            default:
                return userData;
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
                if (!this.allowedClients.includes(provider)) {
                    logger.warn(
                        `Intialization of provider ${provider} has been disabled in this release as it has not been fully tested. You may manually override this by setting explicit allow in the config object for the specific provider.`
                    );
                }

                const initialized = await this.initializeProvider(provider);
                if (initialized !== false) return provider;
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
