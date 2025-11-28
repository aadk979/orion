/**
 * Multi-Provider OAuth Toolkit for Orion
 * 
 * Provides unified OAuth 2.0 authentication support for multiple providers:
 * Google, GitHub, Microsoft, Discord, Facebook, Amazon, Slack, Apple, Twitter/X,
 * LinkedIn, Reddit, and Spotify.
 * 
 * All providers utilise standard OAuth 2.0 flow for simplicity and consistency.
 */

import axios from 'axios';
import { logger } from '../../logger.js';

class OAuthProviderToolkit {
    constructor(config) {

        if (OAuthProviderToolkit.instance) {
            logger.error("There can only be one instance of OAuth provider tool kit!");
            return;
        }

        // This is an array of tested clients that are safe to be initilaized
        this.allowedClients = [ "google", "github", "discord", "slack", "microsoft" ]

        this.config = config;
        this.clients = {};
        this.providers = {
            google: {
                authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
                tokenUrl: 'https://oauth2.googleapis.com/token',
                userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
                scope: 'openid email profile'
            },
            github: {
                authUrl: 'https://github.com/login/oauth/authorize',
                tokenUrl: 'https://github.com/login/oauth/access_token',
                userInfoUrl: 'https://api.github.com/user',
                emailUrl: 'https://api.github.com/user/emails',
                scope: 'user:email'
            },
            discord: {
                authUrl: 'https://discord.com/api/oauth2/authorize',
                tokenUrl: 'https://discord.com/api/oauth2/token',
                userInfoUrl: 'https://discord.com/api/users/@me',
                scope: 'identify email'
            },
            slack: {
                authUrl: 'https://slack.com/oauth/v2/authorize',
                tokenUrl: 'https://slack.com/api/oauth.v2.access',
                userInfoUrl: 'https://slack.com/api/users.identity',
                scope: 'identity.basic,identity.email,identity.avatar',
                specialHandling: 'slack' // Uses user_scope instead of scope
            },
            microsoft: {
                authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
                tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
                userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
                scope: 'openid email profile User.Read'
            },
            facebook: {
                authUrl: 'https://www.facebook.com/v23.0/dialog/oauth',
                tokenUrl: 'https://graph.facebook.com/v23.0/oauth/access_token',
                userInfoUrl: 'https://graph.facebook.com/me',
                scope: 'email,public_profile'
            },
            amazon: {
                authUrl: 'https://www.amazon.com/ap/oa',
                tokenUrl: 'https://api.amazon.com/auth/o2/token',
                userInfoUrl: 'https://api.amazon.com/user/profile',
                scope: 'profile'
            },
            apple: {
                authUrl: 'https://appleid.apple.com/auth/authorize',
                tokenUrl: 'https://appleid.apple.com/auth/token',
                userInfoUrl: 'https://appleid.apple.com/auth/userinfo',
                scope: 'email name',
                specialHandling: 'apple' // Requires response_mode=form_post
            },
            twitter: {
                authUrl: 'https://twitter.com/i/oauth2/authorize',
                tokenUrl: 'https://api.twitter.com/2/oauth2/token',
                userInfoUrl: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,verified',
                scope: 'tweet.read users.read offline.access',
                requiresPKCE: true // Twitter requires PKCE
            },
            linkedin: {
                authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
                tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
                userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
                scope: 'openid profile email'
            },
            reddit: {
                authUrl: 'https://www.reddit.com/api/v1/authorize',
                tokenUrl: 'https://www.reddit.com/api/v1/access_token',
                userInfoUrl: 'https://oauth.reddit.com/api/v1/me',
                scope: 'identity',
                requiresBasicAuth: true // Reddit requires Basic Auth for token exchange
            },
            spotify: {
                authUrl: 'https://accounts.spotify.com/authorize',
                tokenUrl: 'https://accounts.spotify.com/api/token',
                userInfoUrl: 'https://api.spotify.com/v1/me',
                scope: 'user-read-email user-read-private'
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

        if (!config) return false; // skip silently if not configured
        if (!provider) {
            logger.error(`Provider ${providerName} is not supported`);
            return { error: true, errorCode: "O-AUTH-UNSUPPORTED-PROVIDER" };
        }
        if (!config.clientId || !config.clientSecret || !config.redirectUri) {
            logger.error(`Provider ${providerName} has incomplete configuration`);
            return { error: true, errorCode: "O-AUTH-INVALID-PROVIDER-CONFIG" };
        }

        this.clients[providerName] = {
            ...provider,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            redirectUri: config.redirectUri
        };

        logger.info(`Initialized OAuth provider: ${providerName}`);

        return true;
    }

    /**
     * Generate authorization URL for any provider
     */
    generateAuthUrl(providerName, state = null) {
        const client = this.clients[providerName];
        if (!client) {
            return { error: true, errorCode: "O-AUTH-PROVIDER-NOT-INITIALIZED" };
        }

        const params = new URLSearchParams({
            client_id: client.clientId,
            redirect_uri: client.redirectUri,
            response_type: 'code',
            scope: client.scope,
            ...(state && { state })
        });

        // Handle provider-specific parameters
        if (client.specialHandling === 'slack') {
            params.delete('scope');
            params.append('user_scope', client.scope);
        }

        if (client.specialHandling === 'apple') {
            params.append('response_mode', 'form_post');
        }

        // Providers requiring PKCE should supply code_challenge via outer flow

        return { error: false, redirectURL: `${client.authUrl}?${params.toString()}` };
    }

    /**
     * Handle callback and get user information
     */
    async handleCallback(providerName, code, state = null) {
        const client = this.clients[providerName];
        if (!client) {
            return { error: true, errorCode: "O-AUTH-PROVIDER-NOT-INITIALIZED" };
        }

        const tokenResponse = await this.exchangeCodeForToken(providerName, client, code);
        if (tokenResponse?.error) {
            return tokenResponse;
        }
        const accessToken = providerName !== "slack" ? tokenResponse.access_token : tokenResponse.authed_user.access_token;

        const userInfoResponse = await this.getUserInfo(providerName, client, accessToken);
        if (userInfoResponse?.error) {
            return userInfoResponse;
        }

        return {
            error: false,
            ...userInfoResponse,
            accessToken,
            refreshToken: tokenResponse.refresh_token || null
        };
    }

    /**
     * Exchange authorization code for access token
     */
    async exchangeCodeForToken(providerName, client, code) {
        const params = new URLSearchParams({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            code,
            redirect_uri: client.redirectUri,
            grant_type: 'authorization_code'
        });

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        };

        // Reddit requires Basic Authentication
        if (client.requiresBasicAuth) {
            const credentials = Buffer.from(`${client.clientId}:${client.clientSecret}`).toString('base64');
            headers['Authorization'] = `Basic ${credentials}`;
            params.delete('client_id');
            params.delete('client_secret');
        }   
          

        try {
            const response = await axios.post(client.tokenUrl, params.toString(), { headers });
            return response.data;
        } catch (error) {
            return { error: true, errorCode: "O-AUTH-TOKEN-EXCHANGE-FAILED" };
        }
    }

    /**
     * Get user information from provider
     */
    async getUserInfo(providerName, client, accessToken) {
        try {
            const userResponse = await axios.get(client.userInfoUrl, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    // Reddit requires custom User-Agent
                    ...(providerName === 'reddit' && { 'User-Agent': 'Orion-OAuth/1.0' })
                }
            });
            return await this.normalizeUserInfo(providerName, userResponse.data, accessToken, client);
        } catch (error) {
            return { error: true, errorCode: "O-AUTH-USERINFO-FAILED" };
        }
    }

    /**
     * Normalize user information across different providers
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
                        const primaryEmail = emailResponse.data.find(e => e.primary && e.verified);
                        email = primaryEmail ? primaryEmail.email : null;
                    } catch (error) {
                        // Silent failure, email may remain null
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
                try {
                    const fbResponse = await axios.get(
                        `${client.userInfoUrl}?fields=id,name,email,picture`, 
                        { headers: { Authorization: `Bearer ${accessToken}` } }
                    );
                    return {
                        id: fbResponse.data.id,
                        email: fbResponse.data.email,
                        name: fbResponse.data.name,
                        picture: fbResponse.data.picture?.data?.url || null,
                        verified: true
                    };
                } catch (error) {
                    return {
                        id: userData.id,
                        email: userData.email || null,
                        name: userData.name,
                        picture: null,
                        verified: true
                    };
                }
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
                const user = userData.user;
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    picture: user.image_192 || user.image_72 || user.image_24,
                    verified: true
                };
            }

            case 'apple':
                return {
                    id: userData.sub,
                    email: userData.email,
                    name: userData.name || null,
                    picture: null,
                    verified: userData.email_verified !== false
                };

            case 'twitter':
                return {
                    id: userData.data.id,
                    email: userData.data.email || null,
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
                    email: null, // Reddit doesn't provide email
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

        const promises = configuredProviders.map(async (provider) => {
            try {

                if (!this.allowedClients.includes(provider)) {
                    logger.warn(`Intialization of provider ${provider} has been disabled in this release as it has not been fully tested. You may manually override this by setting explicit allow in the config object for the specific provider.`)
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

        // No logging here; propagate results to caller if needed
    }

    /**
     * Get list of available/initialized providers
     */
    getAvailableProviders() {
        return Object.keys(this.clients);
    }

    /**
     * Check if a specific provider is available
     */
    isProviderAvailable(providerName) {
        return !!this.clients[providerName];
    }
}

export { OAuthProviderToolkit };