import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { BatchMailingService, MailingError, MailingNotifications } from '../../../../Packages/server/Orion-Orchestrator/lib/Mailing/BatchMailingService.js';
import { ClusterCommands } from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';

/**
 * The orchestrator side is a scheduler. Its correctness is not about mail at
 * all — it is about never handing one group to two nodes, never letting two
 * jobs run at once, and never leaving work stranded on a node that has gone
 * away. Those are the properties pinned here.
 *
 * The models are stubbed rather than the database: the SQL that enforces the
 * one-running-job rule and the single-live-assignment rule is a database
 * concern (a partial unique index), and what this suite covers is the decision
 * logic sitting above it.
 */

// ── Test doubles ─────────────────────────────────────────────────────────────

const makeOrch = ({ nodes = ['WKR_a', 'WKR_b'], commandImpl = null } = {}) => {
    const commands = [];

    return {
        commands,
        async getClusterStatus() {
            return { nodes: nodes.map(id => ({ workerId: id, online: true, transport: { status: 'ACTIVE' } })) };
        },
        async command(workerId, action, args, timeoutMs) {
            commands.push({ workerId, action, args, timeoutMs });
            if (commandImpl) return commandImpl(workerId, action, args);
            return { ok: true, result: { accepted: true } };
        }
    };
};

/**
 * Builds a service with every model replaced by an in-memory stub. Only the
 * methods a given test needs are meaningful; the rest are inert so an
 * unexercised path cannot throw and mask the assertion.
 */
const makeService = ({ orch = makeOrch(), config = {} } = {}) => {
    const service = new BatchMailingService({ query: async () => ({ rows: [], rowCount: 0 }) }, orch, { enabled: true, ...config });

    const state = {
        running: null,
        queued: [],
        cooldown: null,
        groups: [],
        assignments: [],
        busy: new Set(),
        notifications: [],
        released: [],
        finished: [],
        archived: 0,
        // Submission bookkeeping — what was written, and what was undone.
        existingJobIds: new Set(),
        created: [],
        inserted: [],
        statusChanges: [],
        deleted: [],
        sentMail: []
    };

    service.state = state;

    service.jobs = {
        findRunning: async () => state.running,
        listQueued: async () => state.queued,
        cooldownRemaining: async () => state.cooldown,
        claimNext: async () => {
            if (state.running || state.cooldown) return null;
            const next = state.queued.shift() || null;
            if (next) {
                state.running = { ...next, status: 'running' };
                return state.running;
            }
            return null;
        },
        findById: async id => (state.running?.id === id ? state.running : state.queued.find(j => j.id === id) || null),
        finish: async (id, status, cooldownSeconds, opts) => {
            state.finished.push({ id, status, cooldownSeconds, ...opts });
            if (state.running?.id === id) state.running = null;
            return { id, name: 'Test job', status, started_at: null, completed_at: new Date().toISOString(), total_recipients: 0, submitted_by_email: null };
        },
        refreshCounts: async () => null,
        setStatus: async (id, status, opts) => {
            state.statusChanges.push({ id, status, ...opts });
            return null;
        },
        exists: async id => state.existingJobIds.has(id),
        create: async job => {
            const created = { ...job, name: job.name, total_recipients: job.totalRecipients, status: 'queued', created_at: new Date().toISOString() };
            state.created.push(created);
            return created;
        },
        list: async () => []
    };

    service.recipients = {
        groupsWithWork: async () => state.groups,
        lockGroup: async (jobId, groupNumber, workerId) => {
            const group = state.groups.find(g => g.groupNumber === groupNumber);
            if (group) group.lockedBy = workerId;
            return 1;
        },
        releaseGroup: async (jobId, groupNumber) => {
            const group = state.groups.find(g => g.groupNumber === groupNumber);
            if (group) group.lockedBy = null;
            state.released.push({ jobId, groupNumber });
            return 1;
        },
        releaseGroupFromWorker: async (jobId, groupNumber, workerId) => {
            const group = state.groups.find(g => g.groupNumber === groupNumber && g.lockedBy === workerId);
            if (!group) return 0;
            group.lockedBy = null;
            state.released.push({ jobId, groupNumber, workerId });
            return 1;
        },
        releaseAllForWorker: async workerId => {
            const freed = state.groups.filter(g => g.lockedBy === workerId);
            for (const group of freed) group.lockedBy = null;
            return freed.map(g => ({ jobId: 'JOB1', groupNumber: g.groupNumber }));
        },
        countRemaining: async () => state.groups.reduce((sum, g) => sum + g.remaining, 0),
        archiveAndClearRemaining: async () => {
            state.archived = state.groups.reduce((sum, g) => sum + g.remaining, 0);
            state.groups = [];
            return state.archived;
        },
        insertMany: async (jobId, rows, groupSize) => {
            state.inserted.push({ jobId, rows: rows.length, groupSize });
            return rows.length;
        },
        deleteForJob: async jobId => {
            state.deleted.push(jobId);
            return 0;
        }
    };

    service.assignments = {
        create: async (jobId, groupNumber, workerId, remaining) => {
            const existing = state.assignments.find(a => a.group_number === groupNumber && ['assigned', 'running'].includes(a.status));
            // Mirrors the partial unique index: a live assignment for a group
            // already exists, so this insert must fail rather than duplicate.
            if (existing) throw new Error('duplicate key value violates unique constraint');

            const assignment = { job_id: jobId, group_number: groupNumber, worker_id: workerId, status: 'assigned', sent_count: 0, failed_count: 0, remaining_count: remaining };
            state.assignments.push(assignment);
            state.busy.add(workerId);
            return assignment;
        },
        findLive: async (jobId, groupNumber) =>
            state.assignments.find(a => a.group_number === groupNumber && ['assigned', 'running'].includes(a.status)) || null,
        listLive: async () => state.assignments.filter(a => ['assigned', 'running'].includes(a.status)),
        listForJob: async () => state.assignments,
        busyWorkers: async () => state.busy,
        recordProgress: async () => null,
        finish: async (jobId, groupNumber, workerId, status) => {
            // Mirrors the real statement's `AND status IN ('assigned','running')`:
            // a report against an assignment that is no longer live matches
            // nothing and returns null, which is how a stale report is detected.
            const assignment = state.assignments.find(
                a => a.group_number === groupNumber && a.worker_id === workerId && ['assigned', 'running'].includes(a.status)
            );
            if (!assignment) return null;

            assignment.status = status;
            state.busy.delete(workerId);
            return assignment;
        },
        release: async (jobId, groupNumber, reason) => {
            const assignment = state.assignments.find(a => a.group_number === groupNumber && ['assigned', 'running'].includes(a.status));
            if (assignment) {
                assignment.status = 'released';
                assignment.last_error = reason;
                state.busy.delete(assignment.worker_id);
            }
            return assignment || null;
        },
        releaseAllForWorker: async (workerId, reason) => {
            const held = state.assignments.filter(a => a.worker_id === workerId && ['assigned', 'running'].includes(a.status));
            for (const assignment of held) {
                assignment.status = 'released';
                assignment.last_error = reason;
            }
            state.busy.delete(workerId);
            return held;
        },
        cancelAllForJob: async () => {
            const live = state.assignments.filter(a => ['assigned', 'running'].includes(a.status));
            for (const assignment of live) assignment.status = 'cancelled';
            return live;
        },
        listSilent: async () => state.silent || []
    };

    service.archive = { counts: async () => ({ sent: 0, failed: 0, cancelled: 0 }), list: async () => [], purgeExpired: async () => 0 };

    service.notifications = {
        create: async notification => {
            state.notifications.push(notification);
            return notification;
        },
        purgeExpired: async () => 0
    };

    return service;
};

