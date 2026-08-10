import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    BatchMailerSystem,
    SlidingRateLimiter,
    isPermanentRejection,
    isTransportFailure,
    isRateLimited,
    backoffFor
} from '../../../../Packages/server/Orion-core/lib/Utils/Systems/BatchMailer/index.js';
import { hasTransportConfig } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/BatchMailer/transport.js';
import { reportProgress } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/BatchMailer/reporting.js';
import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';

// Read by token substitution; locked GAP keys are write-once per process.
globalAccessPoint.setValue('systemConfig', { app: { serviceID: 'svc-test', appName: 'TestNode', port: 12345 } });

/**
 * The node is where a mail actually leaves the building, so its two guarantees
 * are worth pinning hard:
 *
 *   - it never exceeds its send budget, and
 *   - every recipient it touches reaches a terminal state, exactly once.
 *
 * The second is what stops a blast from mailing someone twice, and what stops
 * the orchestrator's watchdog from reassigning a poison address forever.
 */

// ── Test doubles ─────────────────────────────────────────────────────────────

/**
 * An in-memory stand-in for the two mailing tables, enforcing the same
 * invariant the SQL does: the archive insert and the queue delete move together.
 */
const makeFakeDb = (rows = []) => {
    const state = {
        recipients: rows.map(r => ({ attempts: 0, last_error: null, content_type: 'text', fields: {}, ...r })),
        archive: [],
        queries: []
    };

    return {
        state,
        async query(text, params) {
            state.queries.push({ text, params });

            if (text.includes('SELECT id, recipient')) {
                const [jobId, groupNumber, workerId, limit] = params;
                return {
                    rows: state.recipients
                        .filter(r => r.job_id === jobId && r.group_number === groupNumber && r.locked_by === workerId)
                        .slice(0, limit)
                };
            }

            if (text.includes('count(*)::int AS remaining')) {
                const [jobId, groupNumber] = params;
                return { rows: [{ remaining: state.recipients.filter(r => r.job_id === jobId && r.group_number === groupNumber).length }] };
            }

            if (text.startsWith('UPDATE orch_mailing_recipients SET attempts')) {
                const [id, attempts, error] = params;
                const row = state.recipients.find(r => r.id === id);
                if (row) {
                    row.attempts = attempts;
                    row.last_error = error;
                }
                return { rowCount: row ? 1 : 0 };
            }

            if (text.includes('DELETE FROM orch_mailing_recipients WHERE id')) {
                const [id, outcome, attempts, error, , workerId] = params;
                // Mirrors the real statement's `AND locked_by = $6` fencing
                // token: a node whose lease moved on retires nothing.
                const index = state.recipients.findIndex(r => r.id === id && r.locked_by === workerId);
                if (index === -1) return { rowCount: 0 };

                const [row] = state.recipients.splice(index, 1);
                state.archive.push({
                    job_id: row.job_id,
                    group_number: row.group_number,
                    recipient: row.recipient,
                    outcome,
                    attempts,
                    error,
                    worker_id: row.locked_by
                });
                return { rowCount: 1 };
            }

            throw new Error(`unexpected query in test: ${text.slice(0, 60)}`);
        }
    };
};

/** A cluster link that records what was emitted upstream. */
const makeFakeLink = () => {
    const emitted = [];
    return {
        emitted,
        connected: true,
        rsync: { workerId: 'WKR_test' },
        protocol: {
            ClusterEvents: { MAILING_PROGRESS: 'orion:mailing:progress', MAILING_GROUP_DONE: 'orion:mailing:group-done' },
            buildMailingProgress: (jobId, groupNumber, counts) => ({ jobId, groupNumber, ...counts }),
            buildMailingGroupDone: (jobId, groupNumber, outcome, counts) => ({ jobId, groupNumber, outcome, ...counts })
        },
        async emitToOrchestrator(name, data) {
            emitted.push({ name, data });
        }
    };
};

/**
 * Builds a mailer wired to fakes.
 *
 * The database and cluster-link lookups are bound per instance rather than
 * through the GlobalAccessPoint: locked GAP keys are write-once per process,
 * and node:test runs sibling suites concurrently, so a shared global would have
 * tests clobbering each other's fixtures.
 *
 * Sleeping is stubbed out — what is under test is the SEQUENCE of attempts, not
 * how long the backoff waits, and real backoff would make this suite take
 * minutes.
 */
