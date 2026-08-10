/**
 * The one error type the mailing plane raises at its API boundary.
 *
 * It carries an HTTP status because AdminServer translates it straight into a
 * response without importing anything from this directory — see the error
 * handler there, which matches on shape rather than on class.
 */
class MailingError extends Error {
    constructor(code, message, status = 400, details = null) {
        super(message);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export { MailingError };
