/**
 * SSF transmitter — emits CAEP events as SETs to registered receivers.
 *
 * Delivery is RFC 8935 (HTTP push) and RFC 8936 (poll). Push posts the SET to
 * the receiver's endpoint with `Content-Type: application/secevent+jwt`; poll
 * holds SETs in a per-stream queue until the receiver collects and acknowledges
 * them.
 *
 * TWO PROPERTIES THAT MATTER MORE THAN THE TRANSPORT
 *
 * 1. Emission NEVER blocks or fails the security action that produced it.
 *    A revocation that succeeded locally but could not be transmitted is still
 *    a successful revocation — the caller must not see an error, and the user
 *    must not be left with a live session because a receiver was unreachable.
 *    Every entry point here is fire-and-forget with its own error handling.
 *
 * 2. Undelivered events are retried, not dropped. A receiver that is down for
 *    thirty seconds during a password reset would otherwise miss the one event
 *    that mattered. Retries use exponential backoff and a bounded queue, so a
 *    permanently dead receiver degrades to logged failures rather than
 *    unbounded memory growth — the same discipline applied to abuse detection.
 */
import { logger } from '../../logger.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { buildSetClaims, signSet } from './SecurityEventToken.js';
import { ssfStreamRegistry, DeliveryMethods } from './SsfStreamRegistry.js';

const signatureSecretsModule = new SafeModuleHandler('SignatureSecretsManager(internal)', 'SIGNATURE_SECRETS_MANAGER_internal', 'SsfTransmitter.js');

/** Attempts per SET before it is abandoned, including the first. */
const MAX_DELIVERY_ATTEMPTS = 5;

/** Backoff schedule in ms, indexed by attempt number. */
const RETRY_BACKOFF_MS = [1_000, 5_000, 15_000, 60_000];

/** Hard ceiling on queued SETs per stream — bounds a dead receiver. */
const MAX_QUEUE_PER_STREAM = 1_000;

/** How long a poll-delivered SET waits to be collected before it is dropped. */
const POLL_RETENTION_MS = 24 * 60 * 60 * 1000;

class SsfTransmitter {
    constructor() {
        /** streamId → [{ jti, token, queuedAt }] awaiting poll collection */
        this._pollQueues = new Map();

        /** Pending push retries, so they can be cancelled on shutdown. */
        this._timers = new Set();
    }

    /** The `iss` every SET this node emits carries. */
    _issuer() {
        return globalAccessPoint.getValue('ssfIssuer');
    }

    _enabled() {
        try {
            return globalAccessPoint.getValue('ssfEnabled') === true;
        } catch {
            return false;
        }
    }

    /**
     * Emits one CAEP event to every stream subscribed to its type.
     *
     * @param {string} eventType  a CaepEventTypes value
     * @param {object} eventPayload  the `events` map from a CaepEvents builder
     * @param {object} [options]
     * @param {string} [options.txn] correlation id across several SETs
     * @returns {Promise<{emitted: number}>}
     */
    async emit(eventType, eventPayload, { txn = null } = {}) {
        if (!this._enabled()) return { emitted: 0 };

        const issuer = this._issuer();

        if (!issuer) {
            logger.warn('SSF: no issuer configured (sharedSignals.issuer) — event not emitted');
            return { emitted: 0 };
        }

        const streams = await ssfStreamRegistry.streamsFor(eventType);

        if (streams.length === 0) return { emitted: 0 };

        const signingPair = await signatureSecretsModule.getModule().getRandomSigningKeyPair();

        if (!signingPair) {
            logger.error('SSF: no signing key available — event not emitted');
            return { emitted: 0 };
        }

        let emitted = 0;

        for (const stream of streams) {
            try {
                const claims = buildSetClaims({
                    issuer,
                    audience: stream.aud || stream.stream_id,
                    events: eventPayload,
                    txn
                });

                const token = signSet(claims, signingPair);

                if (stream.delivery.method === DeliveryMethods.PUSH) {
                    // Detached: a slow receiver must not hold up the security
                    // action that triggered this.
                    this._push(stream, token, claims.jti, 0).catch(e => logger.warn(`SSF: push failed for ${stream.stream_id} — ${e.message}`));
                } else {
                    this._enqueueForPoll(stream.stream_id, token, claims.jti);
                }

                emitted++;
            } catch (e) {
                logger.warn(`SSF: could not build/sign SET for stream ${stream.stream_id} — ${e.message}`);
            }
        }

        return { emitted };
    }

    /**
     * Fire-and-forget wrapper. Use this from security paths: it can never throw
     * and never rejects, so a caller can drop it into an existing flow without
     * adding a failure mode to an operation that already succeeded.
     */
    emitDetached(eventType, eventPayload, options = {}) {
        Promise.resolve(this.emit(eventType, eventPayload, options)).catch(e => logger.warn(`SSF: event emission failed — ${e.message}`));
    }