const makeMailer = (rows, sendImpl, config = {}) => {
    const db = makeFakeDb(rows);
    const link = makeFakeLink();

    const mailer = new BatchMailerSystem({
        enabled: true,
        mail: { service: 'test', email: 'bulk@example.com', from: 'Bulk <bulk@example.com>' },
        backoffBaseMs: 1,
        backoffMaxMs: 2,
        progressIntervalMs: 60_000,
        ...config
    });

    const sent = [];
    mailer.transporter = {
        async sendMail(mail) {
            sent.push(mail);
            return sendImpl(mail, sent.length);
        },
        close() {}
    };
    mailer._sleep = () => Promise.resolve();
    mailer._query = (text, params) => db.query(text, params);
    mailer._link = () => link;
    mailer._workerId = () => 'WKR_test';

    return { mailer, db, link, sent };
};

const ROWS = [
    { id: 1, job_id: 'JOB1', group_number: 1, recipient: 'a@x.com', subject: 'Hi <FIRST>', content: 'Hello <FIRST>', locked_by: 'WKR_test', row_number: 2, fields: { FIRST: 'Ada' } },
    { id: 2, job_id: 'JOB1', group_number: 1, recipient: 'b@x.com', subject: 'Hi', content: 'Hello', locked_by: 'WKR_test', row_number: 3 },
    { id: 3, job_id: 'JOB1', group_number: 1, recipient: 'c@x.com', subject: 'Hi', content: 'Hello', locked_by: 'WKR_test', row_number: 4 }
];

const assign = (mailer, overrides = {}) => mailer.acceptGroup({ jobId: 'JOB1', jobName: 'Test blast', groupNumber: 1, recipientCount: 3, ...overrides });

