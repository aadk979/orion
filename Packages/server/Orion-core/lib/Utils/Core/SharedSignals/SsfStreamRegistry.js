/**
 * Shared Signals Framework — stream configuration (OpenID SSF 1.0).
 *
 * A "stream" is the standing agreement between this transmitter and one
 * receiver: who they are, which event types they want, and how delivery
 * happens. Receivers create and manage their own stream through the
 * configuration endpoint, which is what makes this interoperable rather than a
 * bespoke webhook table an operator has to hand-edit.
 *
 * STORAGE
 *
 * Streams live in Redis when the deployment is clustered, and in memory
 * otherwise. That is not an optimisation — it is correctness. Every node emits
 * events, so every node needs the same stream list; a per-process map would
 * mean a revocation handled by node A never reaches a receiver whose stream was
 * created against node B. The same reasoning that moved abuse detection onto
 * Redis applies here, and more sharply, because the failure is silent.
 */
import { logger } from '../../logger.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { generateId } from '../../valueGenerator.js';
import { SUPPORTED_EVENT_TYPES } from './CaepEvents.js';

const redisInstanceModule = new SafeModuleHandler('RedisInstance', 'redisInstance', 'SsfStreamRegistry.js');

const REDIS_KEY = 'orion:ssf:streams';

/** RFC 8935 (push) and RFC 8936 (poll) delivery method URNs. */
const DeliveryMethods = {
    PUSH: 'urn:ietf:rfc:8935',
    POLL: 'urn:ietf:rfc:8936'
};

const StreamStatus = {
    ENABLED: 'enabled',
    PAUSED: 'paused',
    DISABLED: 'disabled'
};

class SsfStreamRegistry {
    constructor() {
        this._local = new Map();
        this._isCluster = null;
    }

    _resolveCluster() {
        if (this._isCluster !== null) return this._isCluster;

        try {
            this._isCluster = !!globalAccessPoint.clusterMode();
        } catch {
            this._isCluster = false;
        }

        return this._isCluster;
    }

    _client() {
        if (!this._resolveCluster()) return null;
        const instance = redisInstanceModule.probeModule();

        if (!instance || !instance.client) {
            logger.warn('SSF: cluster mode enabled but Redis is missing — streams are node-local and events will not reach every receiver.');
            return null;
        }

        return instance.client;
    }

    /**
     * Normalises and validates a receiver-supplied configuration.
     *
     * `events_requested` is intersected with what this transmitter actually
     * supports, and the result reported back as `events_delivered` — SSF
     * requires the transmitter to state what it will really send rather than
     * echoing the request and silently dropping the rest.
     */
    _normalize(config, existing = null) {
        const deliveryMethod = config?.delivery?.method || DeliveryMethods.PUSH;

        if (deliveryMethod !== DeliveryMethods.PUSH && deliveryMethod !== DeliveryMethods.POLL) {
            return { error: 'unsupported delivery method' };
        }

        if (deliveryMethod === DeliveryMethods.PUSH) {
            const url = config?.delivery?.endpoint_url;

            if (typeof url !== 'string' || !url) {
                return { error: 'push delivery requires delivery.endpoint_url' };
            }

            let parsed;
            try {
                parsed = new URL(url);
            } catch {
                return { error: 'delivery.endpoint_url is not a valid URL' };
            }

            // Events are pushed to an address the receiver chooses, so this is a
            // server-side request the caller controls. Refusing plaintext keeps
            // SETs — which name users and describe their security state — off
            // the wire in the clear.
            if (parsed.protocol !== 'https:' && !globalAccessPoint.getValue('ssfAllowInsecureDelivery')) {
                return { error: 'delivery.endpoint_url must be https' };
            }
        }

        const requested = Array.isArray(config?.events_requested) ? config.events_requested : SUPPORTED_EVENT_TYPES;
        const delivered = requested.filter(e => SUPPORTED_EVENT_TYPES.includes(e));

        if (delivered.length === 0) {
            return { error: 'none of the requested events are supported by this transmitter' };
        }

        return {
            stream: {
                stream_id: existing?.stream_id || generateId('SSF_STREAM', 24),
                iss: globalAccessPoint.getValue('ssfIssuer'),
                aud: config?.aud || existing?.aud || null,
                delivery: {
                    method: deliveryMethod,
                    ...(deliveryMethod === DeliveryMethods.PUSH ? { endpoint_url: config.delivery.endpoint_url } : {})
                },
                events_supported: SUPPORTED_EVENT_TYPES,
                events_requested: requested,
                events_delivered: delivered,
                // Shared secret the receiver may require on push (RFC 8935 allows
                // the transmitter to authenticate itself to the receiver).
                delivery_auth: config?.delivery_auth || existing?.delivery_auth || null,
                status: existing?.status || StreamStatus.ENABLED,
                created_at: existing?.created_at || Math.floor(Date.now() / 1000),
                updated_at: Math.floor(Date.now() / 1000)
            }
        };
    }

