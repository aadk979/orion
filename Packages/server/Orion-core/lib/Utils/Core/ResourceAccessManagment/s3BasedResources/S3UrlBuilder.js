import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_EXPIRES_SECONDS = 900;
const MIN_EXPIRES_SECONDS = 1;
const MAX_EXPIRES_SECONDS = 604800; // 7 days — the AWS presigned-URL ceiling

const PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

const resolveDotPath = (source, dotPath) => {
    return dotPath.split('.').reduce((value, segment) => (value === null || value === undefined ? undefined : value[segment]), source);
};

/**
 * Fluent builder for S3 object URLs — plain (public objects) or SigV4 query-presigned.
 * Signing is delegated to the official AWS SDK v3 (`@aws-sdk/s3-request-presigner`);
 * this class only handles ergonomics: key templating, addressing style, and the
 * response-override / expiry surface. Works against AWS S3 and S3-compatible stores
 * (R2, MinIO, localstack) via endpoint(). Keys support {dot.path} placeholders resolved
 * from context(tokenData, customData); literal '{' / '}' in keys are not supported.
 */
class S3UrlBuilder {
    constructor() {
        this._bucket = null;
        this._region = DEFAULT_REGION;
        this._key = null;
        this._context = null;
        this._endpoint = null; // raw string as supplied
        this._addressingStyle = null; // 'virtual' | 'path' | null (resolved per endpoint at build time)
        this._credentials = null;
        this._expiresIn = DEFAULT_EXPIRES_SECONDS;
        this._method = 'GET';
        this._commandInput = {}; // extra typed GetObject/PutObject fields, signed by the SDK
        this._signingDate = null;
    }

    bucket(name) {
        this._bucket = name;
        return this;
    }

    region(value) {
        this._region = value;
        return this;
    }

    key(keyOrTemplate) {
        this._key = keyOrTemplate;
        return this;
    }

    context(tokenData = {}, customData = {}) {
        this._context = { ...tokenData, customData };
        return this;
    }

