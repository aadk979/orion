import axios from 'axios';
import https from 'https';
import jwt from 'jsonwebtoken'; // or jose; adjust as needed
import jwkToPem from 'jwk-to-pem'; // or use jose JWK utilities
import { logger } from '../../logger.js';

// Shared HTTP client: bounded timeouts + keep-alive so provider calls
// cannot hang a worker indefinitely and TLS handshakes are reused.
const HTTP_TIMEOUT_MS = 10 * 1000;
const httpClient = axios.create({
    timeout: HTTP_TIMEOUT_MS,
    httpsAgent: new https.Agent({ keepAlive: true })
});

const MS_MULTITENANT_ISSUER = 'https://login.microsoftonline.com/{tenantid}/v2.0';
const MS_ISSUER_PATTERN = /^https:\/\/login\.microsoftonline\.com\/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\/v2\.0$/;

// Fallback allowlist for config-defined providers that do not pin their own algs
const DEFAULT_ID_TOKEN_ALGS = ['RS256', 'ES256'];

/**
 * Utility: fetch and cache JWKS per issuer
 * - Coalesces concurrent fetches (no thundering herd on cold/expired cache)
 * - Refetches once on kid miss (key rotation) with a cooldown
 * - Caches the jwk->PEM conversion per kid
 */
class JwksCache {
    constructor() {
        this.cache = new Map(); // issuer -> { keys, pems: Map(kid -> pem), fetchedAt }
        this.inFlight = new Map(); // issuer -> Promise<keys>
        this.ttlMs = 10 * 60 * 1000; // 10 minutes
        this.refetchCooldownMs = 30 * 1000; // min gap between rotation-triggered refetches
    }

    async fetchKeys(jwksUri, issuer) {
        const pending = this.inFlight.get(issuer);
        if (pending) {
            return pending;
        }

        const promise = (async () => {
            const res = await httpClient.get(jwksUri);
            const keys = Array.isArray(res.data?.keys) ? res.data.keys : [];
            this.cache.set(issuer, { keys, pems: new Map(), fetchedAt: Date.now() });
            return keys;
        })().finally(() => this.inFlight.delete(issuer));

        this.inFlight.set(issuer, promise);
        return promise;
    }

    async getKeys(jwksUri, issuer) {
        const cached = this.cache.get(issuer);
        if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
            return cached.keys;
        }
        return this.fetchKeys(jwksUri, issuer);
    }

    selectKey(keys, kid) {
        const signingKeys = keys.filter(k => k.use !== 'enc');
        if (kid) {
            return signingKeys.find(k => k.kid === kid) || null;
        }
        // Without a kid we can only proceed safely when there is exactly one candidate
        return signingKeys.length === 1 ? signingKeys[0] : null;
    }

    async getKey(jwksUri, issuer, kid) {
        let keys = await this.getKeys(jwksUri, issuer);
        let jwk = this.selectKey(keys, kid);

        // kid miss usually means the provider rotated keys; force one refetch,
        // rate-limited so bad tokens cannot hammer the JWKS endpoint
        if (!jwk) {
            const cached = this.cache.get(issuer);
            if (!cached || Date.now() - cached.fetchedAt > this.refetchCooldownMs) {
                keys = await this.fetchKeys(jwksUri, issuer);
                jwk = this.selectKey(keys, kid);
            }
        }

        if (!jwk) {
            throw new Error(`No matching JWK for issuer ${issuer} kid=${kid || 'none'}`);
        }

        const entry = this.cache.get(issuer);
        const pemKey = jwk.kid || '__default__';
        let pem = entry?.pems.get(pemKey);
        if (!pem) {
            pem = jwkToPem(jwk);
            entry?.pems.set(pemKey, pem);
        }
        return pem;
    }
}

