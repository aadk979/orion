const normalizeUrl = (inputUrl = "") => {
    let urlStr = inputUrl.trim();
    if (!/^https?:\/\//i.test(urlStr)) {
        urlStr = "https://" + urlStr;
    }
    return urlStr;
};

const resourceUriBuilder = (baseUrl, token = "NONE", accessType = "public", path = "default", view = true) => {
    try {
        const normalizedBase = normalizeUrl(baseUrl);
        const url = new URL("/resource-access-oras", normalizedBase);
        
        url.searchParams.set("accessType", accessType.trim());
        url.searchParams.set("path", path.trim());
        url.searchParams.set("view", (view === true || view === false) ? (view === true ? "true" : "false") : "true")
        url.searchParams.set("token", token.trim());
        
        return url.toString();
    } catch (error) {
        return "";
    }
};

export { resourceUriBuilder };