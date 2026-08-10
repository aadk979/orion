#!/usr/bin/env node
/**
 * Generates examples/mailing-job.example.xlsx — a filled-in template operators
 * can copy for a batch mailing job.
 *
 * Regenerate with:  node examples/make-mailing-sheet.mjs
 *
 * The sheet is deliberately a WORKING example rather than an empty header row:
 * it shows the token substitution, the optional columns, and the fact that any
 * unrecognised column simply becomes another token.
 */

import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'mailing-job.example.xlsx');

const COLUMNS = [
    { header: 'mailing_job_id', width: 36, note: 'Exactly 32 characters. Leave every row blank to have one generated.' },
    { header: 'mailing_job_name', width: 26, note: 'The same on every row — one file is one job.' },
    { header: 'priority', width: 10, note: '1-9, lower is more urgent. Orders the queue; does not interrupt a running job.' },
    { header: 'recipient', width: 30, note: 'Required.' },
    { header: 'subject', width: 40, note: 'Required. <TOKEN> substitution applies here too.' },
    { header: 'content', width: 64, note: 'Required. The mail body, verbatim.' },
    { header: 'content_type', width: 14, note: 'text (default) or html.' },
    { header: 'first_name', width: 16, note: 'Not a known column — becomes the <first_name> token.' },
    { header: 'account_tier', width: 14, note: 'Likewise <account_tier>.' },
    { header: 'renewal_date', width: 16, note: 'Likewise <renewal_date>. Add as many as you need.' }
];

const ROWS = [
    [
        '',
        'October renewal notice',
        3,
        'ada@example.com',
        '<first_name>, your <account_tier> plan renews soon',
        'Hi <first_name>,\n\nYour <account_tier> plan renews on <renewal_date>. Nothing is required from you — this is a courtesy note.\n\n— The <APPNAME> team',
        'text',
        'Ada',
        'Gold',
        '2026-10-14'
    ],
    [
        '',
        'October renewal notice',
        3,
        'grace@example.com',
        '<first_name>, your <account_tier> plan renews soon',
        'Hi <first_name>,\n\nYour <account_tier> plan renews on <renewal_date>. Nothing is required from you — this is a courtesy note.\n\n— The <APPNAME> team',
        'text',
        'Grace',
        'Silver',
        '2026-10-21'
    ],
    [
        '',
        'October renewal notice',
        3,
        'alan@example.com',
        '<first_name>, your <account_tier> plan renews soon',
        'Hi <first_name>,\n\nYour <account_tier> plan renews on <renewal_date>. Nothing is required from you — this is a courtesy note.\n\n— The <APPNAME> team',
        'text',
        'Alan',
        'Gold',
        '2026-10-28'
    ]
];

const workbook = new ExcelJS.Workbook();
workbook.creator = 'Orion Orchestrator';

// ── Recipients ──────────────────────────────────────────────────────────────
const sheet = workbook.addWorksheet('Recipients');
sheet.columns = COLUMNS.map(c => ({ header: c.header, key: c.header, width: c.width }));
sheet.getRow(1).font = { bold: true };
sheet.getRow(1).alignment = { vertical: 'middle' };

for (const row of ROWS) sheet.addRow(row);

// Bodies contain newlines; without wrapping they render as one unreadable line.
sheet.getColumn('content').alignment = { wrapText: true, vertical: 'top' };
sheet.getColumn('subject').alignment = { wrapText: true, vertical: 'top' };
for (let i = 2; i <= ROWS.length + 1; i++) sheet.getRow(i).height = 64;

sheet.views = [{ state: 'frozen', ySplit: 1 }];

// ── Notes ───────────────────────────────────────────────────────────────────
// A second sheet rather than cell comments: the parser reads the FIRST sheet
// with rows, so anything here is documentation and can never be mistaken for
// a recipient.
const notes = workbook.addWorksheet('How this works');
notes.columns = [
    { header: 'Column', key: 'column', width: 24 },
    { header: 'What it does', key: 'note', width: 100 }
];
notes.getRow(1).font = { bold: true };

for (const column of COLUMNS) notes.addRow({ column: column.header, note: column.note });

notes.addRow({});
notes.addRow({ column: 'Built-in tokens', note: '<RECIPIENT> <EMAIL> <JOBNAME> <JOBID> <APPNAME> <DATE> are always available.' });
notes.addRow({ column: 'Unknown tokens', note: 'A <TOKEN> with no matching column is left visible in the mail rather than blanked — so you can spot it.' });
notes.addRow({ column: 'Header names', note: 'Matched case- and punctuation-insensitively: "Mailing Job ID", mailing_job_id and mailingJobId are the same column.' });
notes.addRow({ column: 'Duplicates', note: 'The same address twice in one file is rejected — it would mean two identical mails.' });
notes.addRow({ column: 'Validation', note: 'All-or-nothing: a file with any bad row is rejected in full, with every problem listed. Nothing is queued.' });
notes.addRow({ column: 'CSV', note: 'A .csv with the same header row is accepted through the same endpoint.' });

await workbook.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT}`);
