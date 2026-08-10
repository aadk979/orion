/**
 * cloudAuth — request signing and token acquisition for the three hyperscaler
 * key vaults, implemented against the published wire protocols so that a
 * deployment which does NOT install the vendor SDK still works.
 *
 * Every cloud provider in this package follows the same pattern:
 *
 *   1. try to `import()` the vendor SDK — if present, the SDK owns credential
 *      resolution, retries and signing (the well-trodden path);
 *   2. otherwise fall back to the built-in signer here, which speaks the same
 *      REST API using only node:crypto and fetch.
 *
 * Nothing in this file is Orion-specific; it is deliberately a thin, testable
 * transcription of AWS SigV4, the GCP service-account JWT grant, and the Azure
 * client-credentials/IMDS flows.
 */

import crypto from 'crypto';
import { KeyVaultError, vaultFetch } from './KeyVaultProvider.js';

const METADATA_TIMEOUT_MS = 2_000;

// ─── AWS: SigV4 ──────────────────────────────────────────────────────────────

const sha256Hex = payload => crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * Signature Version 4 for a JSON POST to a regional AWS endpoint.
 * Returns the headers to send (Authorization included).
 */
const signAwsRequest = ({ region, service, host, path = '/', body, headers = {}, credentials }) => {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20260727T120000Z
    const dateStamp = amzDate.slice(0, 8);

    const baseHeaders = {
        host,
        'x-amz-date': amzDate,
        ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}),
        ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
    };

    const sortedNames = Object.keys(baseHeaders).sort();
    const canonicalHeaders = sortedNames.map(name => `${name}:${String(baseHeaders[name]).trim()}\n`).join('');
    const signedHeaders = sortedNames.join(';');
    const payloadHash = sha256Hex(body);

    const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

    const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), region), service), 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

    return {
        ...baseHeaders,
        Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    };
};

/**
 * Credential resolution, in the same precedence the AWS SDKs use:
 * explicit config → environment → ECS/EKS task role → EC2 instance role.
 *
 * Container and instance credentials are cached until shortly before they
 * expire; static ones never expire.
 */
const createAwsCredentialProvider = (config = {}) => {
    let cached = null;
    let cachedUntil = 0;

    const fromStatic = () => {
        if (config.accessKeyId && config.secretAccessKey) {
            return { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, sessionToken: config.sessionToken || null };
        }
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            return {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
                sessionToken: process.env.AWS_SESSION_TOKEN || null
            };
        }
        return null;
    };

    const fromContainer = async () => {
        const relative = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
        const full = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
        if (!relative && !full) return null;

        const url = relative ? `http://169.254.170.2${relative}` : full;
        const headers = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN ? { Authorization: process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN } : {};

        const data = await vaultFetch(url, { method: 'GET', headers, timeoutMs: METADATA_TIMEOUT_MS, provider: 'AWS_KMS' });

        return {
            accessKeyId: data.AccessKeyId,
            secretAccessKey: data.SecretAccessKey,
            sessionToken: data.Token || null,
            expiresAt: data.Expiration ? Date.parse(data.Expiration) : 0
        };
    };

    const fromInstance = async () => {
        // IMDSv2: session token first, then the role name, then the credentials.
        const token = await vaultFetch('http://169.254.169.254/latest/api/token', {
            method: 'PUT',
            headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '300' },
            timeoutMs: METADATA_TIMEOUT_MS,
            provider: 'AWS_KMS',
            raw: true
        });

        const metaHeaders = { 'x-aws-ec2-metadata-token': String(token).trim() };
        const roleName = await vaultFetch('http://169.254.169.254/latest/meta-data/iam/security-credentials/', {
            method: 'GET',
            headers: metaHeaders,
            timeoutMs: METADATA_TIMEOUT_MS,
            provider: 'AWS_KMS',
            raw: true
        });

        const data = await vaultFetch(`http://169.254.169.254/latest/meta-data/iam/security-credentials/${String(roleName).trim().split('\n')[0]}`, {
            method: 'GET',
            headers: metaHeaders,
            timeoutMs: METADATA_TIMEOUT_MS,
            provider: 'AWS_KMS'
        });

        return {
            accessKeyId: data.AccessKeyId,
            secretAccessKey: data.SecretAccessKey,
            sessionToken: data.Token || null,
            expiresAt: data.Expiration ? Date.parse(data.Expiration) : 0
        };
    };

    return async () => {
        const staticCreds = fromStatic();
        if (staticCreds) return staticCreds;

        if (cached && Date.now() < cachedUntil) return cached;

        let resolved = null;
        const failures = [];

        for (const source of [fromContainer, fromInstance]) {
            try {
                resolved = await source();
                if (resolved?.accessKeyId) break;
                resolved = null;
            } catch (error) {
                failures.push(error.message);
            }
        }

        if (!resolved?.accessKeyId) {
            throw new KeyVaultError(
                'KEYVAULT::AWS-NO-CREDENTIALS',
                'AWS KMS: no credentials found. Set utilities.dataEncryption.accessKeyId/secretAccessKey, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, ' +
                    `or run on an instance/task with an attached role.${failures.length ? ` (role lookup: ${failures.join('; ')})` : ''}`,
                { provider: 'AWS_KMS' }
            );
        }

        cached = resolved;
        // Refresh a minute before expiry; unexpiring responses get 5 minutes.
        cachedUntil = resolved.expiresAt ? resolved.expiresAt - 60_000 : Date.now() + 300_000;

        return cached;
    };
};

