import { globalAccessPoint } from '../../GlobalAccessPoint.js';

/**
 * Token substitution for batch mail bodies and subjects.
 *
 * Uses the same <TOKEN> convention as Orion's transactional templates, so
 * operators who have written one already know this syntax.
 */

/** Substitution tokens the node always provides, on top of the sheet's own columns. */
const BUILTIN_TOKENS = ['RECIPIENT', 'EMAIL', 'JOBNAME', 'JOBID', 'APPNAME', 'DATE'];

/**
 * The sheet's own extra columns, plus the built-ins above.
 *
 * @param {object} row       a row from orch_mailing_recipients
 * @param {object} run       the GroupRun it belongs to
 * @param {object} mailConfig  the node's `utilities.batchMailer.mail` block
 */
const tokensFor = (row, run, mailConfig = {}) => {
    const systemConfig = globalAccessPoint.systemConfig();

    return {
        RECIPIENT: row.recipient,
        EMAIL: row.recipient,
        JOBNAME: run.jobName,
        JOBID: run.jobId,
        APPNAME: mailConfig.appName || systemConfig?.app?.appName || 'Orion',
        DATE: new Date().toISOString().slice(0, 10),
        // Sheet columns last: an operator's own column wins over a built-in
        // of the same name, because they put it there on purpose.
        ...(row.fields && typeof row.fields === 'object' ? row.fields : {})
    };
};

/**
 * Replaces <TOKEN> with its value. Unknown tokens are left exactly as they
 * are rather than blanked — a visible <FIRSTNAME> in a delivered mail is a
 * bug an operator can see and fix, whereas a silent empty space in a
 * greeting is one they will not notice until a customer does.
 */
const substitute = (template, tokens) => {
    if (typeof template !== 'string' || !template.includes('<')) return template;

    return template.replace(/<([A-Za-z0-9_ .-]{1,64})>/g, (match, name) => {
        const key = String(name).trim();
        if (Object.prototype.hasOwnProperty.call(tokens, key)) return String(tokens[key] ?? '');

        const upper = key.toUpperCase().replace(/[\s-]+/g, '_');
        const found = Object.keys(tokens).find(k => k.toUpperCase().replace(/[\s-]+/g, '_') === upper);
        return found ? String(tokens[found] ?? '') : match;
    });
};

export { BUILTIN_TOKENS, tokensFor, substitute };
