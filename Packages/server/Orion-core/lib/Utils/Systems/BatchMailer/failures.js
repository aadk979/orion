/**
 * Reading an SMTP failure.
 *
 * Three questions get asked of every error, and they decide three different
 * things, so they are three separate predicates rather than one classifier:
 *
 *   isPermanentRejection → stop retrying this address at all
 *   isRateLimited        → retry, but charge the rate budget, not the attempt budget
 *   isTransportFailure   → count towards "the server is broken", not "the address is bad"
 *
 * An error can satisfy more than one (a 451 is both a throttle and a transport
 * signal); the caller's order of asking is what resolves that, and it is
 * documented at the call site in GroupSender.
 */

/**
 * Replies that will never succeed on retry: the mailbox does not exist, the
 * address is malformed, or the recipient is refusing mail outright. Retrying
 * these three times only delays the inevitable and spends rate budget doing it.
 */
const isPermanentRejection = error => {
    const code = Number(error?.responseCode ?? error?.code);
    if (code >= 500 && code < 600) return true;
    return /invalid recipient|user unknown|no such user|mailbox unavailable|does not exist|address rejected/i.test(String(error?.message || ''));
};

/** A failure that is about the transport rather than the address. */
const isTransportFailure = error => {
    const code = String(error?.code || '');
    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAUTH', 'ESOCKET', 'EDNS'].includes(code)) return true;
    const responseCode = Number(error?.responseCode);
    return responseCode === 421 || responseCode === 451 || responseCode === 454;
};

/** The provider telling us to slow down, rather than telling us anything about the address. */
const isRateLimited = error => {
    const code = Number(error?.responseCode);
    if (code === 421 || code === 450 || code === 451 || code === 452) return true;
    return /rate limit|too many|throttl|try again later|quota/i.test(String(error?.message || ''));
};

/** Exponential backoff, clamped: base * 2^(attempt - 1), never above `maxMs`. */
const backoffFor = (attempt, baseMs, maxMs) => Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);

export { isPermanentRejection, isTransportFailure, isRateLimited, backoffFor };