// ─── GCP: service-account JWT grant / metadata server ────────────────────────

const GCP_KMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';

/**
 * Exchanges a service-account key for an access token using the JWT bearer
 * grant (RFC 7523), or reads one from the GCE metadata server when running
 * with an attached service account.
 *
 * @returns {() => Promise<{ token, expiresInSeconds }>} refresh function for a TokenCache
 */
const createGcpTokenRefresher = (config = {}) => {
    const credentials =
        config.credentials ||
        (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ? JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) : null);

    if (!credentials) {
        // Metadata server (GKE Workload Identity / GCE service account).
        return async () => {
            const data = await vaultFetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
                method: 'GET',
                headers: { 'Metadata-Flavor': 'Google' },
                timeoutMs: METADATA_TIMEOUT_MS,
                provider: 'GCP_KMS'
            });
            return { token: data.access_token, expiresInSeconds: data.expires_in };
        };
    }

    if (!credentials.client_email || !credentials.private_key) {
        throw new KeyVaultError('KEYVAULT::INVALID-CONFIG', 'GCP KMS: credentials must be a service-account key containing client_email and private_key', {
            provider: 'GCP_KMS'
        });
    }

    const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token';

    return async () => {
        const issuedAt = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
        const claims = Buffer.from(
            JSON.stringify({ iss: credentials.client_email, scope: GCP_KMS_SCOPE, aud: tokenUri, exp: issuedAt + 3600, iat: issuedAt })
        ).toString('base64url');

        const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), credentials.private_key).toString('base64url');

        const data = await vaultFetch(tokenUri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }).toString(),
            provider: 'GCP_KMS'
        });

        return { token: data.access_token, expiresInSeconds: data.expires_in };
    };
};

// ─── Azure: client credentials / managed identity ────────────────────────────

const AZURE_VAULT_SCOPE = 'https://vault.azure.net/.default';
const AZURE_VAULT_RESOURCE = 'https://vault.azure.net';

const createAzureTokenRefresher = (config = {}) => {
    const tenantId = config.tenantId || process.env.AZURE_TENANT_ID;
    const clientId = config.clientId || process.env.AZURE_CLIENT_ID;
    const clientSecret = config.clientSecret || process.env.AZURE_CLIENT_SECRET;

    if (tenantId && clientId && clientSecret) {
        return async () => {
            const data = await vaultFetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: AZURE_VAULT_SCOPE }).toString(),
                provider: 'AZURE_KEY_VAULT'
            });
            return { token: data.access_token, expiresInSeconds: data.expires_in };
        };
    }

    // Managed identity via IMDS. `clientId` narrows to a user-assigned identity.
    return async () => {
        const query = new URLSearchParams({ 'api-version': '2018-02-01', resource: AZURE_VAULT_RESOURCE, ...(clientId ? { client_id: clientId } : {}) });

        const data = await vaultFetch(`http://169.254.169.254/metadata/identity/oauth2/token?${query.toString()}`, {
            method: 'GET',
            headers: { Metadata: 'true' },
            timeoutMs: METADATA_TIMEOUT_MS,
            provider: 'AZURE_KEY_VAULT'
        });

        return { token: data.access_token, expiresInSeconds: Number(data.expires_in) || 3600 };
    };
};

// ─── Optional SDK loading ────────────────────────────────────────────────────

/**
 * Loads a vendor SDK if the deployment installed it. A missing SDK is NOT an
 * error — it selects the built-in REST path. Anything else (a broken install,
 * a version whose entry point throws) is surfaced, because silently falling
 * back would hide a real problem.
 */
const loadOptionalSdk = async moduleName => {
    try {
        return await import(moduleName);
    } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') return null;
        throw new KeyVaultError('KEYVAULT::SDK-LOAD-FAILED', `Failed to load the installed "${moduleName}" package: ${error.message}`, { cause: error });
    }
};

export { signAwsRequest, createAwsCredentialProvider, createGcpTokenRefresher, createAzureTokenRefresher, loadOptionalSdk, GCP_KMS_SCOPE, AZURE_VAULT_RESOURCE };