/** Waits for the background group run to finish. */
const settle = async (mailer, maxTicks = 500) => {
    for (let i = 0; i < maxTicks && mailer._active.size > 0; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
};

// ── Rate limiter ─────────────────────────────────────────────────────────────

describe('SlidingRateLimiter — the send budget', () => {
    test('allows a full window of sends, then blocks until the oldest expires', () => {
        const limiter = new SlidingRateLimiter(15, 120_000);
        const t0 = 1_000_000;

        for (let i = 0; i < 15; i++) {
            assert.equal(limiter.delayUntilAllowed(t0), 0, `send ${i + 1} of 15 should be allowed immediately`);
            limiter.record(t0);
        }

        assert.equal(limiter.delayUntilAllowed(t0), 120_000, 'the 16th send waits the full window');
        assert.equal(limiter.delayUntilAllowed(t0 + 119_999), 1, 'and is released exactly when the oldest falls out');
        assert.equal(limiter.delayUntilAllowed(t0 + 120_000), 0);
    });

    test('waiting resolves as soon as the window has room, and not before', async () => {
        const limiter = new SlidingRateLimiter(2, 1000);
        const slept = [];
        // A stand-in for sleeping that also advances the limiter's clock, so the
        // loop terminates the way real elapsed time would make it terminate.
        const sleep = async ms => {
            slept.push(ms);
            for (const _ of limiter.timestamps) void _;
            limiter.timestamps = limiter.timestamps.map(t => t - ms);
        };

        limiter.record();
        limiter.record();
        assert.ok(limiter.delayUntilAllowed() > 0, 'the window is full');

        await limiter.wait(sleep);

        assert.equal(slept.length, 1, 'it waits exactly until the oldest send falls out — no polling');
        assert.equal(limiter.delayUntilAllowed(), 0);
    });

    test('an empty window does not wait at all', async () => {
        const limiter = new SlidingRateLimiter(5, 1000);
        let slept = false;

        await limiter.wait(async () => {
            slept = true;
        });

        // A node that has been idle can send its next full window immediately.
        assert.equal(slept, false);
    });

    test('the window slides — it is not a fixed bucket that refills all at once', () => {
        const limiter = new SlidingRateLimiter(3, 1000);

        limiter.record(0);
        limiter.record(500);
        limiter.record(900);

        // At t=1000 only the first has aged out, so exactly one slot opens.
        assert.equal(limiter.delayUntilAllowed(1000), 0);
        limiter.record(1000);
        assert.equal(limiter.delayUntilAllowed(1000), 500, 'the next slot opens when the t=500 send ages out');
    });

    test('an idle node may burst its whole budget immediately', () => {
        const limiter = new SlidingRateLimiter(15, 120_000);
        for (let i = 0; i < 15; i++) limiter.record(0);

        assert.equal(limiter.delayUntilAllowed(200_000), 0, 'after a long idle period the budget is fully clear');
    });
});

// ── Failure classification ───────────────────────────────────────────────────

describe('failure classification', () => {
    test('a 5xx or "user unknown" is permanent — retrying only wastes budget', () => {
        assert.equal(isPermanentRejection({ responseCode: 550 }), true);
        assert.equal(isPermanentRejection({ responseCode: 553 }), true);
        assert.equal(isPermanentRejection({ message: 'Recipient address rejected: User unknown' }), true);

        assert.equal(isPermanentRejection({ responseCode: 421 }), false, '4xx is temporary');
        assert.equal(isPermanentRejection({ code: 'ECONNRESET' }), false);
    });

    test('connection errors are about the transport, not the address', () => {
        assert.equal(isTransportFailure({ code: 'ECONNREFUSED' }), true);
        assert.equal(isTransportFailure({ code: 'EAUTH' }), true);
        assert.equal(isTransportFailure({ responseCode: 421 }), true);

        // A bad mailbox must never count towards "the server is down".
        assert.equal(isTransportFailure({ responseCode: 550 }), false);
    });
});

// ── The send loop ────────────────────────────────────────────────────────────

describe('BatchMailerSystem — a clean run', () => {
    test('sends every recipient, archives each as sent, and empties the queue', async () => {
        const { mailer, db, sent } = makeMailer(ROWS, () => ({ messageId: 'ok' }));

        const accepted = assign(mailer);
        assert.equal(accepted.accepted, true);

        await settle(mailer);

        assert.equal(sent.length, 3);
        assert.equal(db.state.recipients.length, 0, 'the queue is drained');
        assert.equal(db.state.archive.length, 3, 'every recipient has a delivery record');
        assert.ok(db.state.archive.every(a => a.outcome === 'sent'));
    });

    test('substitutes sheet columns into the subject and body', async () => {
        const { mailer, sent } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        assign(mailer);
        await settle(mailer);

        const first = sent.find(m => m.to === 'a@x.com');
        assert.equal(first.subject, 'Hi Ada');
        assert.equal(first.text, 'Hello Ada');
    });

    test('reports the group complete exactly once, with its counts', async () => {
        const { mailer, link } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        assign(mailer);
        await settle(mailer);

        const done = link.emitted.filter(e => e.name === 'orion:mailing:group-done');
        assert.equal(done.length, 1);
        assert.equal(done[0].data.outcome, 'completed');
        assert.equal(done[0].data.sent, 3);
        assert.equal(done[0].data.failed, 0);
        assert.equal(done[0].data.remaining, 0);
    });

    test('html content is sent as html rather than as text', async () => {
        const rows = [{ ...ROWS[1], content: '<p>Hi</p>', content_type: 'html' }];
        const { mailer, sent } = makeMailer(rows, () => ({ messageId: 'ok' }));
        assign(mailer, { recipientCount: 1 });
        await settle(mailer);

        assert.equal(sent[0].html, '<p>Hi</p>');
        assert.equal(sent[0].text, undefined);
    });

    test('the send budget is charged once per delivered mail', async () => {
        const { mailer } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        assign(mailer);
        await settle(mailer);

        assert.equal(mailer._limiter.timestamps.length, 3);
    });
});

describe('BatchMailerSystem — retries and dead-lettering', () => {
    test('a transient failure is retried and then succeeds', async () => {
        let attempts = 0;
        const { mailer, db } = makeMailer([ROWS[1]], () => {
            attempts += 1;
            if (attempts < 3) throw Object.assign(new Error('temporary'), { responseCode: 451 });
            return { messageId: 'ok' };
        });

        assign(mailer, { recipientCount: 1, maxAttempts: 3 });
        await settle(mailer);

        assert.equal(db.state.archive.length, 1);
        assert.equal(db.state.archive[0].outcome, 'sent');
        assert.equal(db.state.recipients.length, 0);
    });

    test('a recipient that fails every attempt is dead-lettered, not left in the queue', async () => {
        const { mailer, db } = makeMailer([ROWS[1]], () => {
            throw Object.assign(new Error('mailbox full'), { responseCode: 452 });
        });

        assign(mailer, { recipientCount: 1, maxAttempts: 3 });
        await settle(mailer);

        // This is the invariant that lets a job finish: a poison address leaves
        // the queue rather than being reassigned by the watchdog forever.
        assert.equal(db.state.recipients.length, 0, 'the row must not survive its attempt budget');
        assert.equal(db.state.archive.length, 1);
        assert.equal(db.state.archive[0].outcome, 'failed');
        assert.match(db.state.archive[0].error, /mailbox full/);
    });

    test('a permanent rejection is dead-lettered immediately, without burning retries', async () => {
        let calls = 0;
        const { mailer, db } = makeMailer([ROWS[1]], () => {
            calls += 1;
            throw Object.assign(new Error('User unknown'), { responseCode: 550 });
        });

        assign(mailer, { recipientCount: 1, maxAttempts: 3 });
        await settle(mailer);

        assert.equal(calls, 1, 'no number of retries fixes a nonexistent mailbox');
        assert.equal(db.state.archive[0].outcome, 'failed');
    });

    test('one bad address does not stop the rest of the group', async () => {
        const { mailer, db } = makeMailer(ROWS, mail => {
            if (mail.to === 'b@x.com') throw Object.assign(new Error('User unknown'), { responseCode: 550 });
            return { messageId: 'ok' };
        });

        assign(mailer);
        await settle(mailer);

        assert.equal(db.state.recipients.length, 0);
        assert.equal(db.state.archive.filter(a => a.outcome === 'sent').length, 2);
        assert.equal(db.state.archive.filter(a => a.outcome === 'failed').length, 1);
    });

    test('attempt counts are persisted between retries so a crash does not restart the budget', async () => {
        let attempts = 0;
        // ETIMEDOUT is transient but NOT a throttle reply, so it consumes the
        // retry budget — which is the path that has to persist its count.
        const { mailer, db } = makeMailer([ROWS[1]], () => {
            attempts += 1;
            if (attempts < 3) throw Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
            return { messageId: 'ok' };
        });

        assign(mailer, { recipientCount: 1, maxAttempts: 3 });
        await settle(mailer);

        const attemptWrites = db.state.queries.filter(q => q.text.startsWith('UPDATE orch_mailing_recipients SET attempts'));
        assert.ok(attemptWrites.length >= 1, 'the attempt count must be written before backing off');
        assert.equal(db.state.archive[0].outcome, 'sent', 'the third attempt still succeeds');
    });

    test('a throttle reply is charged to the send budget, not to the retry budget', async () => {
        let calls = 0;
        const { mailer, db } = makeMailer([ROWS[1]], () => {
            calls += 1;
            // Four throttles in a row would exhaust a 3-attempt budget if they
            // counted as attempts. They must not: being told to slow down says
            // nothing about the address.
            if (calls <= 4) throw Object.assign(new Error('too many messages'), { responseCode: 421 });
            return { messageId: 'ok' };
        });

        assign(mailer, { recipientCount: 1, maxAttempts: 3 });
        await settle(mailer);

        assert.equal(db.state.archive[0].outcome, 'sent');
        assert.equal(calls, 5);
    });
});

describe('BatchMailerSystem — a dead transport', () => {
    test('the group is abandoned rather than burned through against a broken server', async () => {
        const rows = Array.from({ length: 40 }, (_, i) => ({
            id: 100 + i,
            job_id: 'JOB1',
            group_number: 1,
            recipient: `u${i}@x.com`,
            subject: 'S',
            content: 'B',
            locked_by: 'WKR_test',
            row_number: i + 2
        }));

        const { mailer, db, link } = makeMailer(rows, () => {
            throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        }, { consecutiveFailureAbort: 5, maxAttempts: 2 });

        assign(mailer, { recipientCount: 40 });
        await settle(mailer);

        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        assert.equal(done.data.outcome, 'failed', 'the group is handed back, not reported complete');
        assert.match(done.data.error, /consecutive/i);

        // Most of the group is untouched and can go to a healthy node.
        assert.ok(db.state.recipients.length > 30, `expected the bulk of the group to survive, ${db.state.recipients.length} left`);
    });

    test('a run of bad addresses does NOT look like a dead transport', async () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({
            id: 200 + i,
            job_id: 'JOB1',
            group_number: 1,
            recipient: `u${i}@x.com`,
            subject: 'S',
            content: 'B',
            locked_by: 'WKR_test',
            row_number: i + 2
        }));

        const { mailer, db, link } = makeMailer(rows, () => {
            throw Object.assign(new Error('User unknown'), { responseCode: 550 });
        }, { consecutiveFailureAbort: 5, maxAttempts: 2 });

        assign(mailer, { recipientCount: 12 });
        await settle(mailer);

        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        assert.equal(done.data.outcome, 'completed', 'twelve bad addresses is a drained group, not a broken server');
        assert.equal(db.state.recipients.length, 0);
        assert.equal(db.state.archive.filter(a => a.outcome === 'failed').length, 12);
    });
});

