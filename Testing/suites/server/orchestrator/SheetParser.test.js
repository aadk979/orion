import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
// Reached through the orchestrator's own node_modules: the Testing package
// deliberately has no dependencies of its own, and fixtures must be built with
// the exact library the parser will read them back with.
import ExcelJS from '../../../../Packages/server/Orion-Orchestrator/node_modules/exceljs/excel.js';

import {
    parseMailingSheet,
    SheetParseError,
    generateJobId,
    resolveColumn,
    normalizeHeader,
    parsePriority,
    JOB_ID_LENGTH,
    DEFAULT_PRIORITY
} from '../../../../Packages/server/Orion-Orchestrator/lib/Mailing/SheetParser.js';

/**
 * The parser is the gate between an operator's spreadsheet and mail actually
 * leaving the building. Everything it accepts gets sent; everything it rejects
 * costs someone a re-upload. Both directions are worth pinning.
 */

/** Builds a real .xlsx buffer — the parser is tested against the format it will meet. */
const buildSheet = async (headers, rows) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Recipients');
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
};

const BASE_HEADERS = ['recipient', 'subject', 'content'];
const baseRows = (count = 3) =>
    Array.from({ length: count }, (_, i) => [`user${i}@example.com`, `Subject ${i}`, `Hello number ${i}`]);

describe('parseMailingSheet — accepting a good sheet', () => {
    test('reads the required columns into rows', async () => {
        const parsed = await parseMailingSheet(await buildSheet(BASE_HEADERS, baseRows(3)), { filename: 'blast.xlsx' });

        assert.equal(parsed.rows.length, 3);
        assert.equal(parsed.rows[0].recipient, 'user0@example.com');
        assert.equal(parsed.rows[0].subject, 'Subject 0');
        assert.equal(parsed.rows[0].content, 'Hello number 0');
        assert.equal(parsed.rows[0].contentType, 'text');
    });

    test('a missing job id is generated at exactly the specified width', async () => {
        const parsed = await parseMailingSheet(await buildSheet(BASE_HEADERS, baseRows(2)), { filename: 'blast.xlsx' });

        assert.equal(parsed.generatedJobId, true);
        assert.equal(parsed.jobId.length, JOB_ID_LENGTH);
        assert.match(parsed.jobId, /^[A-Za-z0-9]{32}$/);
    });

    test('a supplied job id is kept as the job identity', async () => {
        const jobId = 'a'.repeat(32);
        const parsed = await parseMailingSheet(
            await buildSheet(['mailing_job_id', 'mailing_job_name', ...BASE_HEADERS], [[jobId, 'Spring launch', 'a@x.com', 'Hi', 'Body']]),
            { filename: 'blast.xlsx' }
        );

        assert.equal(parsed.jobId, jobId);
        assert.equal(parsed.generatedJobId, false);
        assert.equal(parsed.name, 'Spring launch');
    });

    test('the filename becomes the job name when the sheet does not carry one', async () => {
        const parsed = await parseMailingSheet(await buildSheet(BASE_HEADERS, baseRows(1)), { filename: 'october-newsletter.xlsx' });

        assert.equal(parsed.name, 'october-newsletter');
    });

    test('priority defaults to normal and accepts both numbers and words', async () => {
        const plain = await parseMailingSheet(await buildSheet(BASE_HEADERS, baseRows(1)), {});
        assert.equal(plain.priority, DEFAULT_PRIORITY);

        const numeric = await parseMailingSheet(await buildSheet([...BASE_HEADERS, 'priority'], [['a@x.com', 'S', 'B', 2]]), {});
        assert.equal(numeric.priority, 2);

        const worded = await parseMailingSheet(await buildSheet([...BASE_HEADERS, 'priority'], [['a@x.com', 'S', 'B', 'urgent']]), {});
        assert.equal(worded.priority, 1);
    });

    test('content_type html is carried through per row', async () => {
        const parsed = await parseMailingSheet(
            await buildSheet([...BASE_HEADERS, 'content_type'], [['a@x.com', 'S', '<p>Hi</p>', 'html']]),
            {}
        );

        assert.equal(parsed.rows[0].contentType, 'html');
    });

    test('blank trailing rows are ignored rather than treated as empty recipients', async () => {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('R');
        sheet.addRow(BASE_HEADERS);
        sheet.addRow(['a@x.com', 'S', 'B']);
        sheet.addRow(['', '', '']);
        const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

        const parsed = await parseMailingSheet(buffer, {});
        assert.equal(parsed.rows.length, 1);
    });
});

describe('parseMailingSheet — the extensibility contract', () => {
    test('unknown columns are kept as substitution tokens rather than rejected', async () => {
        const parsed = await parseMailingSheet(
            await buildSheet(
                [...BASE_HEADERS, 'first_name', 'account_tier', 'renewal_date'],
                [['a@x.com', 'Hi <first_name>', 'Your <account_tier> plan renews <renewal_date>', 'Ada', 'Gold', '2026-09-01']]
            ),
            {}
        );

        // This is what makes future nullable fields free: they arrive as data,
        // not as a schema change.
        assert.deepEqual(parsed.extraColumns, ['first_name', 'account_tier', 'renewal_date']);
        assert.deepEqual(parsed.rows[0].fields, { first_name: 'Ada', account_tier: 'Gold', renewal_date: '2026-09-01' });
    });

    test('an empty optional cell simply does not become a token for that row', async () => {
        const parsed = await parseMailingSheet(
            await buildSheet([...BASE_HEADERS, 'first_name'], [
                ['a@x.com', 'S', 'B', 'Ada'],
                ['b@x.com', 'S', 'B', '']
            ]),
            {}
        );

        assert.deepEqual(parsed.rows[0].fields, { first_name: 'Ada' });
        assert.deepEqual(parsed.rows[1].fields, {});
    });
});

