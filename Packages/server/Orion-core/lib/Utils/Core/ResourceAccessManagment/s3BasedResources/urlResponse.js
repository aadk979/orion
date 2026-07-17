// Delivers an S3-0 resource as a JSON envelope carrying the URL instead of the bytes.
// Returns an error sentinel instead of writing on failure so the caller can route the
// registered RAS-S3::* error through respondWithError.
const respondWithResourceUrl = (response, callbackResult) => {
    const url = callbackResult?.url;

    if (typeof url !== 'string' || !url.trim()) {
        return { error: true, errorCode: 'RAS-S3::INVALID-URL::A::i' };
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        return { error: true, errorCode: 'RAS-S3::INVALID-URL::A::i' };
    }

    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return { error: true, errorCode: 'RAS-S3::INVALID-URL::A::i' };
    }

    response.setHeader('orion-response-status', 200);
    // A presigned URL is a bearer credential — never cache the envelope.
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({
        error: false,
        data: {
            delivery: 'S3-URL',
            url,
            expiresAt: Number.isFinite(callbackResult?.expiresAt) ? callbackResult.expiresAt : null
        }
    });

    return { error: false };
};

export { respondWithResourceUrl };