describe('BatchMailerSystem — losing the lease mid-send', () => {
    test('stops the moment a retire matches nothing, rather than duplicating another node\'s mail', async () => {
        const { mailer, db, link, sent } = makeMailer(ROWS, () => ({ messageId: 'ok' }));

        // After the first send, the orchestrator concludes this node is gone
        // and hands the group to WKR_other — which rewrites the lease.
        const originalArchive = mailer._archiveAndDelete.bind(mailer);
        let retires = 0;
        mailer._archiveAndDelete = async (...args) => {
            const result = await originalArchive(...args);
            retires += 1;
            if (retires === 1) {
                for (const row of db.state.recipients) row.locked_by = 'WKR_other';
            }
            return result;
        };

        assign(mailer);
        await settle(mailer);

        assert.equal(sent.length, 2, 'it stops after the send whose retire failed — not after the whole group');

        // The two rows now belonging to WKR_other are untouched, so that node
        // sends them exactly once.
        assert.equal(db.state.recipients.length, 2);
        assert.equal(db.state.archive.length, 1, 'only the row this node still owned was retired');

        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        // Reported as cancelled rather than failed: nothing is wrong and the
        // work is in hand elsewhere, so the orchestrator must not release it.
        assert.equal(done.data.outcome, 'cancelled');
        assert.match(done.data.error, /reassigned mid-send/);
    });
});

