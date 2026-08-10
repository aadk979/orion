/**
 * Express router for the Shared Signals endpoints.
 *
 * Mounted EARLY — ahead of the browser-oriented middleware stack — and that
 * placement is deliberate, not a shortcut.
 *
 * The main stack assumes a browser client: `requestMetadataMiddleware` refuses
 * any request without `orion-fingerprint`, `orion-user-agent` and a resolvable
 * client IP. A peer service delivering a Security Event Token has none of
 * those and no reason to invent them, so routing SSF traffic through that stack
 * would reject every legitimate delivery with a fingerprint error. These
 * endpoints are machine-to-machine and carry their own authentication: the
 * SET's signature for delivery, the management token for stream control.
 *
 * Body parsing is per-route for the same reason. RFC 8935 delivers a bare
 * compact JWS with `Content-Type: application/secevent+jwt`, which `express.json`
 * neither parses nor should — it needs the raw string.
 */
import express from 'express';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import {
    routeHandlerSsfConfiguration,
    routeHandlerSsfJwks,
    routeHandlerSsfStreamCreate,
    routeHandlerSsfStreamRead,
    routeHandlerSsfStreamUpdate,
    routeHandlerSsfStreamDelete,
    routeHandlerSsfStreamStatus,
    routeHandlerSsfReceive,
    routeHandlerSsfPoll
} from './routes.js';

/**
 * @returns {import('express').Router|null} null when Shared Signals is disabled,
 *   so a deployment that does not use it mounts nothing at all.
 */
const buildSharedSignalsRouter = () => {
    let enabled = false;

    try {
        enabled = globalAccessPoint.getValue('ssfEnabled') === true;
    } catch {
        return null;
    }

    if (!enabled) return null;

    const nameSpace = globalAccessPoint.nameSpace();
    const router = express.Router();

    const base = `/${nameSpace}/api/v1/ssf`;

    // Discovery. Served at the well-known location receivers actually probe.
    router.get('/.well-known/ssf-configuration', routeHandlerSsfConfiguration);
    router.get(`${base}/.well-known/ssf-configuration`, routeHandlerSsfConfiguration);

    // Verification keys for the SETs this transmitter signs.
    router.get(`${base}/jwks`, routeHandlerSsfJwks);

    // RFC 8935 push delivery. `type: '*/*'` because receivers legitimately send
    // `application/secevent+jwt`, and a stricter matcher would silently hand the
    // handler an empty body instead of the token.
    router.post(`${base}/receive`, express.text({ type: '*/*', limit: '256kb' }), routeHandlerSsfReceive);

    // Stream management and poll delivery are ordinary JSON.
    const jsonBody = express.json({ limit: '256kb' });

    router.post(`${base}/stream`, jsonBody, routeHandlerSsfStreamCreate);
    router.get(`${base}/stream`, routeHandlerSsfStreamRead);
    router.patch(`${base}/stream`, jsonBody, routeHandlerSsfStreamUpdate);
    router.delete(`${base}/stream`, jsonBody, routeHandlerSsfStreamDelete);
    router.post(`${base}/status`, jsonBody, routeHandlerSsfStreamStatus);
    router.post(`${base}/poll`, jsonBody, routeHandlerSsfPoll);

    return router;
};

export { buildSharedSignalsRouter };
