'use client';

/**
 * Same-origin API client for the orch panel. The session rides an HttpOnly
 * cookie set by /api/auth/* — no token ever touches JS-accessible storage.
 */

export class ApiError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export const api = async (method, path, body = undefined) => {
    const response = await fetch(path, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        /* non-JSON */
    }

    if (!response.ok || payload?.error) {
        throw new ApiError(payload?.code || `HTTP-${response.status}`, payload?.message || response.statusText, response.status);
    }
    return payload;
};

export const get = path => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const patch = (path, body = {}) => api('PATCH', path, body);
export const del = path => api('DELETE', path);

export const fmtTime = value => {
    if (!value) return '—';
    const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};