describe('BatchMailerSystem — assignment rules', () => {
    test('a second group is refused while one is in flight', async () => {
        const { mailer } = makeMailer(ROWS, () => new Promise(() => {})); // never resolves

        assert.equal(assign(mailer).accepted, true);

        const second = mailer.acceptGroup({ jobId: 'JOB2', groupNumber: 1, recipientCount: 5 });
        assert.equal(second.accepted, false);
        assert.equal(second.reason, 'ALREADY_SENDING');
        assert.deepEqual(second.busyWith, { jobId: 'JOB1', groupNumber: 1 });

        mailer.stopping = true;
    });

    test('a disabled mailer refuses clearly rather than failing later', () => {
        const mailer = new BatchMailerSystem({ enabled: false });
        const result = mailer.acceptGroup({ jobId: 'JOB1', groupNumber: 1 });

        assert.equal(result.accepted, false);
        assert.equal(result.reason, 'BATCH_MAILER_DISABLED');
    });

    test('the orchestrator can tighten the rate budget with the assignment', () => {
        const { mailer } = makeMailer(ROWS, () => new Promise(() => {}));

        assign(mailer, { rateLimit: { perWindow: 5, windowMs: 60_000 } });
        assert.equal(mailer._limiter.limit, 5);
        assert.equal(mailer._limiter.windowMs, 60_000);

        mailer.stopping = true;
    });

    test('status reports what this node is working on, for the watchdog', async () => {
        const { mailer } = makeMailer(ROWS, () => new Promise(() => {}));
        assign(mailer);

        const status = mailer.getMailingStatus({ jobId: 'JOB1' });
        assert.equal(status.active.length, 1);
        assert.equal(status.active[0].groupNumber, 1);

        // A different job is not this node's concern — the watchdog must see an
        // empty list and reassign, rather than a false "still working".
        assert.equal(mailer.getMailingStatus({ jobId: 'OTHER' }).active.length, 0);

        mailer.stopping = true;
    });
});