const jwksCache = new JwksCache();

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
                idTokenAlgs: ['RS256'],
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
                issuer: MS_MULTITENANT_ISSUER, // tenant issuer is validated against MS_ISSUER_PATTERN
                idTokenAlgs: ['RS256'],
                scope: 'openid email profile User.Read',
                requiresPKCE: true
            },
            facebook: {
                // Update to a currently supported version; your app can override via config
                authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
                tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
                // Facebook only returns id+name by default; fields must be requested explicitly
                userInfoUrl: 'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.width(256)',
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
                idTokenAlgs: ['RS256'],
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
                idTokenAlgs: ['RS256'],
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
     * Build provider metadata entirely from config.
     * Used for providers without built-in metadata (e.g. authcore / custom OIDC).
     */
    buildProviderFromConfig(config) {
        if (!config.authUrl || !config.tokenUrl || (!config.userInfoUrl && !config.jwksUri)) {
            return null;
        }
        return {
            authUrl: config.authUrl,
            tokenUrl: config.tokenUrl,
            userInfoUrl: config.userInfoUrl || null,
            ...(config.jwksUri && { jwksUri: config.jwksUri }),
            ...(config.issuer && { issuer: config.issuer }),
            idTokenAlgs: config.idTokenAlgs || DEFAULT_ID_TOKEN_ALGS,
            scope: config.scope || 'openid email profile',
            requiresPKCE: config.requiresPKCE !== false
        };
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

        const provider = this.providers[providerName] || this.buildProviderFromConfig(config);
        if (!provider) {
            logger.error(
                `Provider ${providerName} is not supported and no complete endpoint configuration (authUrl, tokenUrl, userInfoUrl/jwksUri) was supplied`
            );
            return { error: true, errorCode: 'OAUTH::UNSUPPORTED-PROVIDER::A::p' };
        }
        if (!config.clientId || !config.clientSecret || !config.redirectUri) {
            logger.error(`Provider ${providerName} has incomplete configuration`);
            return { error: true, errorCode: 'OAUTH::INVALID-PROVIDER-CONFIG::A::i' };
        }

        this.clients[providerName] = {
            ...provider,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            redirectUri: config.redirectUri,
            // Optional overrides: jwksUri, issuer, scope, etc.
            ...(config.jwksUri && { jwksUri: config.jwksUri }),
            ...(config.issuer && { issuer: config.issuer }),
            ...(config.scope && { scope: config.scope }),
            ...(config.idTokenAlgs && { idTokenAlgs: config.idTokenAlgs })
        };

        logger.info(`Initialized OAuth provider: ${providerName}`);
        return true;
    }

    /**
     * Generate authorization URL for any provider
     * PKCE values (and OIDC nonce) are provided by the caller to keep the outward API compatible.
     */
    generateAuthUrl(providerName, state = null, pkce = {}) {
        const client = this.clients[providerName];
        if (!client) {
            return { error: true, errorCode: 'OAUTH::PROVIDER-NOT-INITIALIZED::A::i' };
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
            params.set('response_type', 'code id_token');
        }

        // PKCE support: caller passes code_challenge and method
        if (client.requiresPKCE && pkce.codeChallenge && pkce.codeChallengeMethod) {
            params.append('code_challenge', pkce.codeChallenge);
            params.append('code_challenge_method', pkce.codeChallengeMethod);
        }

        // OIDC nonce: binds the eventual id_token to this authorization request
        if (pkce.nonce && client.jwksUri) {
            params.append('nonce', pkce.nonce);
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
            return { error: true, errorCode: 'OAUTH::PROVIDER-NOT-INITIALIZED::A::i' };
        }

        const tokenResponse = await this.exchangeCodeForToken(providerName, client, code, pkce);
        if (tokenResponse?.error) {
            return tokenResponse;
        }

        const accessToken =
            client.specialHandling === 'slack'
                ? tokenResponse.authed_user?.access_token
                : tokenResponse.access_token;

        // Prefer id_token from tokenResponse, but allow external submission (Apple)
        const rawIdToken = tokenResponse.id_token || idTokenFromCallback || null;

        let normalizedUser = null;

        if (rawIdToken && client.jwksUri) {
            try {
                const verified = await this.verifyIdToken(providerName, client, rawIdToken, pkce);
                normalizedUser = this.normalizeFromIdToken(providerName, verified);
            } catch (e) {
                logger.error(`Failed to verify id_token for ${providerName}: ${e.message}`);
                // fallback to userinfo below (when the provider has a userinfo endpoint)
            }
        }

        if (!normalizedUser) {
            // Providers without a userinfo endpoint (e.g. Apple) have no fallback:
            // if the id_token could not be verified, the identity cannot be trusted.
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
            normalizedUser = await this.normalizeUserInfo(
                providerName,
                userInfoResponse.raw,
                accessToken,
                client
            );
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
            const response = await httpClient.post(client.tokenUrl, params.toString(), { headers });
            const data = response.data;

            // Some providers (GitHub, Slack) report failures with HTTP 200 + error body
            if (data?.error || (client.specialHandling === 'slack' && data?.ok === false)) {
                logger.error(
                    `Token exchange rejected for ${providerName}: ${data.error || data.error_description || 'ok=false'}`
                );
                return { error: true, errorCode: 'OAUTH::TOKEN-EXCHANGE-FAILED::A::i' };
            }

            return data;
        } catch (error) {
            logger.error(
                `Token exchange failed for ${providerName}: ${error.response?.status} ${error.message}`
            );
            return { error: true, errorCode: 'OAUTH::TOKEN-EXCHANGE-FAILED::A::i' };
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
            const userResponse = await httpClient.get(client.userInfoUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    ...(providerName === 'reddit' && { 'User-Agent': 'Orion-OAuth/1.0' })
                }
            });

            // Slack reports failures with HTTP 200 + ok:false
            if (client.specialHandling === 'slack' && userResponse.data?.ok === false) {
                logger.error(`UserInfo fetch rejected for ${providerName}: ${userResponse.data.error}`);
                return { error: true, errorCode: 'OAUTH::USERINFO-FETCH-FAILED::A::i' };
            }

            return { raw: userResponse.data };
        } catch (error) {
            logger.error(
                `UserInfo fetch failed for ${providerName}: ${error.response?.status} ${error.message}`
            );
            return { error: true, errorCode: 'OAUTH::USERINFO-FETCH-FAILED::A::i' };
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

        // Enforce a per-provider algorithm allowlist rather than trusting the token header
        const allowedAlgs = client.idTokenAlgs || DEFAULT_ID_TOKEN_ALGS;
        if (!alg || !allowedAlgs.includes(alg)) {
            throw new Error(`Disallowed JWS alg: ${alg}`);
        }

        const issuer = client.issuer;
        if (!issuer || !client.jwksUri) {
            throw new Error('Missing issuer or jwksUri for provider');
        }

        // Hybrid-flow id_tokens (Apple form_post) rely on nonce for replay protection
        if (client.specialHandling === 'apple' && !pkce.nonce) {
            throw new Error('Missing nonce for Apple id_token verification');
        }

        const publicKey = await jwksCache.getKey(client.jwksUri, issuer, kid);

        const isMsMultiTenant = issuer === MS_MULTITENANT_ISSUER;

        const options = {
            algorithms: allowedAlgs,
            issuer: isMsMultiTenant
                ? undefined // multi-tenant issuer is validated manually below
                : issuer,
            audience: client.clientId,
            ...(pkce.nonce && { nonce: pkce.nonce })
        };

        const payload = jwt.verify(idToken, publicKey, options);

        // For MS multi-tenant the issuer must still be a real Microsoft tenant issuer.
        // Pin a single tenant by overriding `issuer` in the provider config.
        if (isMsMultiTenant && !MS_ISSUER_PATTERN.test(payload.iss || '')) {
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
                        const emailResponse = await httpClient.get(client.emailUrl, {
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
                    picture: userData.avatar
                        ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
                        : null,
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

            case 'authcore':
                return {
                    id: userData.sub,
                    email: userData.email,
                    name: userData.name || `${userData.given_name || ''} ${userData.family_name || ''}`.trim(),
                    picture: userData.picture || null,
                    verified: userData.email_verified || false
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