const groups = specs => specs.map(([groupNumber, remaining, lockedBy = null]) => ({ groupNumber, remaining, lockedBy }));

/** A parsed sheet, as SheetParser would hand one over. */
const sheet = (rowCount, overrides = {}) => ({
    jobId: 'JOB_NEW',
    name: 'Spring blast',
    priority: 5,
    filename: 'spring.xlsx',
    rows: Array.from({ length: rowCount }, (_, i) => ({ recipient: `u${i}@x.com`, subject: 'Hi', content: 'Hello' })),
    ...overrides
});

/** An AdminMailer stand-in. `consoleMode` is the no-SMTP-configured path. */
const makeMailer = ({ consoleMode = false, sendImpl = null } = {}) => {
    const sent = [];
    return {
        sent,
        consoleMode,
        config: { from: 'Orion <orch@example.com>', email: 'orch@example.com' },
        transporter: consoleMode
            ? null
            : {
                  async sendMail(mail) {
                      sent.push(mail);
                      if (sendImpl) return sendImpl(mail);
                      return { messageId: 'ok' };
                  }
              }
    };
};

// ── Dispatch ─────────────────────────────────────────────────────────────────

describe('BatchMailingService — dispatch', () => {
    test('gives each idle node exactly one group', async () => {
        const orch = makeOrch({ nodes: ['WKR_a', 'WKR_b', 'WKR_c'] });
        const service = makeService({ orch });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 5, total_recipients: 70 };
        service.state.groups = groups([
            [1, 15],
            [2, 15],
            [3, 15],
            [4, 15],
            [5, 10]
        ]);

        const result = await service.dispatchTick();

        assert.equal(result.dispatched, 3, 'three nodes take three groups');
        assert.deepEqual(
            result.assignments.map(a => a.groupNumber),
            [1, 2, 3],
            'groups go out in order'
        );

        // The overflow waits for a node to report back — it is not queued onto
        // an already-busy node.
        const assigned = new Set(result.assignments.map(a => a.workerId));
        assert.equal(assigned.size, 3, 'no node receives two groups');
    });

    test('the assignment command carries the rate budget the cluster expects', async () => {
        const orch = makeOrch({ nodes: ['WKR_a'] });
        const service = makeService({ orch, config: { nodeRateLimit: { perWindow: 15, windowMs: 120_000 }, maxAttempts: 3 } });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        service.state.groups = groups([[1, 15]]);

        await service.dispatchTick();

        const command = orch.commands.find(c => c.action === ClusterCommands.MAILING_ASSIGN);
        assert.ok(command, 'a mailing:assign command must be issued');
        assert.equal(command.args.jobId, 'JOB1');
        assert.equal(command.args.groupNumber, 1);
        assert.deepEqual(command.args.rateLimit, { perWindow: 15, windowMs: 120_000 });
        assert.equal(command.args.maxAttempts, 3);
    });

    test('a group already held by a live node is left alone', async () => {
        const orch = makeOrch({ nodes: ['WKR_a', 'WKR_b'] });
        const service = makeService({ orch });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 2 };
        service.state.groups = groups([
            [1, 15, 'WKR_a'],
            [2, 15]
        ]);
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running', sent_count: 5, failed_count: 0 }];
        service.state.busy = new Set(['WKR_a']);

        const result = await service.dispatchTick();

        assert.equal(result.dispatched, 1, 'only the free group is handed out');
        assert.equal(result.assignments[0].groupNumber, 2);
        assert.equal(result.assignments[0].workerId, 'WKR_b');
    });

    test('a group leased to a node that has left is reclaimed and reassigned', async () => {
        const orch = makeOrch({ nodes: ['WKR_b'] }); // WKR_a is gone
        const service = makeService({ orch });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        service.state.groups = groups([[1, 15, 'WKR_a']]);
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];

        const result = await service.dispatchTick();

        assert.equal(result.dispatched, 1);
        assert.equal(result.assignments[0].workerId, 'WKR_b', 'the stranded group moves to a live node');
    });

    test('a node that refuses the assignment does not take the group with it', async () => {
        const orch = makeOrch({
            nodes: ['WKR_a'],
            commandImpl: () => ({ ok: true, result: { accepted: false, reason: 'BATCH_MAILER_DISABLED' } })
        });
        const service = makeService({ orch });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        service.state.groups = groups([[1, 15]]);

        const result = await service.dispatchTick();

        assert.equal(result.dispatched, 0);
        // The lease must be rolled back, or the group is invisible to every
        // future dispatch pass.
        assert.equal(service.state.groups[0].lockedBy, null, 'the lease is released when the node refuses');
        assert.equal(service.state.assignments[0].status, 'released');
    });

    test('with no live nodes the job waits rather than failing', async () => {
        const service = makeService({ orch: makeOrch({ nodes: [] }) });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        service.state.groups = groups([[1, 15]]);

        const result = await service.dispatchTick();

        assert.equal(result.waitingForNodes, true);
        assert.equal(result.dispatched, 0);
    });

    test('a job with no groups left is completed and its cooldown armed', async () => {
        const service = makeService({ config: { cooldownSeconds: 3600 } });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 5 };
        service.state.groups = [];

        const result = await service.dispatchTick();

        assert.equal(result.completed, true);
        assert.equal(service.state.finished[0].status, 'completed');
        assert.equal(service.state.finished[0].cooldownSeconds, 3600, 'the cooldown is armed with the job, not separately');
    });
});

