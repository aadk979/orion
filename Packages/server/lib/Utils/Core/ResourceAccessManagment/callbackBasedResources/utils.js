const normalizeUrl = (url = "") => {
    let normalized = url.trim();
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
        normalized = "https://" + normalized;
    }
    return normalized;
};

const resourceUriBuilder = (url, token = "NONE", accessType = "public", path = "NONE") => {
    const safeAccessType = encodeURIComponent(accessType.trim());
    const safePath = encodeURIComponent(path.trim());
    const safeToken = encodeURIComponent(token.trim());
    return `${normalizeUrl(url)}/resource-access-oras?accessType=${safeAccessType}&path=${safePath}&token=${safeToken}`;
};

export { resourceUriBuilder };  