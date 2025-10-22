/**
 * Cookie utility functions to handle proper serialization and deserialization
 * Avoids double-stringifying strings and handles both string and object data
 */

/**
 * Safely stringify cookie data
 * Only stringifies if the data is not already a string
 * @param {any} data - The data to stringify
 * @returns {string} - The stringified data
 */
export const stringifyCookieData = (data) => {
    if (typeof data === 'string') {
        return data;
    }
    return JSON.stringify(data);
};

/**
 * Safely parse cookie data
 * Attempts to parse as JSON, falls back to original string if parsing fails
 * @param {string} cookieValue - The cookie value to parse
 * @returns {any} - The parsed data or original string
 */
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

/**
 * Set a cookie with proper data handling
 * @param {Object} response - Express response object
 * @param {string} key - Cookie key
 * @param {any} data - Cookie data
 * @param {Object} options - Cookie options
 */
export const setCookie = (response, key, data, options = {}) => {
    const stringifiedData = stringifyCookieData(data);
    response.cookie(key, stringifiedData, options);
};

/**
 * Get and parse a cookie value
 * @param {Object} request - Express request object
 * @param {string} key - Cookie key
 * @param {any} defaultValue - Default value if cookie doesn't exist
 * @returns {any} - Parsed cookie value or default
 */
export const getCookie = (request, key, defaultValue = undefined) => {
    const cookieValue = request.cookies[key];
    if (cookieValue === undefined) {
        return defaultValue;
    }
    return parseCookieData(cookieValue);
};