describe('BatchMailerSystem — cancellation', () => {
    test('stops between recipients and reports the group cancelled', async () => {
        const { mailer, db, link } = makeMailer(ROWS, mail => {
            if (mail.to === 'a@x.com') mailer.cancelGroup({ jobId: 'JOB1' });
            return { messageId: 'ok' };
        });

        assign(mailer);
        await settle(mailer);

        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        assert.equal(done.data.outcome, 'cancelled');

        // The mail already handed to the transport still had its row retired —
        // that is what stops it being sent twice on the next assignment.
        assert.equal(db.state.archive.length, 1);
        assert.equal(db.state.archive[0].outcome, 'sent');
        assert.equal(db.state.recipients.length, 2, 'the untouched remainder stays queued');
    });

    test('cancelling an unrelated job leaves this one alone', async () => {
        const { mailer } = makeMailer(ROWS, () => new Promise(() => {}));
        assign(mailer);

        assert.equal(mailer.cancelGroup({ jobId: 'OTHER' }).cancelled, 0);
        assert.equal([...mailer._active.values()][0].cancelled, false);

        mailer.stopping = true;
    });

    test('a cancellation between batches ends the group without a further read', async () => {
        // One row per database round trip, cancelled after the first send: the
        // inner loop finishes cleanly and the check at the TOP of the outer loop
        // is what stops it — a different path from cancelling mid-batch.
        const holder = {};
        const { mailer, db, link } = makeMailer(
            ROWS,
            (mail, n) => {
                if (n === 1) holder.mailer.cancelGroup({ jobId: 'JOB1' });
                return { messageId: 'ok' };
            },
            { fetchBatchSize: 1 }
        );
        holder.mailer = mailer;

        assign(mailer);
        await settle(mailer);

        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        assert.equal(done.data.outcome, 'cancelled');
        assert.equal(db.state.archive.length, 1, 'exactly the one row it had already sent');
        assert.equal(db.state.recipients.length, 2);
    });
});

// ── Failures that are not about a recipient ──────────────────────────────────