// ── The queue ────────────────────────────────────────────────────────────────

describe('BatchMailingService — one job at a time', () => {
    test('nothing starts while a job is running', async () => {
        const service = makeService();

        service.state.running = { id: 'JOB1', name: 'Running', group_count: 1 };
        service.state.groups = groups([[1, 5]]);
        service.state.queued = [{ id: 'JOB2', name: 'Waiting', priority: 1 }];

        await service.dispatchTick();

        assert.equal(service.state.running.id, 'JOB1', 'a higher-priority job does not interrupt the running one');
        assert.equal(service.state.queued.length, 1);
    });

    test('nothing starts while the cooldown is in effect', async () => {
        const service = makeService();

        service.state.cooldown = { until: new Date(Date.now() + 3_600_000).toISOString(), seconds: 3600 };
        service.state.queued = [{ id: 'JOB2', name: 'Waiting', priority: 1 }];

        const result = await service.dispatchTick();

        assert.equal(result.idle, true);
        assert.equal(service.state.running, null);
        assert.equal(service.state.queued.length, 1, 'the job stays queued through the cooldown');
    });

    test('the next job starts once the cluster is free', async () => {
        const service = makeService();

        service.state.queued = [{ id: 'JOB2', name: 'Waiting', priority: 5, total_recipients: 30, group_count: 2 }];
        service.state.groups = groups([
            [1, 15],
            [2, 15]
        ]);

        await service.dispatchTick();

        assert.equal(service.state.running?.id, 'JOB2');
        assert.ok(
            service.state.notifications.some(n => n.type === MailingNotifications.JOB_STARTED),
            'starting a job is announced'
        );
    });
});

// ── Node loss ────────────────────────────────────────────────────────────────

describe('BatchMailingService — node loss', () => {
    test("a lost node's groups are released immediately, not left for the watchdog", async () => {
        const service = makeService();

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 2 };
        service.state.groups = groups([
            [1, 15, 'WKR_a'],
            [2, 15, 'WKR_b']
        ]);
        service.state.assignments = [
            { job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' },
            { job_id: 'JOB1', group_number: 2, worker_id: 'WKR_b', status: 'running' }
        ];

        const result = await service.handleNodeLost('WKR_a', 'left the cluster');

        assert.equal(result.released, 1);
        assert.equal(service.state.assignments[0].status, 'released');
        assert.equal(service.state.assignments[1].status, 'running', "the surviving node's group is untouched");

        const notice = service.state.notifications.find(n => n.type === MailingNotifications.GROUP_REASSIGNED);
        assert.ok(notice, 'operators are told a group moved');
        assert.match(notice.message, /WKR_a/);
    });

    test('losing a node that held nothing is a no-op', async () => {
        const service = makeService();

        const result = await service.handleNodeLost('WKR_idle', 'went stale');

        assert.equal(result.released, 0);
        assert.equal(service.state.notifications.length, 0, 'no notification for a node that was not sending');
    });
});

// ── Group completion ─────────────────────────────────────────────────────────

