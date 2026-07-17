import express from 'express';
import path from 'path';
import fs from 'fs';

import { logger } from '../../Utils/logger.js';

/**
 * Static Asset Serving — Plain Public Directory Hosting
 * ======================================================
 *
 * Serves any file in a configured public directory the way a conventional web
 * server would: `GET /styles.css` → `<publicDir>/styles.css`. This is distinct
 * from ORAS (Resource Access System), which is a token/query-gated resource
 * server reached at `/resource-access-oras`. This surface is plain,
 * unauthenticated asset delivery for things like SPA bundles, CSS, images,
 * and fonts.
 *
 * Placement (see buildMiddlewarePipeline):
 *   Mounted AFTER the global flood guard (so asset floods are still capped) but
 *   BEFORE `express.json` and the auth/header middlewares. A browser fetching
 *   `/logo.png` never sends the `orion-*` headers, so it must not traverse
 *   headerParser. On a miss, `express.static` calls `next()`, leaving API
 *   routes untouched.
 *
 * Security posture:
 *   express.static rejects path traversal on its own. We additionally default
 *   `dotfiles: 'ignore'` (never serve .env, .git, etc.) and `index: false`
 *   (no implicit directory index). Opt-in only — nothing is served unless the
 *   integrator sets `api.static.enabled`.
 */

const STATIC_DEFAULTS = Object.freeze({
    enabled: false,
    directory: 'public',
    options: {
        dotfiles: 'ignore',
        index: false,
        maxAge: '1h',
        fallthrough: true // miss → next(), so API routes still resolve
    }
});

/**
 * Builds the static-serving middleware from config.
 *
 * @param {Object} config - api.static config block
 * @param {boolean} [config.enabled=false] - opt-in master switch
 * @param {string}  [config.directory='public'] - dir (relative to cwd) to serve
 * @param {Object}  [config.options] - passed straight to express.static
 * @returns {Function|null} an Express middleware, or null when disabled/absent
 */
const buildStaticAssetServer = (config = {}) => {
    const settings = {
        ...STATIC_DEFAULTS,
        ...config,
        options: { ...STATIC_DEFAULTS.options, ...(config.options || {}) }
    };

    if (settings.enabled !== true) {
        return null;
    }

    const absoluteDir = path.isAbsolute(settings.directory)
        ? settings.directory
        : path.join(process.cwd(), settings.directory);

    if (!fs.existsSync(absoluteDir)) {
        logger.warn(
            `Static asset serving is enabled but directory does not exist: ${absoluteDir}. Skipping.`
        );
        return null;
    }

    logger.info(`Static asset serving active from: ${absoluteDir}`);

    return express.static(absoluteDir, settings.options);
};

export { buildStaticAssetServer, STATIC_DEFAULTS };
