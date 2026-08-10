/**
 * Orion Notifications — the in-product channel Orion owns.
 *
 * Some things a user MUST be told about their own account: their authenticator
 * stopped working because the deployment lost its key vault, an administrator
 * wiped every TOTP enrollment, their second factor needs re-enrolling. Email is
 * the wrong instrument for that at fleet scale — it is slow, it is expensive to
 * send in bulk, it lands in spam, and it is exactly the channel an operator
 * cannot rely on during an incident.
 *
 * So notifications are delivered where the user already is: the host
 * application, through an Orion-controlled overlay that renders like the
 * step-up and device-authorization prompts. Consumers cannot disable it —
 * these are account-security facts, not marketing — but they can style it with
 * the same CSS variables as every other Orion surface.
 *
 * The prompting policy lives in NotificationModel.evaluatePrompt and is decided
 * entirely in Postgres:
 *
 *   - never-shown notifications prompt on the next authenticated page load;
 *   - once shown, they stay quiet;
 *   - anything still unacknowledged is raised again 24h after it was last
 *     shown, measured against the DATABASE clock — a client that lies about
 *     the time, clears storage, or never calls back cannot suppress it.
 */

import { fileURLToPath } from 'url';
import { NotificationModel } from '../../Databases/models/NotificationModel.js';
import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { tryCatch } from '../../TryCatch.js';
import { logger } from '../../logger.js';

/** Stable keys, so repeated announcements of the same condition collapse into one row. */
const NotificationKeys = Object.freeze({
    ENCRYPTION_DEGRADED: 'system:encryption-degraded',
    TOTP_WIPED: 'system:totp-wiped'
});

const MAX_ACKNOWLEDGE_IDS = 100;

/**
 * Raised when a node comes up without usable field encryption. Scoped to users
 * who actually have TOTP enabled — telling everyone else that "your
 * authenticator is unavailable" would be both false and alarming.
 *
 * Never throws: notification delivery must not be able to fail a boot.
 */
const announceEncryptionDegraded = async reason => {
    const Function = async parameters => {
        await NotificationModel.announce({
            notificationKey: NotificationKeys.ENCRYPTION_DEGRADED,
            audience: 'totp-enrolled',
            severity: 'urgent',
            title: 'Your authenticator app is temporarily unavailable',
            body:
                'This service cannot currently read stored two-factor secrets, so sign-in codes from your authenticator app are not being accepted. ' +
                'Use the emailed one-time code instead — your account is still protected by two factors and your authenticator has not been removed. ' +
                'It will start working again on its own once the service is restored.',
            actionLabel: 'Use an emailed code'
        });

        logger.warn(`Notifications: raised the encryption-degraded notice for TOTP-enrolled users (${parameters.reason})`);

        return { error: false };
    };

    return await tryCatch(Function, true, { reason }, 'announceEncryptionDegraded', fileURLToPath(import.meta.url));
};

/** Clears the degraded notice once encryption is healthy again. */
const withdrawEncryptionDegraded = async () => {
    const Function = async () => ({ error: false, withdrawn: await NotificationModel.withdraw(NotificationKeys.ENCRYPTION_DEGRADED) });

    return await tryCatch(Function, true, {}, 'withdrawEncryptionDegraded', fileURLToPath(import.meta.url));
};

/**
 * Raised after an administrator wipes every TOTP enrollment — the recovery path
 * when encrypted secrets can no longer be decrypted. Every user must re-enroll,
 * so this goes to everyone rather than to the (now empty) TOTP-enrolled set.
 */
const announceTotpWiped = async ({ reason = null, actorEmail = null } = {}) => {
    const Function = async parameters => {
        await NotificationModel.announce({
            notificationKey: NotificationKeys.TOTP_WIPED,
            audience: 'all',
            severity: 'urgent',
            title: 'Set up your authenticator app again',
            body:
                'Two-factor authentication via an authenticator app has been reset for every account on this service, so your previous authenticator entry no longer works. ' +
                'Delete the old entry in your authenticator app and set it up again from your account security settings. ' +
                'Until you do, sign-in will use an emailed one-time code.' +
                (parameters.reason ? ` Reason given: ${parameters.reason}` : ''),
            actionLabel: 'Set up two-factor again',
            // Long-lived but not permanent: a user who never returns for a year
            // does not need a year-old notice waiting for them.
            expiresInSeconds: 90 * 24 * 60 * 60
        });

        logger.warn(`Notifications: raised the TOTP-wiped notice for all users${parameters.actorEmail ? ` (wipe performed by ${parameters.actorEmail})` : ''}`);

        return { error: false };
    };

    return await tryCatch(Function, true, { reason, actorEmail }, 'announceTotpWiped', fileURLToPath(import.meta.url));
};

