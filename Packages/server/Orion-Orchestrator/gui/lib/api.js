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

/**
 * Uploads a file as a raw request body.
 *
 * Not multipart: the endpoint takes exactly one file and no other fields, so
 * the browser's own File object is sent as-is and the name rides a query
 * parameter. The API's parse errors come back as a `details` array, which is
 * preserved here — an operator fixing a sheet needs every problem at once, not
 * the first one.
 */
export const upload = async (path, file) => {
    const response = await fetch(`${path}?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        /* non-JSON */
    }

    if (!response.ok || payload?.error) {
        const error = new ApiError(payload?.code || `HTTP-${response.status}`, payload?.message || response.statusText, response.status);
        error.details = payload?.details || [];
        throw error;
    }
    return payload;
};

export const fmtTime = value => {
    if (!value) return '—';
    const d = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
};

/** "2h 14m" / "45s" — durations in the panel are read at a glance, not measured. */
export const fmtDuration = seconds => {
    if (seconds === null || seconds === undefined) return '—';
    const total = Math.max(0, Math.round(Number(seconds)));
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
