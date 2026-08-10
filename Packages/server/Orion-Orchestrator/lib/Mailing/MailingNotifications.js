/**
 * Notification types produced by the mailing plane — the panel keys its icons
 * off these, so the strings are part of the contract with the GUI and are not
 * safe to rename without changing it too.
 */
const MailingNotifications = Object.freeze({
    JOB_QUEUED: 'mailing:job-queued',
    JOB_DELAYED: 'mailing:job-delayed',
    JOB_STARTED: 'mailing:job-started',
    JOB_COMPLETED: 'mailing:job-completed',
    JOB_CANCELLED: 'mailing:job-cancelled',
    JOB_FAILED: 'mailing:job-failed',
    GROUP_REASSIGNED: 'mailing:group-reassigned',
    DEAD_LETTERS: 'mailing:dead-letters',
    WATCHDOG_RECOVERED: 'mailing:watchdog-recovered',
    NO_NODES: 'mailing:no-nodes'
});

/** The notification type a finished job produces, by how it finished. */
const completionNotificationFor = status =>
    status === 'completed' ? MailingNotifications.JOB_COMPLETED : status === 'cancelled' ? MailingNotifications.JOB_CANCELLED : MailingNotifications.JOB_FAILED;

export { MailingNotifications, completionNotificationFor };
