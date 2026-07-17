// S3-0 callbacks must return { url, expiresAt? } instead of { base64File, mimeType }
const SUPPORTED_TOKENS = [{ tokenType: 'PUBLIC' }, { tokenType: 'SECURE-0' }, { tokenType: 'S3-0' }];

export { SUPPORTED_TOKENS };