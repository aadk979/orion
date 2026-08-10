/**
 * HTTP surface for the Shared Signals Framework.
 *
 * These endpoints are what make the transmitter/receiver pair usable by
 * something that is not Orion. A receiver discovers the transmitter through
 * `/.well-known/ssf-configuration`, fetches verification keys from the JWKS,
 * creates a stream describing what it wants and where to send it, and then
 * either receives pushes or polls.
 *
 * AUTHENTICATION
 *
 * Stream management mutates who receives security events about your users, so
 * it is privileged: a caller who can create a stream can have every revocation
 * in the system forwarded to an endpoint they control. It is gated on the
 * management token rather than a user session, because the caller is a peer
 * service, not a person.
 *
 * The receive endpoint is deliberately NOT token-gated. Its authentication is
 * the SET's own signature, checked against a configured issuer's JWKS — that is
 * what RFC 8935 specifies, and adding a shared secret in front of it would only
 * create a second, weaker credential guarding the same door.
 */
import crypto from 'crypto';
import { logger } from '../../logger.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { toPublicJwk } from './SecurityEventToken.js';
import { SUPPORTED_EVENT_TYPES } from './CaepEvents.js';
import { ssfStreamRegistry, DeliveryMethods, StreamStatus } from './SsfStreamRegistry.js';
import { ssfTransmitter } from './SsfTransmitter.js';
import { receiveSet } from './SsfReceiver.js';

const signatureSecretsModule = new SafeModuleHandler('SignatureSecretsManager(internal)', 'SIGNATURE_SECRETS_MANAGER_internal', 'ssf/routes.js');

const json = (response, status, body) => response.status(status).json(body);

/**
 * Constant-time comparison of the management token.
 *
 * A length-varying `===` on a secret leaks it a byte at a time to anyone who
 * can measure the response, which is exactly the sort of endpoint worth
 * measuring.
 */