describe('BatchMailingService — group completion', () => {
    test('a completed group closes its assignment and frees the node', async () => {
        const service = makeService();

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 2 };
        service.state.groups = groups([[2, 15]]);
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];
        service.state.busy = new Set(['WKR_a']);

        await service.handleGroupDone('WKR_a', { jobId: 'JOB1', groupNumber: 1, outcome: 'completed', sent: 15, failed: 0, remaining: 0 });

        assert.equal(service.state.assignments[0].status, 'completed');
        assert.equal(service.state.busy.has('WKR_a'), false, 'the node is free to take the next group');
    });

    test('a group the node gave up on goes back to the pool', async () => {
        const service = makeService();

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        service.state.groups = groups([[1, 12, 'WKR_a']]);
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];

        await service.handleGroupDone('WKR_a', {
            jobId: 'JOB1',
            groupNumber: 1,
            outcome: 'failed',
            sent: 3,
            failed: 0,
            remaining: 12,
            error: 'transport unreachable'
        });

        assert.equal(service.state.assignments[0].status, 'failed');
        // Without this release the twelve unsent recipients would be stranded
        // behind a lease nobody holds.
        assert.ok(
            service.state.released.some(r => r.groupNumber === 1),
            'the unsent remainder must be released for reassignment'
        );
        assert.ok(service.state.notifications.some(n => n.type === MailingNotifications.GROUP_REASSIGNED));
    });

    test('a late report from a node whose group was reassigned cannot disturb the new holder', async () => {
        const service = makeService();

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        // The watchdog already reclaimed group 1 from WKR_a and gave it to
        // WKR_b, which is part-way through sending it.
        service.state.groups = groups([[1, 8, 'WKR_b']]);
        service.state.assignments = [
            { job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'released' },
            { job_id: 'JOB1', group_number: 1, worker_id: 'WKR_b', status: 'running' }
        ];

        // WKR_a now surfaces and reports the group it lost.
        const result = await service.handleGroupDone('WKR_a', {
            jobId: 'JOB1',
            groupNumber: 1,
            outcome: 'failed',
            sent: 7,
            failed: 0,
            remaining: 8,
            error: 'transport unreachable'
        });

        assert.equal(result.stale, true, 'the late report is recognised as stale');

        // The critical invariant: WKR_b keeps its lease. A node reads its rows
        // by locked_by, so stripping it here would have WKR_b see an empty
        // group and report success on eight mails it never sent.
        assert.equal(service.state.groups[0].lockedBy, 'WKR_b', "the working node's lease must survive");
        assert.equal(service.state.assignments[1].status, 'running');
        assert.equal(service.state.released.length, 0, 'nothing is released on a stale report');
    });

    test('a malformed report is ignored rather than corrupting the ledger', async () => {
        const service = makeService();

        assert.equal(await service.handleGroupDone('WKR_a', {}), null);
        assert.equal(await service.handleProgress('WKR_a', { jobId: 'JOB1' }), null);
    });
});

// ── Watchdog ─────────────────────────────────────────────────────────────────

describe('BatchMailingService — the watchdog', () => {
    test('a node that confirms it is still working keeps its group', async () => {
        const orch = makeOrch({
            nodes: ['WKR_a'],
            commandImpl: (workerId, action) =>
                action === ClusterCommands.MAILING_STATUS
                    ? { ok: true, result: { active: [{ jobId: 'JOB1', groupNumber: 1 }] } }
                    : { ok: true, result: { accepted: true } }
        });
        const service = makeService({ orch });

        service.state.silent = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running', sent_count: 40, failed_count: 0, silent_seconds: 2400 }];
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];

        const result = await service.watchdogTick();

        assert.equal(result.reclaimed, 0, 'a slow node is not a dead node');
        assert.equal(service.state.assignments[0].status, 'running');
    });

    test('a node that does not answer loses its group', async () => {
        const orch = makeOrch({
            nodes: ['WKR_a'],
            commandImpl: (workerId, action) => {
                if (action === ClusterCommands.MAILING_STATUS) throw new Error('unreachable');
                return { ok: true, result: { accepted: true } };
            }
        });
        const service = makeService({ orch });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        service.state.groups = groups([[1, 15, 'WKR_a']]);
        service.state.silent = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running', sent_count: 0, failed_count: 0, silent_seconds: 2400 }];
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];

        const result = await service.watchdogTick();

        assert.equal(result.reclaimed, 1);
        assert.equal(service.state.assignments[0].status, 'released');
    });

    test('past the 24h ceiling the whole job is recompiled and the fleet restarted', async () => {
        const orch = makeOrch({
            nodes: ['WKR_a'],
            commandImpl: (workerId, action) => {
                if (action === ClusterCommands.MAILING_STATUS) return { ok: true, result: { active: [] } };
                return { ok: true, result: { accepted: true } };
            }
        });
        const service = makeService({ orch, config: { groupSilentTimeoutSeconds: 86_400, groupStallSeconds: 1800 } });

        service.state.running = { id: 'JOB1', name: 'Blast', status: 'running', group_count: 2 };
        service.state.groups = groups([
            [1, 15, 'WKR_a'],
            [2, 10, 'WKR_gone']
        ]);
        service.state.silent = [
            { job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running', sent_count: 0, failed_count: 0, silent_seconds: 90_000 }
        ];
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];

        const result = await service.watchdogTick();

        assert.equal(result.jobsRecovered, 1);
        // Every leased group is rebuilt, not just the one that reported silent.
        assert.ok(
            service.state.released.some(r => r.groupNumber === 2),
            'recovery rebuilds every outstanding group of the job'
        );

        const notice = service.state.notifications.find(n => n.type === MailingNotifications.WATCHDOG_RECOVERED);
        assert.ok(notice, 'a watchdog recovery is surfaced to operators');
        assert.equal(notice.severity, 'critical');
    });

    test('silence with nothing left simply completes the job', async () => {
        const orch = makeOrch({
            nodes: ['WKR_a'],
            commandImpl: (workerId, action) => (action === ClusterCommands.MAILING_STATUS ? { ok: true, result: { active: [] } } : { ok: true, result: {} })
        });
        const service = makeService({ orch });

        service.state.running = { id: 'JOB1', name: 'Blast', status: 'running', group_count: 1 };
        service.state.groups = [];
        service.state.silent = [
            { job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running', sent_count: 15, failed_count: 0, silent_seconds: 90_000 }
        ];
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];

        await service.watchdogTick();

        assert.equal(service.state.finished[0]?.status, 'completed', 'silence because there was nothing left is not a failure');
    });
});

