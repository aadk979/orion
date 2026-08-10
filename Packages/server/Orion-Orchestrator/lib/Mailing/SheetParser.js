/**
 * SheetParser — turns an uploaded spreadsheet into a validated mailing job.
 *
 * One parser serves both entry points. The panel POSTs the file bytes; orionctl
 * reads the path locally and POSTs the same bytes. Neither one parses anything
 * itself, so "what the sheet may contain" has exactly one definition.
 *
 * ── Columns ─────────────────────────────────────────────────────────────────
 * Required (per row):
 *   recipient          the destination address
 *   subject            the mail subject
 *   content            the mail BODY, verbatim
 *
 * Job-level (constant across every row of the file):
 *   mailing_job_id     32-char id. Leave the column out, or blank on every row,
 *                      and one is generated. Two different ids in one file is a
 *                      parse error, not a silent split.
 *   mailing_job_name   human label for the blast
 *   priority           1..9, lower is more urgent (default 5)
 *
 * Optional:
 *   content_type       'text' (default) or 'html'
 *
 * ANY other column is kept as-is and offered to the node as a <COLUMN_NAME>
 * substitution token in the subject and body. That is the extension point: a
 * new nullable field needs no migration and no code change, because unknown
 * columns are data rather than errors.
 *
 * Header names are matched case-insensitively and punctuation-insensitively, so
 * "Mailing Job ID", "mailing_job_id" and "mailingJobId" are the same column.
 */

import ExcelJS from 'exceljs';
import crypto from 'crypto';

/** Sheets above this are refused outright rather than half-parsed into memory. */
const MAX_ROWS = 250_000;
const MAX_CONTENT_LENGTH = 200_000;
const MAX_SUBJECT_LENGTH = 998; // RFC 5322 line-length ceiling for a header
const JOB_ID_LENGTH = 32;

const DEFAULT_PRIORITY = 5;

const JOB_ID_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * A job id is exactly 32 characters — the same shape whether an operator typed
 * one into the sheet or we generated it. r-sync's generateId is not used here
 * because it decorates its output with a type prefix, and a fixed-width id an
 * operator can paste into a spreadsheet cell is the whole point of the field.
 */
const generateJobId = () => {
    // Reject bytes in the non-uniform tail so every character is equally likely,
    // refilling as needed rather than assuming one draw is enough.
    const ceiling = 256 - (256 % JOB_ID_CHARSET.length);
    let out = '';
    while (out.length < JOB_ID_LENGTH) {
        for (const byte of crypto.randomBytes(JOB_ID_LENGTH)) {
            if (byte >= ceiling) continue;
            out += JOB_ID_CHARSET[byte % JOB_ID_CHARSET.length];
            if (out.length === JOB_ID_LENGTH) break;
        }
    }
    return out;
};

/** Normalises a header cell to its canonical key: "Mailing Job ID" → "mailingjobid". */
const normalizeHeader = value =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s_\-.]+/g, '');

/** Canonical key → the aliases operators actually type. */
const COLUMN_ALIASES = Object.freeze({
    jobId: ['mailingjobid', 'jobid', 'id', 'batchid'],
    jobName: ['mailingjobname', 'jobname', 'name', 'batchname', 'campaign', 'campaignname'],
    recipient: ['recipient', 'email', 'to', 'recipientemail', 'emailaddress', 'address'],
    subject: ['subject', 'mailsubject', 'emailsubject', 'title'],
    content: ['content', 'mailingcontent', 'body', 'mailbody', 'emailbody', 'message', 'text'],
    priority: ['priority', 'jobpriority'],
    contentType: ['contenttype', 'type', 'bodytype', 'format']
});

const KNOWN_KEYS = Object.keys(COLUMN_ALIASES);

/** The canonical key a header maps to, or null when it is a free-form extra column. */
const resolveColumn = header => {
    const normalized = normalizeHeader(header);
    if (!normalized) return null;
    for (const key of KNOWN_KEYS) {
        if (COLUMN_ALIASES[key].includes(normalized)) return key;
    }
    return null;
};

class SheetParseError extends Error {
    constructor(message, details = []) {
        super(message);
        this.code = 'MAILING::SHEET-INVALID';
        this.details = details;
    }
}

/**
 * ExcelJS hands back rich cell objects for formulas, hyperlinks and rich text.
 * Flatten every shape to the plain string a mail actually needs.
 */