    endpoint(url) {
        const parsed = new URL(url); // validates; throws on a malformed endpoint
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error('S3UrlBuilder: endpoint must be an http(s) URL');
        }
        this._endpoint = url;
        return this;
    }

    virtualHosted() {
        this._addressingStyle = 'virtual';
        return this;
    }

    pathStyle() {
        this._addressingStyle = 'path';
        return this;
    }

    credentials({ accessKeyId, secretAccessKey, sessionToken } = {}) {
        this._credentials = { accessKeyId, secretAccessKey, sessionToken };
        return this;
    }

    expiresIn(seconds) {
        this._expiresIn = seconds;
        return this;
    }

    method(verb) {
        this._method = String(verb).toUpperCase();
        return this;
    }

    // Merge arbitrary typed AWS command fields (e.g. VersionId, Range). These are
    // signed by the SDK, so unlike raw query params they never break the signature.
    commandInput(fields) {
        Object.assign(this._commandInput, fields);
        return this;
    }

    responseContentDisposition(value) {
        this._commandInput.ResponseContentDisposition = value;
        return this;
    }

    responseContentType(value) {
        this._commandInput.ResponseContentType = value;
        return this;
    }

    responseCacheControl(value) {
        this._commandInput.ResponseCacheControl = value;
        return this;
    }

    versionId(value) {
        this._commandInput.VersionId = value;
        return this;
    }

    signingDate(date) {
        this._signingDate = date;
        return this;
    }

    _resolveKey() {
        if (typeof this._key !== 'string' || !this._key.trim()) {
            throw new Error('S3UrlBuilder: a non-empty key is required');
        }

        const context = this._context || {};

        const resolved = this._key.replace(PLACEHOLDER_PATTERN, (match, dotPath) => {
            const value = resolveDotPath(context, dotPath.trim());
            if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
                throw new Error(`S3UrlBuilder: unresolved key placeholder "${match}"`);
            }
            return String(value);
        });

        return resolved.replace(/^\/+/, '');
    }

    _resolveStyle() {
        // AWS default is virtual-hosted; custom endpoints default to path-style (MinIO/R2 convention).
        return this._addressingStyle || (this._endpoint ? 'path' : 'virtual');
    }

    _makeClient() {
        const config = {
            region: this._region,
            forcePathStyle: this._resolveStyle() === 'path'
        };

        if (this._credentials?.accessKeyId) {
            config.credentials = {
                accessKeyId: this._credentials.accessKeyId,
                secretAccessKey: this._credentials.secretAccessKey,
                sessionToken: this._credentials.sessionToken
            };
        }

        if (this._endpoint) {
            config.endpoint = this._endpoint;
        }

        return new S3Client(config);
    }

    // Unsigned URL for public objects / CDN. No credentials or signing involved.
    build() {
        if (typeof this._bucket !== 'string' || !this._bucket.trim()) {
            throw new Error('S3UrlBuilder: a non-empty bucket is required');
        }

        const bucket = this._bucket.trim();
        const key = this._resolveKey();
        const encodedKey = key.split('/').map(encodeURIComponent).join('/');
        const style = this._resolveStyle();

        if (!this._endpoint) {
            if (style === 'virtual') {
                return `https://${bucket}.s3.${this._region}.amazonaws.com/${encodedKey}`;
            }
            return `https://s3.${this._region}.amazonaws.com/${bucket}/${encodedKey}`;
        }

        const endpoint = new URL(this._endpoint);
        const scheme = endpoint.protocol.replace(':', '');
        const basePath = endpoint.pathname.replace(/\/+$/, '');

        if (style === 'virtual') {
            return `${scheme}://${bucket}.${endpoint.host}${basePath}/${encodedKey}`;
        }
        return `${scheme}://${endpoint.host}${basePath}/${bucket}/${encodedKey}`;
    }

    async presign() {
        if (typeof this._bucket !== 'string' || !this._bucket.trim()) {
            throw new Error('S3UrlBuilder: a non-empty bucket is required');
        }

        const key = this._resolveKey();

        if (!this._credentials?.accessKeyId || !this._credentials?.secretAccessKey) {
            throw new Error('S3UrlBuilder: credentials({ accessKeyId, secretAccessKey }) are required to presign');
        }

        if (!Number.isInteger(this._expiresIn) || this._expiresIn < MIN_EXPIRES_SECONDS || this._expiresIn > MAX_EXPIRES_SECONDS) {
            throw new Error(`S3UrlBuilder: expiresIn must be an integer between ${MIN_EXPIRES_SECONDS} and ${MAX_EXPIRES_SECONDS}`);
        }

        const signingDate = this._signingDate || new Date();
        const client = this._makeClient();

        const input = { Bucket: this._bucket.trim(), Key: key, ...this._commandInput };
        const command = this._method === 'PUT' ? new PutObjectCommand(input) : new GetObjectCommand(input);

        const url = await getSignedUrl(client, command, { expiresIn: this._expiresIn, signingDate });

        return { url, expiresAt: Math.floor(signingDate.getTime() / 1000) + this._expiresIn };
    }
}

const presignS3Url = async (options = {}) => {
    const builder = new S3UrlBuilder();

    if (options.bucket) builder.bucket(options.bucket);
    if (options.region) builder.region(options.region);
    if (options.key) builder.key(options.key);
    if (options.tokenData || options.customData) builder.context(options.tokenData, options.customData);
    if (options.endpoint) builder.endpoint(options.endpoint);
    if (options.addressingStyle === 'virtual') builder.virtualHosted();
    if (options.addressingStyle === 'path') builder.pathStyle();
    if (options.credentials) builder.credentials(options.credentials);
    if (options.expiresIn !== undefined) builder.expiresIn(options.expiresIn);
    if (options.method) builder.method(options.method);
    if (options.commandInput) builder.commandInput(options.commandInput);
    if (options.responseContentDisposition) builder.responseContentDisposition(options.responseContentDisposition);
    if (options.responseContentType) builder.responseContentType(options.responseContentType);
    if (options.responseCacheControl) builder.responseCacheControl(options.responseCacheControl);
    if (options.versionId) builder.versionId(options.versionId);
    if (options.signingDate) builder.signingDate(options.signingDate);

    return builder.presign();
};

export { S3UrlBuilder, presignS3Url };