// ── Cancellation ─────────────────────────────────────────────────────────────

describe('BatchMailingService — cancellation', () => {
    test('signals every assigned node, archives the remainder, and frees the cluster', async () => {
        const orch = makeOrch({ nodes: ['WKR_a', 'WKR_b'] });
        const service = makeService({ orch });

        service.state.running = { id: 'JOB1', name: 'Blast', status: 'running', group_count: 3 };
        service.state.groups = groups([
            [2, 15],
            [3, 10]
        ]);
        service.state.assignments = [
            { job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' },
            { job_id: 'JOB1', group_number: 2, worker_id: 'WKR_b', status: 'assigned' }
        ];

        const result = await service.cancelJob('JOB1', { id: 'SAD_1', email: 'ops@example.com' }, 'wrong list');

        const cancels = orch.commands.filter(c => c.action === ClusterCommands.MAILING_CANCEL);
        assert.equal(cancels.length, 2, 'every node holding a group is told to stop');

        assert.equal(result.unsent, 25, 'the unsent remainder is counted');
        assert.equal(service.state.archived, 25, 'and archived rather than deleted, so it stays answerable');

        // Cancelling should not cost the next job an hour it never earned.
        assert.equal(service.state.finished[0].status, 'cancelled');
        assert.equal(service.state.finished[0].cooldownSeconds, 0);
    });

    test('a job that already finished cannot be cancelled', async () => {
        const service = makeService();
        service.state.queued = [{ id: 'JOB9', name: 'Done', status: 'completed' }];

        await assert.rejects(() => service.cancelJob('JOB9', { email: 'ops@example.com' }), err => {
            assert.ok(err instanceof MailingError);
            assert.equal(err.code, 'MAILING::NOT-CANCELLABLE');
            assert.equal(err.status, 409);
            return true;
        });
    });

    test('cancelling an unknown job is a 404, not a silent success', async () => {
        const service = makeService();

        await assert.rejects(() => service.cancelJob('NOPE', {}), err => {
            assert.equal(err.code, 'MAILING::JOB-NOT-FOUND');
            assert.equal(err.status, 404);
            return true;
        });
    });
});

// ── Queue reporting ──────────────────────────────────────────────────────────

describe('BatchMailingService — queue state for the panel', () => {
    test('names the reason a queued job has not started', async () => {
        const service = makeService();
        service.state.queued = [{ id: 'JOB2', name: 'Waiting', priority: 5, total_recipients: 10, created_at: new Date().toISOString() }];
        service.state.cooldown = { until: new Date(Date.now() + 600_000).toISOString(), seconds: 600 };

        const queue = await service.getQueueState();

        assert.equal(queue.blockedReason, 'cooldown');
        assert.equal(queue.queued[0].position, 1);
    });

    test('an empty fleet is reported as the blocker when there is no cooldown', async () => {
        const service = makeService({ orch: makeOrch({ nodes: [] }) });
        service.state.queued = [{ id: 'JOB2', name: 'Waiting', priority: 5, total_recipients: 10, created_at: new Date().toISOString() }];

        const queue = await service.getQueueState();

        assert.equal(queue.blockedReason, 'no-live-nodes');
        assert.equal(queue.liveNodeCount, 0);
    });

    test('a running job is not reported as blocked', async () => {
        const service = makeService();
        service.state.running = { id: 'JOB1', name: 'Blast', total_recipients: 100, started_at: new Date().toISOString() };
        service.state.groups = groups([[1, 40]]);

        const queue = await service.getQueueState();

        assert.equal(queue.blockedReason, null);
        assert.equal(queue.running.remaining, 40);
    });
});

// ── Submission ───────────────────────────────────────────────────────────────

/**
 * Submission is the one path that writes a whole job at once, and it has two
 * halves that must not come apart: the job row and its recipients. Everything
 * here is about that pair, and about telling the operator what happens next.
 */
describe('BatchMailingService — submission', () => {
    test('plans the sheet, loads the recipients, and reports the job as starting', async () => {
        const service = makeService({ orch: makeOrch({ nodes: ['WKR_a', 'WKR_b'] }), config: { maxPerGroup: 15 } });

        const { job, plan } = await service.submitJob(sheet(100), { id: 'SAD_1', email: 'ops@example.com' });

        // 100 across 2 nodes is an ideal share of 50, but the cap binds at 15.
        assert.equal(plan.groupSize, 15);
        assert.equal(plan.groupCount, 7, 'the cap produces more groups than nodes, which is the overflow case');
        assert.equal(plan.capBound, true);

        assert.equal(service.state.created.length, 1);
        assert.equal(job.submittedByEmail, 'ops@example.com', 'the submitter is recorded so the summary has somewhere to go');
        assert.equal(service.state.inserted[0].rows, 100, 'every row is loaded');
        assert.equal(service.state.inserted[0].groupSize, 15, 'and chunked at the planned size');

        const notice = service.state.notifications.find(n => n.type === MailingNotifications.JOB_QUEUED);
        assert.ok(notice, 'an unblocked job is announced as starting');
        assert.equal(notice.severity, 'info');
    });

    test('a duplicate job id is refused before anything is written', async () => {
        const service = makeService();
        service.state.existingJobIds.add('JOB_NEW');

        await assert.rejects(
            () => service.submitJob(sheet(10), {}),
            err => {
                assert.ok(err instanceof MailingError);
                assert.equal(err.code, 'MAILING::DUPLICATE-JOB');
                assert.equal(err.status, 409);
                return true;
            }
        );

        assert.equal(service.state.created.length, 0, 'nothing is created for a rejected submission');
        assert.equal(service.state.inserted.length, 0);
    });

    test('a disabled plane refuses the upload rather than queueing it forever', async () => {
        const service = makeService({ config: { enabled: false } });

        await assert.rejects(
            () => service.submitJob(sheet(10), {}),
            err => {
                assert.equal(err.code, 'MAILING::DISABLED');
                assert.equal(err.status, 503);
                return true;
            }
        );
    });

    test('a failed recipient load undoes the job row instead of leaving an empty job', async () => {
        const service = makeService();
        service.recipients.insertMany = async () => {
            throw new Error('connection reset');
        };

        await assert.rejects(
            () => service.submitJob(sheet(50), {}),
            err => {
                assert.equal(err.code, 'MAILING::LOAD-FAILED');
                assert.equal(err.status, 500);
                return true;
            }
        );

        // A job row without recipients would "run" and instantly complete having
        // sent nothing — which reads as success. Both halves must be undone.
        assert.equal(service.state.statusChanges[0].status, 'failed');
        assert.match(service.state.statusChanges[0].error, /connection reset/);
        assert.deepEqual(service.state.deleted, ['JOB_NEW']);
    });

    test('an empty fleet still accepts the sheet, and says so', async () => {
        const service = makeService({ orch: makeOrch({ nodes: [] }), config: { maxPerGroup: 300 } });

        const { plan } = await service.submitJob(sheet(40), {});

        // Planning against zero nodes is meaningless, so it plans against one —
        // refusing would throw away a valid sheet over a transient fleet state.
        assert.equal(plan.groupCount, 1);
        assert.equal(plan.liveNodeCount, 1);

        const notice = service.state.notifications.find(n => n.type === MailingNotifications.NO_NODES);
        assert.ok(notice, 'the operator is told why nothing will send yet');
        assert.equal(notice.severity, 'warning');
    });

    test('a job that must wait is told what it is waiting behind', async () => {
        const service = makeService();
        service.state.running = { id: 'JOB1', name: 'Earlier blast', status: 'running' };
        service.state.cooldown = { until: new Date(Date.now() + 600_000).toISOString(), seconds: 600 };

        await service.submitJob(sheet(10), {});

        const notice = service.state.notifications.find(n => n.type === MailingNotifications.JOB_DELAYED);
        assert.ok(notice, 'the delay warning is raised at submit time, not when someone wonders why');
        assert.match(notice.message, /Earlier blast/, 'the running job is named');
        assert.match(notice.message, /cooldown/, 'and so is the cooldown');
        assert.equal(notice.details.cooldownSeconds, 600);
    });
});

// ── Job detail ───────────────────────────────────────────────────────────────

describe('BatchMailingService — job detail for the panel', () => {
    test('shows every planned group, including the ones already drained', async () => {
        const service = makeService();

        service.state.running = { id: 'JOB1', name: 'Blast', status: 'running', group_count: 3, total_recipients: 45 };
        // Only groups 2 and 3 still have work; group 1 has drained.
        service.state.groups = groups([
            [2, 10, 'WKR_a'],
            [3, 15]
        ]);
        service.state.assignments = [
            {
                job_id: 'JOB1',
                group_number: 1,
                worker_id: 'WKR_a',
                status: 'completed',
                sent_count: 20,
                failed_count: 0,
                completed_at: new Date().toISOString()
            },
            { job_id: 'JOB1', group_number: 2, worker_id: 'WKR_a', status: 'running', sent_count: 5, failed_count: 1, assigned_at: new Date().toISOString() }
        ];

        const detail = await service.getJobDetail('JOB1');

        assert.equal(detail.groups.length, 3, 'a view that omits finished groups reads like work vanished');

        assert.equal(detail.groups[0].status, 'completed');
        assert.equal(detail.groups[0].sent, 20, 'a drained group still reports what its last holder sent');

        assert.equal(detail.groups[1].status, 'running');
        assert.equal(detail.groups[1].workerId, 'WKR_a');
        assert.equal(detail.groups[1].failed, 1);

        assert.equal(detail.groups[2].status, 'waiting', 'unleased outstanding work is waiting, not assigned');
        assert.equal(detail.groups[2].workerId, null);

        // 45 planned, 25 still queued → 44% done.
        assert.equal(detail.job.remaining, 25);
        assert.equal(detail.job.progressPercent, 44);
    });

    test('an unknown job is a 404 rather than an empty page', async () => {
        const service = makeService();

        await assert.rejects(
            () => service.getJobDetail('NOPE'),
            err => {
                assert.equal(err.code, 'MAILING::JOB-NOT-FOUND');
                assert.equal(err.status, 404);
                return true;
            }
        );
    });
});

// ── Restart recovery ─────────────────────────────────────────────────────────

/**
 * A restart is exactly when leases are stale. The rule is confirm or reclaim —
 * never assume, in either direction.
 */
describe('BatchMailingService — recovery after an orchestrator restart', () => {
    const probing = active =>
        makeOrch({
            nodes: ['WKR_a'],
            commandImpl: (workerId, action) => (action === ClusterCommands.MAILING_STATUS ? { ok: true, result: { active } } : { ok: true, result: {} })
        });

    const withLease = service => {
        service.state.groups = groups([[1, 10, 'WKR_a']]);
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running', sent_count: 5, failed_count: 0 }];
        return service;
    };

    test('a node that confirms it is still sending keeps its group', async () => {
        const service = withLease(makeService({ orch: probing([{ jobId: 'JOB1', groupNumber: 1 }]) }));

        await service.recoverAfterRestart();

        assert.equal(service.state.assignments[0].status, 'running', 'a node genuinely mid-send is not interrupted');
        assert.equal(service.state.groups[0].lockedBy, 'WKR_a', 'and keeps its lease');
    });

    test('a lease nobody claims is released for reassignment', async () => {
        const service = withLease(makeService({ orch: probing([]) }));

        const result = await service.recoverAfterRestart();

        assert.equal(result.released, 1);
        assert.equal(service.state.assignments[0].status, 'released');
        assert.equal(service.state.groups[0].lockedBy, null, 'the rows go back in the pool — they were never lost');
    });

    test('an unreachable node counts as not working, so its group is reclaimed', async () => {
        const orch = makeOrch({
            nodes: ['WKR_a'],
            commandImpl: () => {
                throw new Error('no route to node');
            }
        });
        const service = withLease(makeService({ orch }));

        await service.recoverAfterRestart();

        // A node we cannot talk to is a node that cannot report completion either.
        assert.equal(service.state.assignments[0].status, 'released');
    });

    test('a node claiming a different group does not save this one', async () => {
        const service = withLease(makeService({ orch: probing([{ jobId: 'JOB1', groupNumber: 7 }]) }));

        await service.recoverAfterRestart();

        assert.equal(service.state.assignments[0].status, 'released', 'the probe must match the group, not just the job');
    });

    test('nothing live is a no-op, not a sweep', async () => {
        const service = makeService();

        const result = await service.recoverAfterRestart();

        assert.deepEqual(result, { released: 0 });
        assert.equal(service.state.released.length, 0);
    });
});

// ── Completion summary mail ──────────────────────────────────────────────────

/**
 * The summary is a courtesy. Every test here is ultimately about one rule: a
 * mail problem must never turn a completed blast into a failed one.
 */
describe('BatchMailingService — the submitter summary', () => {
    const withSubmitter = (service, email = 'ops@example.com') => {
        service.jobs.finish = async (id, status, cooldownSeconds, opts) => {
            service.state.finished.push({ id, status, cooldownSeconds, ...opts });
            return {
                id,
                name: 'Spring blast',
                status,
                started_at: new Date(Date.now() - 600_000).toISOString(),
                completed_at: new Date().toISOString(),
                total_recipients: 100,
                submitted_by_email: email
            };
        };
        return service;
    };

    test('sends a summary through the admin transport when the job completes', async () => {
        const service = makeService();
        const mailer = makeMailer();
        service.mailer = mailer;
        withSubmitter(service);
        service.archive.counts = async () => ({ sent: 97, failed: 3, cancelled: 0 });

        await service.completeJob({ id: 'JOB1', name: 'Spring blast' }, 'completed');

        assert.equal(mailer.sent.length, 1);
        assert.equal(mailer.sent[0].to, 'ops@example.com');
        assert.match(mailer.sent[0].subject, /Spring blast/);
        assert.match(mailer.sent[0].text, /Sent:\s+97/);
        assert.match(mailer.sent[0].text, /Undeliverable:\s+3/);
        assert.match(mailer.sent[0].text, /Duration:\s+10 minutes/);
    });

    test('console mode logs the summary instead of failing for want of SMTP', async () => {
        const service = makeService();
        const mailer = makeMailer({ consoleMode: true });
        service.mailer = mailer;
        withSubmitter(service);

        const finished = await service.completeJob({ id: 'JOB1', name: 'Spring blast' }, 'completed');

        assert.ok(finished, 'the job still completes');
        assert.equal(mailer.sent.length, 0);
    });

    test('a transport failure does not fail the job', async () => {
        const service = makeService();
        service.mailer = makeMailer({
            sendImpl: () => {
                throw new Error('SMTP down');
            }
        });
        withSubmitter(service);

        const finished = await service.completeJob({ id: 'JOB1', name: 'Spring blast' }, 'completed');

        assert.ok(finished, 'the blast is done either way — the summary is a courtesy');
        assert.equal(finished.status, 'completed');
    });

    test('no summary is sent when the feature is switched off', async () => {
        const service = makeService({ config: { emailSubmitterOnCompletion: false } });
        const mailer = makeMailer();
        service.mailer = mailer;
        withSubmitter(service);

        await service.completeJob({ id: 'JOB1', name: 'Spring blast' }, 'completed');

        assert.equal(mailer.sent.length, 0);
    });

    test('a job with no recorded submitter is skipped silently', async () => {
        const service = makeService();
        const mailer = makeMailer();
        service.mailer = mailer;
        withSubmitter(service, null);

        await service.completeJob({ id: 'JOB1', name: 'Spring blast' }, 'completed');

        assert.equal(mailer.sent.length, 0);
    });

    test('undeliverable addresses raise their own notification', async () => {
        const service = makeService();
        withSubmitter(service);
        service.archive.counts = async () => ({ sent: 90, failed: 10, cancelled: 0 });

        await service.completeJob({ id: 'JOB1', name: 'Spring blast' }, 'completed');

        const deadLetters = service.state.notifications.find(n => n.type === MailingNotifications.DEAD_LETTERS);
        assert.ok(deadLetters, 'dead letters are surfaced separately from the completion notice');
        assert.equal(deadLetters.details.failed, 10);

        const completion = service.state.notifications.find(n => n.type === MailingNotifications.JOB_COMPLETED);
        assert.equal(completion.severity, 'warning', 'a completion with failures is not a clean info notice');
    });

    test('a second completion is ignored rather than notifying twice', async () => {
        const service = makeService();
        service.jobs.finish = async () => null; // the row was already closed

        const result = await service.completeJob({ id: 'JOB1', name: 'Spring blast' }, 'completed');

        assert.equal(result, null);
        assert.equal(service.state.notifications.length, 0);
    });
});

// ── Failure paths that must not cascade ──────────────────────────────────────

describe('BatchMailingService — refusing to make things worse', () => {
    test('a group already assigned to someone else leaves their lease alone', async () => {
        const service = makeService({ orch: makeOrch({ nodes: ['WKR_b'] }) });

        service.state.running = { id: 'JOB1', name: 'Blast', group_count: 1 };
        service.state.groups = groups([[1, 15]]);
        // A live assignment already exists, so the stub's unique-index mirror
        // rejects the insert — exactly as the partial unique index would.
        service.state.assignments = [{ job_id: 'JOB1', group_number: 1, worker_id: 'WKR_a', status: 'running' }];

        await service.dispatchTick();

        const held = service.state.assignments.filter(a => a.status === 'running');
        assert.equal(held.length, 1, 'the existing holder keeps its assignment');
        assert.equal(held[0].worker_id, 'WKR_a');
    });

    test('a database failure while releasing a lost node is logged, not thrown', async () => {
        const service = makeService();
        service.assignments.releaseAllForWorker = async () => {
            throw new Error('pool exhausted');
        };

        // Node loss is driven from a cluster event handler; throwing there would
        // take down unrelated bookkeeping for the same event.
        const result = await service.handleNodeLost('WKR_a', 'went stale');

        assert.equal(result, null);
    });

    test('a report that names no group is ignored', async () => {
        const service = makeService();

        assert.equal(await service.handleProgress('WKR_a', {}), null);
        assert.equal(await service.handleProgress('WKR_a', { jobId: 'JOB1' }), null, 'a missing group number is not a group');
        assert.equal(await service.handleGroupDone('WKR_a', { jobId: 'JOB1' }), null);
    });

    test('a node that held nothing is not announced as having lost work', async () => {
        const service = makeService();

        const result = await service.handleNodeLost('WKR_idle', 'left the cluster');

        assert.deepEqual(result, { released: 0 });
        assert.equal(service.state.notifications.length, 0, 'no notification for a node that was doing nothing');
    });
});

// ── Lifecycle ────────────────────────────────────────────────────────────────

describe('BatchMailingService — lifecycle', () => {
    test('starting arms all three loops and reconciles leases before the first tick', async () => {
        const service = makeService();
        let recovered = false;
        service.recoverAfterRestart = async () => {
            recovered = true;
            return { released: 0 };
        };

        assert.equal(service.start(), service, 'start is chainable, as the orchestrator calls it');

        assert.ok(service._dispatchTimer, 'dispatch');
        assert.ok(service._watchdogTimer, 'watchdog');
        assert.ok(service._purgeTimer, 'purge');

        // A restart is exactly when leases are stale — waiting a whole watchdog
        // interval to notice would strand every group the old process held.
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(recovered, true);

        service.stop();
        assert.equal(service._dispatchTimer, null);
        assert.equal(service._watchdogTimer, null);
        assert.equal(service._purgeTimer, null);
    });

    test('a disabled plane starts no timers at all', () => {
        const service = makeService({ config: { enabled: false } });

        service.start();

        assert.equal(service._dispatchTimer, null, 'a disabled plane must not quietly keep scheduling');
        service.stop();
    });

    test('stopping twice is harmless', () => {
        const service = makeService();
        service.recoverAfterRestart = async () => ({ released: 0 });

        service.start();
        service.stop();
        service.stop();

        assert.equal(service._purgeTimer, null);
    });

    test('the purge cycle reaps expired records and notifications together', async () => {
        const service = makeService();
        service.archive.purgeExpired = async () => 12;
        service.notifications.purgeExpired = async () => 4;

        // Workers deliberately have no DELETE on either table, so the single
        // writer is the only process that can do this.
        assert.deepEqual(await service._purgeExpired(), { archive: 12, notifications: 4 });
    });

    test('a tick that overlaps itself is skipped rather than double-dispatching', async () => {
        const service = makeService();
        service._dispatching = true;
        assert.deepEqual(await service.dispatchTick(), { skipped: true });

        service._watchdogRunning = true;
        assert.deepEqual(await service.watchdogTick(), { skipped: true });
    });

    test('the panel reads pass straight through to the models', async () => {
        const service = makeService();
        let deadLetterQuery = null;
        service.jobs.list = async options => [{ id: 'JOB1', options }];
        service.archive.list = async (jobId, options) => {
            deadLetterQuery = { jobId, options };
            return [];
        };

        assert.equal((await service.listJobs({ status: 'completed' }))[0].options.status, 'completed');

        await service.listDeadLetters('JOB1', { limit: 10 });
        assert.equal(deadLetterQuery.options.outcome, 'failed', 'dead letters are the failed slice of the archive');
        assert.equal(deadLetterQuery.options.limit, 10);

        assert.deepEqual(await service.liveNodeIds(), ['WKR_a', 'WKR_b']);
    });
});