describe('BatchMailerSystem — when the queue itself fails', () => {
    test('an unreadable queue ends the group as failed, and still reports it', async () => {
        const { mailer, link } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        mailer._fetchBatch = async () => {
            throw new Error('relation "orch_mailing_recipients" does not exist');
        };

        assign(mailer);
        await settle(mailer);

        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        assert.ok(done, 'a group that dies on a database error must still be reported');
        assert.equal(done.data.outcome, 'failed');
        assert.match(done.data.error, /does not exist/);

        // Reporting is what stops the orchestrator waiting a day for its watchdog.
        assert.equal(mailer._active.size, 0, 'and the node frees itself for the next group');
    });

    test('a node with no cluster identity refuses to claim work', async () => {
        const { mailer, link } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        mailer._workerId = () => null;

        assign(mailer);
        await settle(mailer);

        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        assert.equal(done.data.outcome, 'failed');
        assert.match(done.data.error, /no cluster identity/);
    });

    test('a completion report that cannot be delivered does not strand the node', async () => {
        const { mailer, link } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        link.connected = false;

        assign(mailer);
        await settle(mailer);

        // The link being down is exactly when the orchestrator's watchdog earns
        // its keep — but this node must not hang on to the group waiting.
        assert.equal(link.emitted.length, 0);
        assert.equal(mailer._active.size, 0);
        assert.equal(mailer.getStats().groupsCompleted, 1, 'the work itself still finished');
    });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Starting is a decision, not a formality: a node that comes up "enabled" but
 * unable to send would accept groups and fail every mail in them, which is
 * strictly worse than declining the work and letting another node take it.
 */
describe('BatchMailerSystem — starting and stopping', () => {
    test('enabled without any transport configuration stays OFF', async () => {
        const mailer = new BatchMailerSystem({ enabled: true, mail: {} });

        assert.equal(await mailer.start(), false);
        assert.equal(mailer.enabled, false, 'it disables itself rather than accepting groups it cannot send');
        assert.equal(mailer.transporter, null);

        // And the refusal is visible to the orchestrator at assignment time.
        assert.equal(mailer.acceptGroup({ jobId: 'JOB1', groupNumber: 1 }).reason, 'BATCH_MAILER_DISABLED');
    });

    test('a disabled node never builds a transport', async () => {
        const mailer = new BatchMailerSystem({ enabled: false, mail: { host: 'localhost', port: 2525 } });

        assert.equal(await mailer.start(), false);
        assert.equal(mailer.transporter, null);
    });

    test('a configured node builds its own bulk transport and tears it down again', async () => {
        const mailer = new BatchMailerSystem({
            enabled: true,
            mail: { host: 'localhost', port: 2525, email: 'bulk@example.com', password: 'x' },
            progressIntervalMs: 60_000
        });

        assert.equal(await mailer.start(), true);
        assert.ok(mailer.transporter, 'the bulk transport is separate from systemConfig.mail by design');

        await mailer.stop({ drainTimeoutMs: 0 });

        assert.equal(mailer.transporter, null, 'and is closed on shutdown');
        assert.equal(mailer.stopping, true);
    });

    test('a transport that is already torn down does not break shutdown', async () => {
        const { mailer } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        mailer.transporter = {
            close() {
                throw new Error('pool already closed');
            }
        };

        await mailer.stop({ drainTimeoutMs: 0 });

        assert.equal(mailer.transporter, null, 'shutdown is not the place to care about a dead pool');
    });

    test('shutdown lets a group between recipients finish and report', async () => {
        const { mailer, link } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        // The shared harness stubs sleeping out entirely, which would turn the
        // drain loop into a microtask spin that never yields to the group it is
        // waiting for. A real (short) sleep is the point of this test.
        mailer._sleep = ms => new Promise(resolve => setTimeout(resolve, Math.min(ms, 5)));

        assign(mailer);

        await mailer.stop({ drainTimeoutMs: 500 });

        // Waiting matters: a group that stops without reporting is one the
        // orchestrator has to rediscover through its 24h watchdog.
        const done = link.emitted.find(e => e.name === 'orion:mailing:group-done');
        assert.equal(done.data.outcome, 'cancelled');
        assert.equal(mailer._active.size, 0, 'the drain window was long enough for it to report');
    });

    test('shutdown gives up on a wedged group rather than hanging', async () => {
        // A send that never resolves stands in for a node stuck on SMTP.
        const { mailer, sent } = makeMailer(ROWS, () => new Promise(() => {}));
        assign(mailer);

        // Let it get as far as the transport, so it is genuinely mid-send.
        for (let i = 0; i < 100 && sent.length === 0; i++) await new Promise(resolve => setImmediate(resolve));
        assert.equal(sent.length, 1, 'the node is inside a send that will never return');

        await mailer.stop({ drainTimeoutMs: 20 });

        assert.equal([...mailer._active.values()][0].cancelled, true, 'it was asked to stop');
        // Bounded on purpose: a shutdown that hangs on mail is worse than the
        // orchestrator reclaiming the group a little later.
        assert.equal(mailer._active.size, 1, 'but shutdown does not wait forever for it');
    });

    test('a node that is shutting down refuses new groups', () => {
        const { mailer } = makeMailer(ROWS, () => ({ messageId: 'ok' }));
        mailer.stopping = true;

        assert.equal(assign(mailer).reason, 'NODE_SHUTTING_DOWN');
    });

    test('a malformed assignment is refused rather than half-accepted', () => {
        const { mailer } = makeMailer(ROWS, () => ({ messageId: 'ok' }));

        assert.equal(mailer.acceptGroup({ jobId: 'JOB1' }).reason, 'INVALID_ASSIGNMENT', 'a group number is not optional');
        assert.equal(mailer.acceptGroup({ groupNumber: 1 }).reason, 'INVALID_ASSIGNMENT');
        assert.equal(mailer._active.size, 0);
    });
});

// ── Progress reporting ───────────────────────────────────────────────────────

/**
 * Progress is not how the orchestrator learns what was sent — the database
 * already knows. It is how it tells a node working slowly from one that has
 * wedged, which is why silence is the only thing that must never be faked.
 */
describe('BatchMailerSystem — progress reports', () => {
    const activeSystem = (runs, link) => ({
        _active: new Map(runs.map(run => [`${run.jobId}::${run.groupNumber}`, run])),
        _link: () => link
    });

    test('emits one report per group in flight', async () => {
        const link = makeFakeLink();
        const system = activeSystem([{ jobId: 'JOB1', groupNumber: 2, sent: 40, failed: 1, remaining: 9 }], link);

        await reportProgress(system);

        assert.equal(link.emitted.length, 1);
        assert.equal(link.emitted[0].name, 'orion:mailing:progress');
        assert.deepEqual(link.emitted[0].data, { jobId: 'JOB1', groupNumber: 2, sent: 40, failed: 1, remaining: 9 });
    });

    test('an idle node says nothing at all', async () => {
        const link = makeFakeLink();

        await reportProgress(activeSystem([], link));

        assert.equal(link.emitted.length, 0, 'a heartbeat from an idle node would be noise');
    });

    test('a down link is skipped rather than throwing into the timer', async () => {
        const link = makeFakeLink();
        link.connected = false;

        await reportProgress(activeSystem([{ jobId: 'JOB1', groupNumber: 1, sent: 1, failed: 0, remaining: 0 }], link));

        assert.equal(link.emitted.length, 0);
    });

    test('one group failing to report does not silence the others', async () => {
        const link = makeFakeLink();
        let calls = 0;
        link.emitToOrchestrator = async (name, data) => {
            calls += 1;
            if (calls === 1) throw new Error('tunnel closed mid-write');
            link.emitted.push({ name, data });
        };

        await reportProgress(
            activeSystem(
                [
                    { jobId: 'JOB1', groupNumber: 1, sent: 1, failed: 0, remaining: 0 },
                    { jobId: 'JOB1', groupNumber: 2, sent: 2, failed: 0, remaining: 0 }
                ],
                link
            )
        );

        assert.equal(calls, 2, 'the second group is still attempted');
        assert.equal(link.emitted.length, 1);
    });
});

// ── Reading an SMTP failure ──────────────────────────────────────────────────

/**
 * Three predicates decide three different things, and conflating any two of
 * them produces a specific bug: retrying a dead mailbox forever, spending the
 * retry budget on a throttle, or declaring the server broken because of one bad
 * address.
 */
describe('BatchMailerSystem — classifying failures', () => {
    test('a throttle is a slow-down, not a rejection', () => {
        assert.equal(isRateLimited({ responseCode: 450 }), true);
        assert.equal(isRateLimited({ message: 'Too many messages, try again later' }), true);
        assert.equal(isRateLimited({ message: 'quota exceeded' }), true);
        assert.equal(isRateLimited({ responseCode: 550, message: 'User unknown' }), false, 'a dead mailbox is not a throttle');
    });

    test('a 421 is both a throttle and a transport signal', () => {
        const error = { responseCode: 421 };
        assert.equal(isRateLimited(error), true);
        assert.equal(isTransportFailure(error), true);
        // Which is why the send loop asks isRateLimited FIRST: a 421 should cost
        // rate budget and be retried, not be dead-lettered as a bad address.
        assert.equal(isPermanentRejection(error), false);
    });

    test('backoff doubles and then flattens at its ceiling', () => {
        assert.equal(backoffFor(1, 1000, 10_000), 1000);
        assert.equal(backoffFor(2, 1000, 10_000), 2000);
        assert.equal(backoffFor(4, 1000, 10_000), 8000);
        assert.equal(backoffFor(9, 1000, 10_000), 10_000, 'an unbounded backoff would hold the whole group behind one address');
    });

    test('transport configuration is recognised in any of its three forms', () => {
        assert.equal(hasTransportConfig({ service: 'gmail' }), true);
        assert.equal(hasTransportConfig({ host: 'smtp.example.com' }), true);
        assert.equal(hasTransportConfig({ email: 'bulk@example.com' }), true);
        assert.equal(hasTransportConfig({}), false);
        assert.equal(hasTransportConfig({ from: 'Bulk <bulk@example.com>' }), false, 'a from address alone is nowhere to send through');
    });
});

// ── Observability ────────────────────────────────────────────────────────────

describe('BatchMailerSystem — stats', () => {
    test('reports the budget it is actually running under, not the configured one', async () => {
        const { mailer } = makeMailer(ROWS, () => ({ messageId: 'ok' }));

        // The orchestrator tightened it at assignment time.
        assign(mailer, { rateLimit: { perWindow: 3, windowMs: 30_000 }, maxAttempts: 5 });
        await settle(mailer);

        const stats = mailer.getStats();
        assert.equal(stats.ratePerWindow, 3);
        assert.equal(stats.rateWindowMs, 30_000);
        assert.equal(stats.maxAttempts, 5);
        assert.equal(stats.mailsSent, 3);
        assert.equal(stats.groupsCompleted, 1);
        assert.equal(stats.activeGroups, 0);
    });

    test('an unknown counter is ignored rather than inventing a field', () => {
        const { mailer } = makeMailer(ROWS, () => ({ messageId: 'ok' }));

        mailer.count('notARealCounter');

        assert.equal('notARealCounter' in mailer.getStats(), false);
    });
});
