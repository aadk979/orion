import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const dbModule = new SafeModuleHandler('Database', 'db', 'NotificationModel.js');

const query = (text, params) => dbModule.getModule().query(text, params);

/**
 * Orion Notifications — the system-owned channel for telling a user something
 * that matters about THEIR account, in-product, without depending on email.
 *
 * Design notes that matter:
 *
 *   - Receipts are materialized LAZILY. A broadcast is one row; a user's
 *     receipt appears the first time they ask. Announcing to a million users
 *     therefore costs one INSERT, not a million.
 *
 *   - Audience is evaluated at materialization time against live state, so
 *     "everyone with TOTP enabled" means whoever has it enabled when they next
 *     load the app — not a snapshot taken at announce time.
 *
 *   - Every timestamp that drives prompting lives in this table. The client is
 *     never asked when it last showed something: a browser clock (or a cleared
 *     localStorage) must not be able to suppress or re-trigger a security
 *     notice.
 */

const AUDIENCES = Object.freeze(['all', 'totp-enrolled']);
const SEVERITIES = Object.freeze(['info', 'important', 'urgent']);

/** Unread notifications are re-surfaced this long after they were last shown. */
const REPROMPT_INTERVAL = '24 hours';

const NotificationModel = {
    /**
     * Creates (or refreshes) a system notification.
     *
     * A `notificationKey` makes the announcement idempotent across a cluster:
     * every node booting into the same degraded state produces the same key, so
     * the fleet raises ONE notification rather than one per node. Refreshing an
     * existing key deliberately does NOT reset receipts — a user who already
     * dismissed the notice should not be re-prompted every time a node restarts.
     */
    async announce({ notificationKey = null, userUid = null, audience = 'all', severity = 'info', title, body, actionLabel = null, actionUrl = null, expiresInSeconds = null }) {
        if (!AUDIENCES.includes(audience)) throw new Error(`NotificationModel: unknown audience "${audience}"`);
        if (!SEVERITIES.includes(severity)) throw new Error(`NotificationModel: unknown severity "${severity}"`);

        const result = await query(
            `INSERT INTO orion_notifications
                 (notification_key, user_uid, audience, severity, title, body, action_label, action_url, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9::BIGINT IS NULL THEN NULL ELSE NOW() + ($9::BIGINT * interval '1 second') END)
             ON CONFLICT (notification_key) WHERE notification_key IS NOT NULL AND user_uid IS NULL
             DO UPDATE SET severity = EXCLUDED.severity,
                           title = EXCLUDED.title,
                           body = EXCLUDED.body,
                           action_label = EXCLUDED.action_label,
                           action_url = EXCLUDED.action_url,
                           expires_at = EXCLUDED.expires_at
             RETURNING id`,
            [notificationKey, userUid, audience, severity, title, body, actionLabel, actionUrl, expiresInSeconds]
        );

        return Number(result.rows[0].id);
    },

    /** Withdraws a keyed announcement once the condition that caused it clears. */
    async withdraw(notificationKey) {
        const result = await query('DELETE FROM orion_notifications WHERE notification_key = $1', [notificationKey]);
        return result.rowCount;
    },

    /**
     * Creates any missing receipts for this user. Cheap and idempotent — safe
     * to run on every check.
     */
    async materializeFor(uid) {
        const result = await query(
            `INSERT INTO orion_notification_receipts (notification_id, user_uid)
             SELECT n.id, $1
               FROM orion_notifications n
              WHERE (n.expires_at IS NULL OR n.expires_at > NOW())
                AND (
                      n.user_uid = $1
                      OR (
                          n.user_uid IS NULL
                          AND (
                                n.audience = 'all'
                                OR (n.audience = 'totp-enrolled' AND EXISTS (SELECT 1 FROM user_totp t WHERE t.user_uid = $1 AND t.enabled))
                              )
                         )
                    )
             ON CONFLICT (notification_id, user_uid) DO NOTHING`,
            [uid]
        );

        return result.rowCount;
    },

    /**
     * Everything this user should see, newest first, with its receipt state.
     * Excludes expired rows and anything already viewed.
     */
    async listActionable(uid) {
        const result = await query(
            `SELECT n.id,
                    n.severity,
                    n.title,
                    n.body,
                    n.action_label,
                    n.action_url,
                    r.state,
                    floor(EXTRACT(EPOCH FROM n.created_at))::FLOAT8 AS created_at,
                    floor(EXTRACT(EPOCH FROM r.shown_at))::FLOAT8   AS shown_at
               FROM orion_notification_receipts r
               JOIN orion_notifications n ON n.id = r.notification_id
              WHERE r.user_uid = $1
                AND r.state <> 'viewed'
                AND (n.expires_at IS NULL OR n.expires_at > NOW())
              ORDER BY CASE n.severity WHEN 'urgent' THEN 0 WHEN 'important' THEN 1 ELSE 2 END,
                       n.created_at DESC`,
            [uid]
        );

        return result.rows.map(row => ({
            id: Number(row.id),
            severity: row.severity,
            title: row.title,
            body: row.body,
            actionLabel: row.action_label,
            actionUrl: row.action_url,
            state: row.state,
            createdAt: row.created_at,
            shownAt: row.shown_at
        }));
    },

    /**
     * The prompting decision, taken entirely in the database.
     *
     * Prompt when either:
     *   - something has NEVER been shown to this user (state 'pending'), or
     *   - something was shown but never acknowledged, and the last time
     *     anything was shown is older than the re-prompt interval.
     *
     * `nextPromptAt` is returned so the client can be told when it will be
     * asked again, without being trusted to enforce it.
     */
    async evaluatePrompt(uid) {
        const result = await query(
            `SELECT COUNT(*) FILTER (WHERE r.state = 'pending')                        AS pending,
                    COUNT(*) FILTER (WHERE r.state = 'shown')                          AS unread,
                    floor(EXTRACT(EPOCH FROM MAX(r.shown_at)))::FLOAT8                 AS last_shown_at,
                    (MAX(r.shown_at) IS NULL OR MAX(r.shown_at) < NOW() - interval '${REPROMPT_INTERVAL}') AS reprompt_due,
                    floor(EXTRACT(EPOCH FROM (MAX(r.shown_at) + interval '${REPROMPT_INTERVAL}')))::FLOAT8 AS next_prompt_at
               FROM orion_notification_receipts r
               JOIN orion_notifications n ON n.id = r.notification_id
              WHERE r.user_uid = $1
                AND r.state <> 'viewed'
                AND (n.expires_at IS NULL OR n.expires_at > NOW())`,
            [uid]
        );

        const row = result.rows[0] || {};
        const pending = Number(row.pending || 0);
        const unread = Number(row.unread || 0);
        const repromptDue = row.reprompt_due === true;

        return {
            prompt: pending > 0 || (unread > 0 && repromptDue),
            pending,
            unread,
            lastShownAt: row.last_shown_at ?? null,
            nextPromptAt: row.next_prompt_at ?? null
        };
    },

    /** Records that these notifications were actually put in front of the user. */
    async markShown(uid, ids) {
        if (!Array.isArray(ids) || ids.length === 0) return 0;

        const result = await query(
            `UPDATE orion_notification_receipts
                SET state = 'shown', shown_at = NOW()
              WHERE user_uid = $1 AND notification_id = ANY($2::BIGINT[]) AND state <> 'viewed'`,
            [uid, ids]
        );

        return result.rowCount;
    },

    /** The user acknowledged them — they stop being offered. */
    async markViewed(uid, ids) {
        if (!Array.isArray(ids) || ids.length === 0) return 0;

        const result = await query(
            `UPDATE orion_notification_receipts
                SET state = 'viewed', viewed_at = NOW(), shown_at = COALESCE(shown_at, NOW())
              WHERE user_uid = $1 AND notification_id = ANY($2::BIGINT[])`,
            [uid, ids]
        );

        return result.rowCount;
    }
};

export { NotificationModel, AUDIENCES, SEVERITIES, REPROMPT_INTERVAL };