    /** RFC 8935 push, with bounded exponential-backoff retry. */
    async _push(stream, token, jti, attempt) {
        const headers = {
            'Content-Type': 'application/secevent+jwt',
            Accept: 'application/json'
        };

        if (stream.delivery_auth) {
            headers.Authorization = `Bearer ${stream.delivery_auth}`;
        }

        let response;

        try {
            response = await fetch(stream.delivery.endpoint_url, {
                method: 'POST',
                headers,
                body: token,
                signal: AbortSignal.timeout(10_000)
            });
        } catch (e) {
            return this._scheduleRetry(stream, token, jti, attempt, e.message);
        }

        // RFC 8935: 202 Accepted on success. Any 2xx is treated as delivered.
        if (response.ok) {
            logger.debug?.(`SSF: delivered ${jti} to ${stream.stream_id}`);
            return { delivered: true };
        }

        // 4xx other than 429 means the receiver rejected the SET itself —
        // retrying an identical payload cannot change that answer, so it is
        // abandoned rather than burning the retry budget.
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            logger.warn(`SSF: receiver ${stream.stream_id} rejected ${jti} with ${response.status} — not retrying`);
            return { delivered: false, permanent: true };
        }

        return this._scheduleRetry(stream, token, jti, attempt, `HTTP ${response.status}`);
    }

    _scheduleRetry(stream, token, jti, attempt, why) {
        if (attempt + 1 >= MAX_DELIVERY_ATTEMPTS) {
            logger.error(`SSF: giving up on ${jti} for stream ${stream.stream_id} after ${MAX_DELIVERY_ATTEMPTS} attempts (${why})`);
            return { delivered: false };
        }

        const delay = RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)];
        logger.warn(`SSF: delivery of ${jti} to ${stream.stream_id} failed (${why}) — retry ${attempt + 1} in ${delay}ms`);

        const timer = setTimeout(() => {
            this._timers.delete(timer);
            this._push(stream, token, jti, attempt + 1).catch(e => logger.warn(`SSF: retry failed — ${e.message}`));
        }, delay);

        // Never hold the process open for a retry.
        if (typeof timer.unref === 'function') timer.unref();
        this._timers.add(timer);

        return { delivered: false, retrying: true };
    }

    // ── RFC 8936 poll delivery ───────────────────────────────────────────────

    _enqueueForPoll(streamId, token, jti) {
        if (!this._pollQueues.has(streamId)) this._pollQueues.set(streamId, []);

        const queue = this._pollQueues.get(streamId);
        queue.push({ jti, token, queuedAt: Date.now() });

        // Oldest-first eviction. A receiver that never polls cannot grow this
        // without bound; losing the oldest events is the correct casualty.
        if (queue.length > MAX_QUEUE_PER_STREAM) {
            const dropped = queue.splice(0, queue.length - MAX_QUEUE_PER_STREAM);
            logger.warn(`SSF: poll queue for ${streamId} overflowed — dropped ${dropped.length} undelivered events`);
        }
    }

    /**
     * Collects queued SETs for a stream. Events are NOT removed here — a
     * receiver that crashes between receiving and processing would lose them.
     * They leave the queue only on explicit acknowledgement, which is what
     * RFC 8936's ack semantics are for.
     */
    poll(streamId, { maxEvents = 100 } = {}) {
        this._expirePollQueue(streamId);

        const queue = this._pollQueues.get(streamId) || [];
        const batch = queue.slice(0, maxEvents);

        return {
            sets: Object.fromEntries(batch.map(e => [e.jti, e.token])),
            moreAvailable: queue.length > batch.length
        };
    }

    /** Removes acknowledged SETs from the queue. */
    acknowledge(streamId, jtis) {
        const queue = this._pollQueues.get(streamId);
        if (!queue) return { acknowledged: 0 };

        const ackSet = new Set(jtis || []);
        const before = queue.length;

        this._pollQueues.set(
            streamId,
            queue.filter(e => !ackSet.has(e.jti))
        );

        return { acknowledged: before - (this._pollQueues.get(streamId)?.length ?? 0) };
    }

    _expirePollQueue(streamId) {
        const queue = this._pollQueues.get(streamId);
        if (!queue) return;

        const cutoff = Date.now() - POLL_RETENTION_MS;
        const kept = queue.filter(e => e.queuedAt >= cutoff);

        if (kept.length !== queue.length) {
            logger.warn(`SSF: expired ${queue.length - kept.length} uncollected events for ${streamId}`);
        }

        this._pollQueues.set(streamId, kept);
    }

    /** Cancels pending retries — used on shutdown. */
    shutdown() {
        for (const timer of this._timers) clearTimeout(timer);
        this._timers.clear();
    }

    getStats() {
        return {
            pollQueues: this._pollQueues.size,
            queuedEvents: [...this._pollQueues.values()].reduce((n, q) => n + q.length, 0),
            pendingRetries: this._timers.size
        };
    }
}

const ssfTransmitter = new SsfTransmitter();

export { ssfTransmitter, SsfTransmitter, MAX_DELIVERY_ATTEMPTS, MAX_QUEUE_PER_STREAM };