const managementTokenValid = request => {
    const configured = globalAccessPoint.getValue('ssfManagementToken');

    if (!configured) return false;

    const header = request.headers['authorization'] || '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    const a = Buffer.from(presented, 'utf8');
    const b = Buffer.from(String(configured), 'utf8');

    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const requireManagement = (request, response) => {
    if (!managementTokenValid(request)) {
        json(response, 401, { error: 'unauthorized', error_description: 'A valid SSF management token is required' });
        return false;
    }
    return true;
};

const ssfEnabled = () => {
    try {
        return globalAccessPoint.getValue('ssfEnabled') === true;
    } catch {
        return false;
    }
};

const requireEnabled = response => {
    if (!ssfEnabled()) {
        json(response, 404, { error: 'not_found', error_description: 'Shared Signals is not enabled on this deployment' });
        return false;
    }
    return true;
};

/** GET /.well-known/ssf-configuration — transmitter metadata (OpenID SSF 1.0). */
const routeHandlerSsfConfiguration = async (request, response) => {
    if (!requireEnabled(response)) return;

    const issuer = globalAccessPoint.getValue('ssfIssuer');
    const base = `${issuer}/${globalAccessPoint.nameSpace()}/api/v1/ssf`;

    return json(response, 200, {
        spec_version: '1_0',
        issuer,
        jwks_uri: `${base}/jwks`,
        configuration_endpoint: `${base}/stream`,
        status_endpoint: `${base}/status`,
        add_subject_endpoint: null,
        remove_subject_endpoint: null,
        verification_endpoint: `${base}/verify`,
        delivery_methods_supported: [DeliveryMethods.PUSH, DeliveryMethods.POLL],
        critical_subject_members: ['iss', 'sub'],
        authorization_schemes: [{ spec_urn: 'urn:ietf:rfc:6749' }]
    });
};

/** GET /ssf/jwks — public keys receivers verify our SETs against. */
const routeHandlerSsfJwks = async (request, response) => {
    if (!requireEnabled(response)) return;

    try {
        const manager = signatureSecretsModule.getModule();
        const described = manager.describeKeys ? manager.describeKeys() : null;

        // Publish every key still usable for verification, not only the current
        // signing key: a SET signed moments before a rotation must stay
        // verifiable for as long as a receiver might be retrying it.
        const pairs = [...(manager.signingPairs || []), ...(manager.verificationPairs || [])];

        const keys = pairs.map(toPublicJwk).filter(Boolean);

        if (keys.length === 0) {
            logger.warn(`SSF: JWKS is empty — receivers cannot verify SETs (${described ? JSON.stringify(described) : 'no key description'})`);
        }

        return json(response, 200, { keys });
    } catch (e) {
        logger.error(`SSF: JWKS generation failed — ${e.message}`);
        return json(response, 500, { error: 'server_error' });
    }
};

/** POST /ssf/stream — create. GET — read. PATCH — update. DELETE — remove. */
const routeHandlerSsfStreamCreate = async (request, response) => {
    if (!requireEnabled(response) || !requireManagement(request, response)) return;

    const result = await ssfStreamRegistry.create(request.body?.packet || request.body || {});

    if (result.error) return json(response, 400, { error: 'invalid_request', error_description: result.message });

    return json(response, 201, result.stream);
};

const routeHandlerSsfStreamRead = async (request, response) => {
    if (!requireEnabled(response) || !requireManagement(request, response)) return;

    const streamId = request.query?.stream_id;

    if (!streamId) {
        return json(response, 200, await ssfStreamRegistry.list());
    }

    const stream = await ssfStreamRegistry.get(streamId);

    if (!stream) return json(response, 404, { error: 'not_found' });

    return json(response, 200, stream);
};

const routeHandlerSsfStreamUpdate = async (request, response) => {
    if (!requireEnabled(response) || !requireManagement(request, response)) return;

    const body = request.body?.packet || request.body || {};
    const result = await ssfStreamRegistry.update(body.stream_id, body);

    if (result.error) return json(response, 400, { error: 'invalid_request', error_description: result.message });

    return json(response, 200, result.stream);
};

const routeHandlerSsfStreamDelete = async (request, response) => {
    if (!requireEnabled(response) || !requireManagement(request, response)) return;

    const streamId = request.query?.stream_id || request.body?.packet?.stream_id;

    if (!streamId) return json(response, 400, { error: 'invalid_request', error_description: 'stream_id is required' });

    await ssfStreamRegistry.delete(streamId);
    return response.status(204).end();
};

/** POST /ssf/status — pause/resume a stream without deleting it. */
const routeHandlerSsfStreamStatus = async (request, response) => {
    if (!requireEnabled(response) || !requireManagement(request, response)) return;

    const body = request.body?.packet || request.body || {};
    const result = await ssfStreamRegistry.setStatus(body.stream_id, body.status);

    if (result.error) return json(response, 400, { error: 'invalid_request', error_description: result.message });

    return json(response, 200, { stream_id: result.stream.stream_id, status: result.stream.status });
};

/**
 * POST /ssf/receive — RFC 8935 push endpoint.
 *
 * The body is a bare compact JWS with `Content-Type: application/secevent+jwt`,
 * not JSON, so this route needs the raw text. `express.text()` is applied to it
 * specifically in the server wiring.
 *
 * Responses follow RFC 8935 §2.3: 202 when accepted, 400 with a machine-readable
 * `err` when the SET is refused. The distinction matters because a transmitter
 * uses it to decide whether retrying is worthwhile.
 */
const routeHandlerSsfReceive = async (request, response) => {
    if (!requireEnabled(response)) return;

    const token = typeof request.body === 'string' ? request.body.trim() : request.body?.set || null;

    if (!token) {
        return json(response, 400, { err: 'invalid_request', description: 'Expected a compact SET in the request body' });
    }

    const result = await receiveSet(token);

    if (!result.accepted) {
        // RFC 8935 error codes. A signature or issuer problem is permanent, so
        // the transmitter should stop retrying; anything else may be transient.
        const permanent = ['BAD_SIGNATURE', 'UNTRUSTED_ISSUER', 'WRONG_TYP', 'AUDIENCE_MISMATCH', 'MALFORMED'];

        return json(response, 400, {
            err: permanent.includes(result.reason) ? 'invalid_issuer' : 'invalid_request',
            description: result.reason
        });
    }

    return response.status(202).end();
};

/** POST /ssf/poll — RFC 8936 poll delivery. */
const routeHandlerSsfPoll = async (request, response) => {
    if (!requireEnabled(response) || !requireManagement(request, response)) return;

    const body = request.body?.packet || request.body || {};
    const streamId = body.stream_id;

    if (!streamId) return json(response, 400, { error: 'invalid_request', error_description: 'stream_id is required' });

    const stream = await ssfStreamRegistry.get(streamId);
    if (!stream) return json(response, 404, { error: 'not_found' });

    if (Array.isArray(body.ack) && body.ack.length > 0) {
        ssfTransmitter.acknowledge(streamId, body.ack);
    }

    const { sets, moreAvailable } = ssfTransmitter.poll(streamId, { maxEvents: body.maxEvents || 100 });

    return json(response, 200, { sets, moreAvailable });
};

export {
    routeHandlerSsfConfiguration,
    routeHandlerSsfJwks,
    routeHandlerSsfStreamCreate,
    routeHandlerSsfStreamRead,
    routeHandlerSsfStreamUpdate,
    routeHandlerSsfStreamDelete,
    routeHandlerSsfStreamStatus,
    routeHandlerSsfReceive,
    routeHandlerSsfPoll,
    SUPPORTED_EVENT_TYPES,
    StreamStatus
};
