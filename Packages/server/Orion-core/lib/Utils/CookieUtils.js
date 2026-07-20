import { resolveCookieOptions, resolveClearOptions } from '../General/CookiePolicy.js';

export const stringifyCookieData = data => {
    if (typeof data === 'string') {
        return data;
    }
    return JSON.stringify(data);
};

export const parseCookieData = cookieValue => {
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

/**
 * Sets a cookie whose options are decided ENTIRELY by the centralized policy in
 * General/CookiePolicy.js. The controller supplies only the name and value —
 * there is deliberately no options argument, so a controller can never override
 * the policy. Token lifespans (maxAgeFrom) are resolved from systemConfig inside
 * the policy at call time.
 *
 * @param {object} response  Express response
 * @param {string} key       Cookie name registered in the policy
 * @param {*}      data       Cookie value (stringified automatically)
 */
export const setManagedCookie = (response, key, data) => {
    const options = resolveCookieOptions(key);
    response.cookie(key, stringifyCookieData(data), options);
};

/**
 * Clears a policy-registered cookie using the exact attributes the policy set it
 * with (so the browser actually drops it). Options are policy-owned; no override.
 *
 * @param {object} response  Express response
 * @param {string} key       Cookie name registered in the policy
 */
export const clearManagedCookie = (response, key) => {
    const options = resolveClearOptions(key);
    response.cookie(key, '', options);
};