    async create(config) {
        const result = this._normalize(config);
        if (result.error) return { error: true, message: result.error };

        await this._persist(result.stream);
        logger.info(`SSF: stream ${result.stream.stream_id} created (${result.stream.delivery.method})`);

        return { error: false, stream: result.stream };
    }

    async update(streamId, config) {
        const existing = await this.get(streamId);
        if (!existing) return { error: true, message: 'stream not found' };

        const result = this._normalize(config, existing);
        if (result.error) return { error: true, message: result.error };

        await this._persist(result.stream);
        return { error: false, stream: result.stream };
    }

    async setStatus(streamId, status) {
        const existing = await this.get(streamId);
        if (!existing) return { error: true, message: 'stream not found' };

        if (!Object.values(StreamStatus).includes(status)) {
            return { error: true, message: 'invalid status' };
        }

        existing.status = status;
        existing.updated_at = Math.floor(Date.now() / 1000);
        await this._persist(existing);

        return { error: false, stream: existing };
    }

    async _persist(stream) {
        const client = this._client();

        if (client) {
            await client.sendCommand(['HSET', REDIS_KEY, stream.stream_id, JSON.stringify(stream)]);
            return;
        }

        this._local.set(stream.stream_id, stream);
    }

    async get(streamId) {
        if (!streamId) return null;

        const client = this._client();

        if (client) {
            try {
                const raw = await client.sendCommand(['HGET', REDIS_KEY, streamId]);
                return raw ? JSON.parse(raw) : null;
            } catch (e) {
                logger.warn(`SSF: stream read failed — ${e.message}`);
                return this._local.get(streamId) || null;
            }
        }

        return this._local.get(streamId) || null;
    }

    async list() {
        const client = this._client();

        if (client) {
            try {
                const raw = await client.sendCommand(['HGETALL', REDIS_KEY]);

                // node-redis returns either a flat array or an object depending
                // on version; handle both rather than assuming one.
                if (Array.isArray(raw)) {
                    const out = [];
                    for (let i = 1; i < raw.length; i += 2) out.push(JSON.parse(raw[i]));
                    return out;
                }

                return Object.values(raw || {}).map(v => JSON.parse(v));
            } catch (e) {
                logger.warn(`SSF: stream list failed — ${e.message}`);
                return [...this._local.values()];
            }
        }

        return [...this._local.values()];
    }

    async delete(streamId) {
        const client = this._client();

        if (client) {
            await client.sendCommand(['HDEL', REDIS_KEY, streamId]);
        }

        this._local.delete(streamId);
        return { error: false };
    }

    /** Enabled streams that asked for this event type. */
    async streamsFor(eventType) {
        const all = await this.list();
        return all.filter(s => s.status === StreamStatus.ENABLED && s.events_delivered.includes(eventType));
    }
}

const ssfStreamRegistry = new SsfStreamRegistry();

export { ssfStreamRegistry, SsfStreamRegistry, DeliveryMethods, StreamStatus };