describe('parseMailingSheet — rejecting a bad sheet', () => {
    const expectRejection = async (buffer, pattern) => {
        await assert.rejects(() => parseMailingSheet(buffer, {}), err => {
            assert.ok(err instanceof SheetParseError, `expected a SheetParseError, got ${err.constructor.name}`);
            const haystack = `${err.message} ${(err.details || []).join(' ')}`;
            assert.match(haystack, pattern);
            return true;
        });
    };

    test('a missing required column names which one', async () => {
        await expectRejection(await buildSheet(['recipient', 'subject'], [['a@x.com', 'S']]), /no "content" column/);
    });

    test('an invalid address is rejected with its row number', async () => {
        await expectRejection(await buildSheet(BASE_HEADERS, [['not-an-email', 'S', 'B']]), /row 2.*not a valid email/s);
    });

    test('a duplicate recipient is rejected — the same person would be mailed twice', async () => {
        await expectRejection(
            await buildSheet(BASE_HEADERS, [
                ['a@x.com', 'S', 'B'],
                ['A@X.com', 'S', 'B']
            ]),
            /already listed on row 2/
        );
    });

    test('two different job ids in one file is an error, not a silent split', async () => {
        await expectRejection(
            await buildSheet(['mailing_job_id', ...BASE_HEADERS], [
                ['a'.repeat(32), 'a@x.com', 'S', 'B'],
                ['b'.repeat(32), 'b@x.com', 'S', 'B']
            ]),
            /one file is one job/
        );
    });

    test('a job id of the wrong length is rejected', async () => {
        await expectRejection(await buildSheet(['mailing_job_id', ...BASE_HEADERS], [['short', 'a@x.com', 'S', 'B']]), /must be exactly 32/);
    });

    test('every problem is reported at once, so one upload finds them all', async () => {
        const buffer = await buildSheet(BASE_HEADERS, [
            ['bad-address', 'S', 'B'],
            ['also-bad', '', 'B'],
            ['worse', 'S', '']
        ]);

        await assert.rejects(
            () => parseMailingSheet(buffer, {}),
            err => {
                assert.ok(err.details.length >= 4, `expected several problems, got ${err.details.length}`);
                return true;
            }
        );
    });

    test('a header-only sheet is rejected rather than queued as an empty job', async () => {
        await expectRejection(await buildSheet(BASE_HEADERS, []), /no recipients/);
    });

    test('an empty buffer is refused', async () => {
        await assert.rejects(() => parseMailingSheet(Buffer.alloc(0), {}), /No file content/);
    });

    test('a sheet above the row ceiling is refused before it is loaded', async () => {
        // The ceiling is a parameter so this needs a 5-row fixture, not a huge one.
        const buffer = await buildSheet(BASE_HEADERS, baseRows(5));

        await assert.rejects(() => parseMailingSheet(buffer, { maxRows: 2 }), /above the 2-row ceiling/);
    });
});

describe('header resolution', () => {
    test('names are matched case- and punctuation-insensitively', () => {
        assert.equal(normalizeHeader('Mailing Job ID'), 'mailingjobid');
        assert.equal(normalizeHeader('mailing_job_id'), 'mailingjobid');
        assert.equal(normalizeHeader('mailingJobId'), 'mailingjobid');

        for (const header of ['Mailing Job ID', 'mailing_job_id', 'JobID', 'job-id']) {
            assert.equal(resolveColumn(header), 'jobId', `${header} should resolve to jobId`);
        }
    });

    test('common aliases for the required columns all resolve', () => {
        for (const header of ['recipient', 'Email', 'to', 'email address']) {
            assert.equal(resolveColumn(header), 'recipient', `${header} should resolve to recipient`);
        }
        for (const header of ['content', 'body', 'Message', 'mailing content']) {
            assert.equal(resolveColumn(header), 'content', `${header} should resolve to content`);
        }
    });

    test('an unrecognised header resolves to null so it is kept as a token', () => {
        assert.equal(resolveColumn('first_name'), null);
        assert.equal(resolveColumn('renewal date'), null);
    });
});

describe('parsePriority', () => {
    test('accepts the numeric range and rejects everything outside it', () => {
        assert.equal(parsePriority('1'), 1);
        assert.equal(parsePriority('9'), 9);
        assert.equal(parsePriority('0'), null);
        assert.equal(parsePriority('10'), null);
        assert.equal(parsePriority('high-ish'), null);
    });

    test('word forms map onto the range', () => {
        assert.equal(parsePriority('urgent'), 1);
        assert.equal(parsePriority('normal'), 5);
        assert.equal(parsePriority('bulk'), 9);
    });
});

describe('generateJobId', () => {
    test('is always exactly the specified width and alphanumeric', () => {
        for (let i = 0; i < 200; i++) {
            const id = generateJobId();
            assert.equal(id.length, JOB_ID_LENGTH);
            assert.match(id, /^[A-Za-z0-9]+$/);
        }
    });

    test('does not collide across a large sample', () => {
        const ids = new Set(Array.from({ length: 2000 }, () => generateJobId()));
        assert.equal(ids.size, 2000);
    });
});