const cellText = value => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        // { text, hyperlink } — an email typed into a cell autolinks, and the
        // hyperlink then reads "mailto:someone@x.com". The visible text is what
        // the operator meant.
        if (typeof value.text === 'string') return value.text.trim();
        if (Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('').trim();
        // { formula, result } — use what the spreadsheet computed.
        if (value.result !== undefined) return cellText(value.result);
        if (value.error) return '';
        return '';
    }
    return String(value).trim();
};

/** Deliberately permissive — the SMTP server is the real authority on an address. */
const looksLikeEmail = value => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value);

const parsePriority = raw => {
    if (raw === '') return null;
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 9) return numeric;

    // Word forms, because a spreadsheet column called "priority" invites them.
    const word = String(raw).toLowerCase();
    if (['urgent', 'critical', 'highest'].includes(word)) return 1;
    if (['high'].includes(word)) return 2;
    if (['normal', 'medium', 'default'].includes(word)) return 5;
    if (['low'].includes(word)) return 7;
    if (['lowest', 'bulk', 'background'].includes(word)) return 9;
    return null;
};

/**
 * Reads the workbook into { headers, rows } of plain strings.
 * CSV is accepted through the same path — ExcelJS reads it natively — so an
 * operator who exported to CSV is not turned away.
 */
const readWorkbook = async (buffer, filename = '') => {
    const workbook = new ExcelJS.Workbook();

    if (/\.csv$/i.test(filename)) {
        const { Readable } = await import('stream');
        await workbook.csv.read(Readable.from(buffer));
    } else {
        await workbook.xlsx.load(buffer);
    }

    const sheet = workbook.worksheets.find(ws => ws.rowCount > 0);
    if (!sheet) throw new SheetParseError('The uploaded file contains no worksheet with any rows');

    const headerRow = sheet.getRow(1);
    const headers = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col - 1] = cellText(cell.value);
    });

    if (headers.filter(Boolean).length === 0) {
        throw new SheetParseError('Row 1 must be a header row naming the columns (recipient, subject, content, …)');
    }

    return { sheet, headers };
};

/**
 * Parses and validates an uploaded sheet.
 *
 * Validation is all-or-nothing: a file with bad rows is rejected with every
 * problem listed at once, rather than partially accepted. A half-loaded blast
 * is worse than a rejected one — the operator would have no way to tell which
 * half made it in.
 *
 * @param {Buffer} buffer
 * @param {{ filename?: string, maxRows?: number }} options
 * @returns {Promise<{ jobId, name, priority, generatedJobId, rows, extraColumns, filename }>}
 */