/**
 * Everything the signed-in user should see, plus whether the overlay should be
 * raised right now.
 *
 * Returning notifications is NOT the same as showing them: the client calls
 * back through markShown only when the overlay actually renders, so a prefetch
 * or a background poll cannot burn the one-time display.
 */
const getNotificationsForUser = async uid => {
    const Function = async parameters => {
        await NotificationModel.materializeFor(parameters.uid);

        const [decision, notifications] = await Promise.all([NotificationModel.evaluatePrompt(parameters.uid), NotificationModel.listActionable(parameters.uid)]);

        return {
            error: false,
            prompt: decision.prompt,
            pending: decision.pending,
            unread: decision.unread,
            nextPromptAt: decision.nextPromptAt,
            notifications
        };
    };

    return await tryCatch(Function, true, { uid }, 'getNotificationsForUser', fileURLToPath(import.meta.url));
};

const markNotificationsShown = async (uid, ids) => {
    const Function = async parameters => ({ error: false, updated: await NotificationModel.markShown(parameters.uid, parameters.ids) });

    return await tryCatch(Function, true, { uid, ids }, 'markNotificationsShown', fileURLToPath(import.meta.url));
};

const acknowledgeNotifications = async (uid, ids) => {
    const Function = async parameters => ({ error: false, updated: await NotificationModel.markViewed(parameters.uid, parameters.ids) });

    return await tryCatch(Function, true, { uid, ids }, 'acknowledgeNotifications', fileURLToPath(import.meta.url));
};

// ─── Route handlers ──────────────────────────────────────────────────────────

/** Ids arrive from the client, so they are coerced and bounded before use. */
const normalizeIds = raw => {
    if (!Array.isArray(raw)) return [];

    return raw
        .map(Number)
        .filter(id => Number.isInteger(id) && id > 0)
        .slice(0, MAX_ACKNOWLEDGE_IDS);
};

const routeHandlerGetNotifications = async (request, response) => {
    const callback = await getNotificationsForUser(request.user.uid);

    if (callback.error) {
        return respondWithError(response, callback.errorCode || 'NOTIFICATIONS::LOOKUP-FAILED::A::i');
    }

    return respondWithSuccess(response, 200, {
        prompt: callback.prompt,
        pending: callback.pending,
        unread: callback.unread,
        nextPromptAt: callback.nextPromptAt,
        notifications: callback.notifications
    });
};

const routeHandlerMarkNotificationsShown = async (request, response) => {
    const ids = normalizeIds(request.body?.packet?.ids);

    const callback = await markNotificationsShown(request.user.uid, ids);

    if (callback.error) {
        return respondWithError(response, callback.errorCode || 'NOTIFICATIONS::UPDATE-FAILED::A::i');
    }

    return respondWithSuccess(response, 200, { updated: callback.updated });
};

const routeHandlerAcknowledgeNotifications = async (request, response) => {
    const ids = normalizeIds(request.body?.packet?.ids);

    if (ids.length === 0) {
        return respondWithError(response, 'NOTIFICATIONS::NO-IDS::A::p');
    }

    const callback = await acknowledgeNotifications(request.user.uid, ids);

    if (callback.error) {
        return respondWithError(response, callback.errorCode || 'NOTIFICATIONS::UPDATE-FAILED::A::i');
    }

    return respondWithSuccess(response, 200, { updated: callback.updated });
};

export {
    NotificationKeys,
    announceEncryptionDegraded,
    withdrawEncryptionDegraded,
    announceTotpWiped,
    getNotificationsForUser,
    markNotificationsShown,
    acknowledgeNotifications,
    routeHandlerGetNotifications,
    routeHandlerMarkNotificationsShown,
    routeHandlerAcknowledgeNotifications
};
