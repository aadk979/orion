import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'WebAuthnCeremonyModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

const CEREMONY_TYPES = new Set(['registration', 'authentication', 'sign-up', 'step-up']);

/**
 * Server-side WebAuthn ceremony state.
 *
 * The challenge used to travel to the client inside a cookie and come back as
 * the value the assertion was checked against, which meant it was whatever the
 * caller said it was — never single-use, and freshness enforced only by a cookie
 * Max-Age that only a browser honours. The uid rode along the same way, so the
 * credential a ceremony verified against was caller-selected too.
 *
 * Here the challenge and the subject live server-side, the cookie carries an
 * opaque id, and consumption is atomic.
 */
export const WebAuthnCeremonyModel = {
    /**
     * @param {object} ceremony
     * @param {string} ceremony.ceremonyId
     * @param {string} ceremony.type       one of CEREMONY_TYPES
     * @param {string} ceremony.challenge
     * @param {string} [ceremony.uid]      subject, when the account exists
     * @param {string} [ceremony.email]    subject for sign-up, which precedes the account
     * @param {object} [ceremony.metadata] per-type scratch state
     * @param {number} ceremony.expiresAt  unix seconds
     */
    async create({ ceremonyId, type, challenge, uid = null, email = null, metadata = null, expiresAt }) {
        if (!CEREMONY_TYPES.has(type)) {
            throw new Error(`WebAuthnCeremonyModel.create: unknown ceremony type "${type}"`);
        }

        await query(
            `INSERT INTO webauthn_ceremonies (ceremony_id, user_uid, email, type, challenge, metadata, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))`,
            [ceremonyId, uid, email, type, challenge, metadata ? JSON.stringify(metadata) : null, expiresAt]
        );
    },

    /**
     * Claims a ceremony: marks it consumed and returns it, but ONLY if it is
     * unconsumed, unexpired, and of the expected type.
     *
     * One statement on purpose — a read-then-write pair would let two concurrent
     * submissions of the same captured assertion both observe an unconsumed row.
     * The type predicate is part of the claim so a registration ceremony can
     * never be completed as an authentication.
     *
     * @returns {{ ceremony_id, user_uid, email, type, challenge, metadata } | null}
     *   null when already used, expired, absent, or the wrong type.
     */
    async consume(ceremonyId, expectedType) {
        if (!ceremonyId) return null;

        const result = await query(
            `UPDATE webauthn_ceremonies
                SET consumed_at = now()
              WHERE ceremony_id = $1
                AND type        = $2
                AND consumed_at IS NULL
                AND expires_at  > now()
          RETURNING ceremony_id, user_uid, email, type, challenge, metadata`,
            [ceremonyId, expectedType]
        );

        return result.rows[0] || null;
    },

    /** TTL sweep. Consumed rows go too — they have no purpose once used. */
    async removeExpired() {
        const result = await query('DELETE FROM webauthn_ceremonies WHERE expires_at <= now()');
        return result.rowCount || 0;
    }
};

export { CEREMONY_TYPES };