const parseMailingSheet = async (buffer, { filename = '', maxRows = MAX_ROWS } = {}) => {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new SheetParseError('No file content was received');
    }

    const { sheet, headers } = await readWorkbook(buffer, filename);

    // column index → canonical key (or null for a pass-through extra)
    const columnMap = headers.map(resolveColumn);
    const extraColumns = headers.map((header, i) => (columnMap[i] === null && header ? header : null)).filter(Boolean);

    for (const required of ['recipient', 'subject', 'content']) {
        if (!columnMap.includes(required)) {
            throw new SheetParseError(
                `The sheet has no "${required}" column. Required columns are recipient, subject and content; ` +
                    `found: ${headers.filter(Boolean).join(', ') || '(none)'}`
            );
        }
    }

    const errors = [];
    const rows = [];
    const seenRecipients = new Map();
    const jobIds = new Set();
    const jobNames = new Set();
    const jobPriorities = new Set();

    const dataRowCount = sheet.rowCount - 1;
    if (dataRowCount > maxRows) {
        throw new SheetParseError(`The sheet has ${dataRowCount} data rows, above the ${maxRows}-row ceiling for a single job`);
    }

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return; // header
        if (errors.length >= 50) return; // enough to act on; stop collecting

        const record = { recipient: '', subject: '', content: '', contentType: '', priority: '', jobId: '', jobName: '' };
        const fields = {};

        row.eachCell({ includeEmpty: false }, (cell, col) => {
            const key = columnMap[col - 1];
            const text = cellText(cell.value);
            if (key) {
                record[key] = text;
            } else if (headers[col - 1] && text !== '') {
                fields[headers[col - 1]] = text;
            }
        });

        // A trailing formatted-but-empty row is not an error, it is nothing.
        const isBlank = !record.recipient && !record.subject && !record.content;
        if (isBlank) return;

        const where = `row ${rowNumber}`;

        if (!record.recipient) {
            errors.push(`${where}: recipient is empty`);
        } else if (!looksLikeEmail(record.recipient)) {
            errors.push(`${where}: "${record.recipient}" is not a valid email address`);
        }
        if (!record.subject) errors.push(`${where}: subject is empty`);
        if (record.subject.length > MAX_SUBJECT_LENGTH) errors.push(`${where}: subject exceeds ${MAX_SUBJECT_LENGTH} characters`);
        if (!record.content) errors.push(`${where}: content is empty`);
        if (record.content.length > MAX_CONTENT_LENGTH) errors.push(`${where}: content exceeds ${MAX_CONTENT_LENGTH} characters`);

        const contentType = record.contentType ? record.contentType.toLowerCase() : 'text';
        if (!['text', 'html'].includes(contentType)) {
            errors.push(`${where}: content_type "${record.contentType}" must be "text" or "html"`);
        }

        if (record.jobId) jobIds.add(record.jobId);
        if (record.jobName) jobNames.add(record.jobName);

        if (record.priority) {
            const parsed = parsePriority(record.priority);
            if (parsed === null) {
                errors.push(`${where}: priority "${record.priority}" must be 1–9 (1 = most urgent) or one of urgent/high/normal/low/bulk`);
            } else {
                jobPriorities.add(parsed);
            }
        }

        // The same address twice in one blast means two identical mails. Almost
        // always a copy-paste accident, and expensive to discover after sending.
        const addressKey = record.recipient.toLowerCase();
        if (seenRecipients.has(addressKey)) {
            errors.push(`${where}: "${record.recipient}" is already listed on row ${seenRecipients.get(addressKey)}`);
        } else {
            seenRecipients.set(addressKey, rowNumber);
        }

        rows.push({
            rowNumber,
            recipient: record.recipient,
            subject: record.subject,
            content: record.content,
            contentType,
            priority: record.priority ? parsePriority(record.priority) : null,
            fields
        });
    });

    if (rows.length === 0 && errors.length === 0) {
        throw new SheetParseError('The sheet has a header row but no recipients');
    }

    // ── Job-level consistency ───────────────────────────────────────────────
    if (jobIds.size > 1) {
        errors.push(
            `the sheet carries ${jobIds.size} different mailing job ids (${[...jobIds].slice(0, 3).join(', ')}…) — ` +
                'one file is one job, so every row must repeat the same id or leave it blank'
        );
    }
    if (jobNames.size > 1) {
        errors.push(`the sheet carries ${jobNames.size} different mailing job names — one file is one job`);
    }
    if (jobPriorities.size > 1) {
        errors.push(`the sheet carries ${jobPriorities.size} different priorities (${[...jobPriorities].join(', ')}) — priority is a property of the job`);
    }

    const [suppliedJobId] = jobIds;
    if (suppliedJobId && suppliedJobId.length !== JOB_ID_LENGTH) {
        errors.push(`mailing job id "${suppliedJobId}" is ${suppliedJobId.length} characters — it must be exactly ${JOB_ID_LENGTH}`);
    }
    if (suppliedJobId && !/^[A-Za-z0-9_-]+$/.test(suppliedJobId)) {
        errors.push(`mailing job id "${suppliedJobId}" may only contain letters, digits, "-" and "_"`);
    }

    if (errors.length > 0) {
        throw new SheetParseError(
            `The sheet has ${errors.length} problem${errors.length === 1 ? '' : 's'} and was not accepted — nothing was queued`,
            errors
        );
    }

    const [suppliedName] = jobNames;
    const [suppliedPriority] = jobPriorities;

    return {
        jobId: suppliedJobId || generateJobId(),
        generatedJobId: !suppliedJobId,
        name: suppliedName || (filename ? filename.replace(/\.[^.]+$/, '') : 'Untitled mailing job'),
        priority: suppliedPriority ?? DEFAULT_PRIORITY,
        rows,
        extraColumns,
        filename: filename || null
    };
};

export {
    parseMailingSheet,
    SheetParseError,
    generateJobId,
    resolveColumn,
    normalizeHeader,
    parsePriority,
    cellText,
    COLUMN_ALIASES,
    JOB_ID_LENGTH,
    DEFAULT_PRIORITY,
    MAX_ROWS
};
