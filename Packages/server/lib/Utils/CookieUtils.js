export const stringifyCookieData = (data) => {
    if (typeof data === 'string') {
        return data;
    }
    return JSON.stringify(data);
};

export const parseCookieData = (cookieValue) => {
    if (typeof cookieValue !== 'string') {
        return cookieValue;
    }
    
    try {
        return JSON.parse(cookieValue);
    } catch (error) {
        // If JSON.parse fails, return the original string
        return cookieValue;
    }
};

export const setCookie = (response, key, data, options = {}) => {
    const stringifiedData = stringifyCookieData(data);
    response.cookie(key, stringifiedData, options);
};

export const getCookie = (request, key, defaultValue = undefined) => {
    const cookieValue = request.cookies[key];
    if (cookieValue === undefined) {
        return defaultValue;
    }
    return parseCookieData(cookieValue);
};

