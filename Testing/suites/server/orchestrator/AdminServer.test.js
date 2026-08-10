import { TEST_ARTIFACTS_DIR } from '../../../helpers/bootstrap.js';
import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { AdminServer, SESSION_COOKIE } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/AdminServer.js';
import { AdminError } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/SystemAdminService.js';
import { AuditLog } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/AuditLog.js';
import { AdminActions } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/adminActions.js';
import { ClusterCommands } from '../../../../Packages/server/Orion-Orchestrator/lib/protocol.js';

/**
 * AdminServer — the HTTP surface of the control plane.
 *
 * These run a REAL express app on an ephemeral port and speak to it over real
 * HTTP. Nothing about the request pipeline is stubbed: the gates, the routers,
 * the body parsers and the error handler are the shipped ones. Only the two
 * collaborators behind it — the orchestrator and SystemAdminService — are
 * doubles, because the point is the pipeline, not what it calls into.
 *
 * The pipeline is the security boundary:
 *
 *   session → stage gate (TOTP done?) → account gate (active?) → root gate
 *   or PBAC gate → handler → audit row
 *
 * Every one of those steps is the only thing standing between a half-finished
 * login and the cluster. A route that forgets `_requireSession()` is reachable
 * unauthenticated; a stage gate that allows an unlisted path lets a
 * pending_totp session issue commands with one factor. Both are invisible to a
 * unit test of the handler and obvious to a request.
 */

// ── Doubles ──────────────────────────────────────────────────────────────────

const ADMIN = Object.freeze({
    id: 'SAD_1',
    email: 'admin@orion.local',
    display_name: 'Ada',
    role: 'admin',
    status: 'active',
    totp_enabled: true,
    password_change_required: false
});

const ROOT = Object.freeze({ ...ADMIN, id: 'SAD_root', email: 'root@orion.local', role: 'root' });

/**
 * Session table keyed by bearer token. Tests hand out tokens like 'active' or
 * 'pending-totp' and get the matching session shape back.
 */
const SESSIONS = {
    active: { sessionId: 'SES_1', stage: 'active', expiresAt: '2099-01-01T00:00:00Z', admin: ADMIN },
    root: { sessionId: 'SES_r', stage: 'active', expiresAt: '2099-01-01T00:00:00Z', admin: ROOT },
    'pending-totp': { sessionId: 'SES_2', stage: 'pending_totp', expiresAt: '2099-01-01T00:00:00Z', admin: { ...ADMIN, totp_enabled: false } },
    'pending-account': { sessionId: 'SES_3', stage: 'active', expiresAt: '2099-01-01T00:00:00Z', admin: { ...ROOT, status: 'pending', password_change_required: true } },
    suspended: { sessionId: 'SES_4', stage: 'active', expiresAt: '2099-01-01T00:00:00Z', admin: { ...ADMIN, status: 'suspended' } }
};

const fakeService = (overrides = {}) => {
    const audited = [];

    return {
        audited,
        config: { pendingSessionTtlMinutes: 15, sessionTtlHours: 12 },

        /** Default: every action allowed. Tests override to exercise denials. */
        verdict: { allowed: true, reason: 'policy', matchedSid: 'sid-1' },
        async authorize() {
            return this.verdict;
        },

        async resolveSession(token) {
            return SESSIONS[token] || null;
        },

        audit: {
            writeSafe(row) {
                audited.push(row);
            },
            async write(row) {
                audited.push(row);
            },
            async list() {
                return [{ id: 'AUD_1' }];
            },
            async verifyChain() {
                return { intact: true, rows: 1 };
            }
        },

        policies: { list: async () => [], listAttachments: async () => [] },
        groups: { list: async () => [], listMembers: async () => [] },

        async listAdmins() {
            return [{ id: 'SAD_1' }];
        },
        async createAdmin() {
            return { id: 'SAD_new' };
        },
        async requestMagicLink() {},
        async wipeAdminTotpEnrollments() {
            return { wiped: 2 };
        },
        async logout() {},

        ...overrides
    };
};

const fakeOrch = (overrides = {}) => ({
    cluster: 'test-cluster',
    config: { commandTimeoutMs: 10_000 },
    calls: [],

    getNodes: () => [{ workerId: 'W1' }],
    getNode: id => (id === 'W1' ? { workerId: 'W1' } : undefined),
    getClusterHealth: () => ({ state: 'HEALTHY' }),
    getEscalations: limit => [{ limit }],
    getConsensusHistory: limit => [{ limit }],
    getPolicyRules: () => [],
    getPolicyOutcomes: limit => [{ limit }],
    getCommandLog: limit => [{ limit }],
    getClusterStatus: async () => ({ cluster: 'test-cluster' }),
    getMailingService: () => null,

    async command(...args) {
        this.calls.push({ method: 'command', args });
        return { ok: true, workerId: args[0], action: args[1] };
    },
    async commandAll(...args) {
        this.calls.push({ method: 'commandAll', args });
        return [{ workerId: 'W1', ok: true }];
    },
    async lockCluster(...args) {
        this.calls.push({ method: 'lockCluster', args });
        return [{ workerId: 'W1', ok: true }];
    },
    async unlockCluster() {
        return [];
    },
    async declareIncident(reason) {
        this.calls.push({ method: 'declareIncident', args: [reason] });
        return { state: 'INCIDENT' };
    },
    async resolveIncident(reason) {
        this.calls.push({ method: 'resolveIncident', args: [reason] });
        return { state: 'DEGRADED' };
    },
    async proposeConsensus() {
        return { decided: true, accepted: true };
    },
    async addClientUrls(urls) {
        this.calls.push({ method: 'addClientUrls', args: [urls] });
        return [];
    },
    async listClusterSigningKeys() {
        return [];
    },
    async revokeSigningKids(kids) {
        this.calls.push({ method: 'revokeSigningKids', args: [kids] });
        return [];
    },
    async forceRotateNodeKeys(workerId) {
        this.calls.push({ method: 'forceRotateNodeKeys', args: [workerId] });
        return { workerId, kids: [] };
    },
    async getClusterKeyVaultStatus() {
        return [];
    },
    async rotateEncryptionKek(workerId) {
        this.calls.push({ method: 'rotateEncryptionKek', args: [workerId] });
        return { workerId };
    },
    async rotateEncryptionDek(opts) {
        this.calls.push({ method: 'rotateEncryptionDek', args: [opts] });
        return { ok: true };
    },
    async confirmEncryptionUnrecoverable() {
        return { decided: true, accepted: true };
    },
    async wipeEncryptedFields(opts) {
        this.calls.push({ method: 'wipeEncryptedFields', args: [opts] });
        return { workerId: 'W1', consensusOverridden: false, consensus: {} };
    },

    ...overrides
});

// ── Harness ──────────────────────────────────────────────────────────────────

let server;
let service;
let orch;
let base;

/** Rebuild the app in-place with new doubles, keeping the same listening port. */
const boot = async (orchOverrides = {}, serviceOverrides = {}, config = {}) => {
    if (server) await server.stop();
    orch = fakeOrch(orchOverrides);
    service = fakeService(serviceOverrides);
    server = new AdminServer(orch, service, { host: '127.0.0.1', port: 0, secureCookies: false, ...config });
    await server.start();
    base = `http://127.0.0.1:${server.httpServer.address().port}`;
    return server;
};

/** `token` becomes an Authorization bearer; pass `cookie: true` to send it as one. */
const call = async (method, path, { token, body, cookie = false, headers = {}, raw } = {}) => {
    const init = { method, headers: { ...headers } };

    if (token && cookie) init.headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
    else if (token) init.headers.authorization = `Bearer ${token}`;

    // fetch refuses a body on GET/HEAD; the table-driven suites below pass one
    // uniformly for every method, so drop it rather than special-casing them.
    const bodyAllowed = method !== 'GET' && method !== 'HEAD';

    if (raw !== undefined && bodyAllowed) {
        init.body = raw;
    } else if (body !== undefined && bodyAllowed) {
        init.headers['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
    }

    const response = await fetch(base + path, init);
    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        /* non-JSON (GUI html) */
    }
    return { status: response.status, body: payload, headers: response.headers };
};

before(async () => {
    await boot();
});

after(async () => {
    if (server) await server.stop();
});

// ── Suites ───────────────────────────────────────────────────────────────────

describe('AdminServer — lifecycle', () => {
    test('start() binds a port and stop() releases it', async () => {
        const standalone = new AdminServer(fakeOrch(), fakeService(), { host: '127.0.0.1', port: 0 });
        await standalone.start();

        const { port } = standalone.httpServer.address();
        assert.ok(port > 0);

        await standalone.stop();
        assert.equal(standalone.httpServer, null);

        // The port is genuinely free again — a second bind would EADDRINUSE.
        await assert.doesNotReject(async () => {
            const again = new AdminServer(fakeOrch(), fakeService(), { host: '127.0.0.1', port });
            await again.start();
            await again.stop();
        });
    });

    test('stop() is safe when the server never started', async () => {
        await assert.doesNotReject(() => new AdminServer(fakeOrch(), fakeService(), {}).stop());
    });

    test('the x-powered-by banner is suppressed', async () => {
        const { headers } = await call('GET', '/api/meta');
        assert.equal(headers.get('x-powered-by'), null);
    });
});

describe('AdminServer — /api/meta is the one unauthenticated endpoint', () => {
    test('meta answers without a session and names the cluster', async () => {
        const { status, body } = await call('GET', '/api/meta');

        assert.equal(status, 200);
        assert.equal(body.cluster, 'test-cluster');
        assert.equal(body.name, 'orion-orch');
        assert.equal(body.guiTheme, 'modern');
    });

    test('meta reports the mailing plane as unavailable when it is off', async () => {
        const { body } = await call('GET', '/api/meta');
        assert.equal(body.mailingAvailable, false);
    });

    test('meta reports the mailing plane as available when it is on', async () => {
        await boot({ getMailingService: () => ({}) });
        const { body } = await call('GET', '/api/meta');

        // The panel uses this to hide a nav entry that could only ever 503.
        assert.equal(body.mailingAvailable, true);
        await boot();
    });

    test('meta leaks no admin, session or config detail', async () => {
        const { body } = await call('GET', '/api/meta');

        assert.deepEqual(Object.keys(body).sort(), ['cluster', 'error', 'guiAvailable', 'guiTheme', 'mailingAvailable', 'name', 'panel']);
    });
});

describe('AdminServer — the session gate', () => {
    // Named explicitly rather than discovered: a new governed route that forgets
    // `_requireSession()` should make this list stale and fail the completeness
    // check below, not quietly slip through.
    const GOVERNED = [
        ['GET', '/api/cluster/status'],
        ['GET', '/api/cluster/nodes'],
        ['GET', '/api/cluster/nodes/W1'],
        ['GET', '/api/cluster/health'],
        ['GET', '/api/cluster/escalations'],
        ['GET', '/api/cluster/consensus-history'],
        ['GET', '/api/cluster/policy-rules'],
        ['GET', '/api/cluster/policy-outcomes'],
        ['GET', '/api/cluster/command-log'],
        ['GET', '/api/cluster/commands'],
        ['POST', '/api/cluster/nodes/W1/command'],
        ['POST', '/api/cluster/command-all'],
        ['POST', '/api/cluster/lock'],
        ['POST', '/api/cluster/unlock'],
        ['POST', '/api/cluster/incident/declare'],
        ['POST', '/api/cluster/incident/resolve'],
        ['POST', '/api/cluster/consensus'],
        ['POST', '/api/cluster/client-urls'],
        ['GET', '/api/cluster/secrets/keys'],
        ['POST', '/api/cluster/secrets/revoke'],
        ['POST', '/api/cluster/secrets/rotate-node'],
        ['GET', '/api/cluster/keyvault/status'],
        ['POST', '/api/cluster/keyvault/rotate-kek'],
        ['POST', '/api/cluster/keyvault/rotate-dek'],
        ['POST', '/api/cluster/keyvault/confirm-unrecoverable'],
        ['POST', '/api/cluster/keyvault/wipe'],
        ['GET', '/api/mailing/jobs'],
        ['GET', '/api/mailing/queue'],
        ['GET', '/api/mailing/jobs/JOB_1'],
        ['POST', '/api/mailing/jobs/JOB_1/cancel'],
        ['GET', '/api/notifications'],
        ['POST', '/api/notifications/read-all'],
        ['GET', '/api/audit'],
        ['GET', '/api/audit/verify'],
        ['GET', '/api/admins'],
        ['POST', '/api/admins'],
        ['GET', '/api/policies'],
        ['GET', '/api/groups'],
        ['GET', '/api/auth/session'],
        ['POST', '/api/auth/logout'],
        ['POST', '/api/auth/totp/setup']
    ];

    test('every governed endpoint refuses an anonymous request with 401', async () => {
        for (const [method, path] of GOVERNED) {
            const { status, body } = await call(method, path, { body: {} });

            assert.equal(status, 401, `${method} ${path} was reachable without a session`);
            assert.equal(body.code, 'AUTH::NO-SESSION', `${method} ${path} used the wrong code`);
        }
    });

    test('an unknown token is refused exactly like no token', async () => {
        const { status, body } = await call('GET', '/api/cluster/status', { token: 'not-a-session' });

        assert.equal(status, 401);
        assert.equal(body.code, 'AUTH::NO-SESSION');
    });

    test('the session resolves from a bearer header', async () => {
        const { status } = await call('GET', '/api/cluster/status', { token: 'active' });
        assert.equal(status, 200);
    });

    test('the session resolves from the cookie when there is no bearer', async () => {
        const { status, body } = await call('GET', '/api/auth/session', { token: 'active', cookie: true });

        assert.equal(status, 200);
        assert.equal(body.admin.email, 'admin@orion.local');
    });

    test('a bearer header wins over a cookie', async () => {
        const response = await fetch(base + '/api/auth/session', {
            headers: { authorization: 'Bearer root', cookie: `${SESSION_COOKIE}=active` }
        });
        const body = await response.json();

        // Deterministic precedence matters: an operator debugging with a bearer
        // must not silently get their stale browser session instead.
        assert.equal(body.admin.role, 'root');
    });

    test('a malformed cookie header does not crash the parser', async () => {
        const response = await fetch(base + '/api/cluster/status', { headers: { cookie: '=;;garbage;a=' } });
        assert.equal(response.status, 401);
    });

    test('/api/auth/session projects the admin without secret columns', async () => {
        const { body } = await call('GET', '/api/auth/session', { token: 'active' });

        assert.deepEqual(Object.keys(body.admin).sort(), [
            'displayName',
            'email',
            'id',
            'passwordChangeRequired',
            'role',
            'status',
            'totpEnrolled'
        ]);
        assert.equal(body.stage, 'active');
    });
});

describe('AdminServer — the stage gate (TOTP not yet done)', () => {
    test('a pending_totp session cannot reach the cluster', async () => {
        const { status, body } = await call('GET', '/api/cluster/status', { token: 'pending-totp' });

        assert.equal(status, 403);
        assert.equal(body.code, 'AUTH::TOTP-REQUIRED');
    });

    test('a pending_totp session cannot reach governance', async () => {
        const { status, body } = await call('GET', '/api/admins', { token: 'pending-totp' });

        assert.equal(status, 403);
        assert.equal(body.code, 'AUTH::TOTP-REQUIRED');
    });

    test('a pending_totp session may only finish enrolling, read itself, or leave', async () => {
        // These five are the entire allowlist. Anything else is one factor short.
        for (const [method, path] of [
            ['POST', '/api/auth/totp/setup'],
            ['GET', '/api/auth/session'],
            ['POST', '/api/auth/logout']
        ]) {
            const { status } = await call(method, path, { token: 'pending-totp', body: {} });
            assert.notEqual(status, 403, `${method} ${path} should be reachable while enrolling`);
        }
    });

    test('the stage gate runs before PBAC, so a denial never reveals policy state', async () => {
        await boot({}, { verdict: { allowed: false, reason: 'default-deny' } });

        const { body } = await call('GET', '/api/cluster/status', { token: 'pending-totp' });

        assert.equal(body.code, 'AUTH::TOTP-REQUIRED', 'not PBAC::DENIED');
        await boot();
    });
});

describe('AdminServer — the account gate', () => {
    test('a suspended admin is refused everywhere, including the auth routes', async () => {
        for (const [method, path] of [
            ['GET', '/api/cluster/status'],
            ['GET', '/api/auth/session'],
            ['POST', '/api/auth/logout']
        ]) {
            const { status, body } = await call(method, path, { token: 'suspended', body: {} });

            assert.equal(status, 403, `${method} ${path} let a suspended admin through`);
            assert.equal(body.code, 'AUTH::SUSPENDED');
        }
    });

    test('suspension is checked before the stage and PBAC gates', async () => {
        const { body } = await call('GET', '/api/cluster/status', { token: 'suspended' });
        assert.equal(body.code, 'AUTH::SUSPENDED');
    });

    test('a pending account (root mid-bootstrap) cannot operate the cluster', async () => {
        const { status, body } = await call('GET', '/api/cluster/status', { token: 'pending-account' });

        assert.equal(status, 403);
        assert.equal(body.code, 'AUTH::ACCOUNT-PENDING');
    });

    test('a pending account may rotate its bootstrap password', async () => {
        const { status } = await call('POST', '/api/auth/root/change-password', {
            token: 'pending-account',
            body: { currentPassword: 'a', newPassword: 'b' }
        });

        // The one extra path a pending ACCOUNT gets over a pending STAGE — it is
        // the only way out of the pending state.
        assert.notEqual(status, 403);
    });
});

describe('AdminServer — the root gate', () => {
    test('governance is refused for a non-root admin', async () => {
        for (const [method, path] of [
            ['GET', '/api/admins'],
            ['POST', '/api/admins'],
            ['GET', '/api/policies'],
            ['GET', '/api/groups'],
            ['GET', '/api/audit/verify']
        ]) {
            const { status, body } = await call(method, path, { token: 'active', body: {} });

            assert.equal(status, 403, `${method} ${path} was reachable by a non-root admin`);
            assert.equal(body.code, 'GOV::ROOT-ONLY');
        }
    });

    test('governance is allowed for root', async () => {
        const { status, body } = await call('GET', '/api/admins', { token: 'root' });

        assert.equal(status, 200);
        assert.deepEqual(body.admins, [{ id: 'SAD_1' }]);
    });

    test('a refused governance attempt is audited as a denial', async () => {
        await boot();
        await call('GET', '/api/admins', { token: 'active' });

        const row = service.audited.at(-1);
        assert.equal(row.decision, 'deny');
        assert.equal(row.statusCode, 403);
        assert.equal(row.adminEmail, 'admin@orion.local');
        assert.deepEqual(row.details, { reason: 'not-root' });
    });

    test('the keyvault wipe needs root ON TOP of an allowing policy', async () => {
        // The PBAC verdict is `allowed` throughout this suite, so a 403 here can
        // only come from the role gate — which is the property being pinned.
        const { status, body } = await call('POST', '/api/cluster/keyvault/wipe', {
            token: 'active',
            body: { confirmation: 'WIPE ENCRYPTED FIELDS', reason: 'a sufficiently long reason' }
        });

        assert.equal(status, 403);
        assert.equal(body.code, 'GOV::ROOT-ONLY');
    });
});

describe('AdminServer — the PBAC gate', () => {
    beforeEach(async () => {
        await boot();
    });

    test('a denied verdict returns 403 with the action, resource and reason', async () => {
        service.verdict = { allowed: false, reason: 'default-deny', matchedSid: undefined };

        const { status, body } = await call('GET', '/api/cluster/status', { token: 'active' });

        assert.equal(status, 403);
        assert.equal(body.code, 'PBAC::DENIED');
        assert.match(body.message, /"cluster:read:status" on "cluster" \(default-deny\)/);
    });

    test('a denial is audited with the verdict and never reaches the handler', async () => {
        service.verdict = { allowed: false, reason: 'explicit-deny', matchedSid: 'no-lock' };

        await call('POST', '/api/cluster/lock', { token: 'active' });

        assert.equal(orch.calls.length, 0, 'the orchestrator was called despite a denial');
        const row = service.audited.at(-1);
        assert.equal(row.decision, 'deny');
        assert.equal(row.action, AdminActions.OPS_LOCK_CLUSTER);
        assert.deepEqual(row.details, { reason: 'explicit-deny', matchedSid: 'no-lock' });
    });

    test('an allowed request is audited on finish with the real status code', async () => {
        const { status } = await call('GET', '/api/cluster/nodes/W1', { token: 'active' });
        assert.equal(status, 200);

        // The audit row is written from res.on('finish'), so give the event loop
        // a turn before reading it.
        await new Promise(resolve => setImmediate(resolve));

        const row = service.audited.at(-1);
        assert.equal(row.decision, 'allow');
        assert.equal(row.statusCode, 200);
        assert.equal(row.resource, 'node:W1');
    });

    test('a handler 404 is still audited as allow — the policy did permit it', async () => {
        const { status } = await call('GET', '/api/cluster/nodes/UNKNOWN', { token: 'active' });
        assert.equal(status, 404);

        await new Promise(resolve => setImmediate(resolve));
        const row = service.audited.at(-1);
        assert.equal(row.decision, 'allow');
        assert.equal(row.statusCode, 404);
    });

    test('the node resource is derived per request, so policies can scope by node', async () => {
        const seen = [];
        await boot({}, {
            async authorize(_admin, action, resource) {
                seen.push({ action, resource });
                return { allowed: true, reason: 'policy' };
            }
        });

        await call('GET', '/api/cluster/nodes/PROD-1', { token: 'active' });

        assert.deepEqual(seen.at(-1), { action: AdminActions.READ_NODES, resource: 'node:PROD-1' });
    });

    test('a node command carries the node action in the PBAC action name', async () => {
        const seen = [];
        await boot({}, {
            async authorize(_admin, action, resource) {
                seen.push({ action, resource });
                return { allowed: true, reason: 'policy' };
            }
        });

        await call('POST', '/api/cluster/nodes/W1/command', { token: 'active', body: { action: ClusterCommands.LOCK_SERVER } });

        // This is what lets a policy grant status reads but deny lockdowns.
        assert.deepEqual(seen.at(-1), { action: `cluster:command:${ClusterCommands.LOCK_SERVER}`, resource: 'node:W1' });
    });

    test('an absent command action is gated as "unknown" rather than as a wildcard', async () => {
        const seen = [];
        await boot({}, {
            async authorize(_admin, action) {
                seen.push(action);
                return { allowed: true, reason: 'policy' };
            }
        });

        await call('POST', '/api/cluster/command-all', { token: 'active', body: {} });

        assert.equal(seen.at(-1), 'cluster:command:unknown');
    });

    test('the graded keyvault actions are distinct, so a read grant never implies a wipe', async () => {
        const seen = [];
        await boot({}, {
            async authorize(_admin, action) {
                seen.push(action);
                return { allowed: true, reason: 'policy' };
            }
        });

        await call('GET', '/api/cluster/keyvault/status', { token: 'root' });
        await call('POST', '/api/cluster/keyvault/rotate-kek', { token: 'root', body: {} });
        await call('POST', '/api/cluster/keyvault/rotate-dek', { token: 'root', body: {} });
        await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: { confirmation: 'WIPE ENCRYPTED FIELDS', reason: 'ten chars plus' } });

        assert.deepEqual(seen, [
            AdminActions.KEYVAULT_READ_STATUS,
            AdminActions.KEYVAULT_ROTATE_KEK,
            AdminActions.KEYVAULT_ROTATE_DEK,
            AdminActions.KEYVAULT_WIPE
        ]);
        assert.equal(new Set(seen).size, 4);
    });

    test('the consensus preview is gated as a READ, not as the wipe', async () => {
        const seen = [];
        await boot({}, {
            async authorize(_admin, action) {
                seen.push(action);
                return { allowed: true, reason: 'policy' };
            }
        });

        await call('POST', '/api/cluster/keyvault/confirm-unrecoverable', { token: 'active', body: {} });

        // An operator must be able to check whether a wipe would be accepted
        // without holding the grant that lets them perform one.
        assert.equal(seen.at(-1), AdminActions.KEYVAULT_READ_STATUS);
    });
});

describe('AdminServer — request validation', () => {
    beforeEach(async () => {
        await boot();
    });

    test('an unknown cluster command is refused by the allowlist, not passed through', async () => {
        const { status, body } = await call('POST', '/api/cluster/nodes/W1/command', {
            token: 'active',
            body: { action: 'server:rm-rf' }
        });

        assert.equal(status, 400);
        assert.equal(body.code, 'CLUSTER::UNKNOWN-COMMAND');
        assert.equal(orch.calls.length, 0);
    });

    test('a known command reaches the orchestrator with the admin as the principal', async () => {
        const { status } = await call('POST', '/api/cluster/nodes/W1/command', {
            token: 'active',
            body: { action: ClusterCommands.PING, args: { x: 1 } }
        });

        assert.equal(status, 200);
        const [workerId, action, args, , issuedBy] = orch.calls[0].args;
        assert.deepEqual([workerId, action, args], ['W1', ClusterCommands.PING, { x: 1 }]);
        assert.deepEqual(issuedBy, { type: 'admin', id: 'SAD_1', email: 'admin@orion.local', role: 'admin' });
    });

    test('a caller-supplied command timeout is clamped to 60s', async () => {
        await call('POST', '/api/cluster/nodes/W1/command', {
            token: 'active',
            body: { action: ClusterCommands.PING, timeoutMs: 999_999 }
        });

        assert.equal(orch.calls[0].args[3], 60_000, 'an unbounded timeout would pin a dispatcher slot indefinitely');
    });

    test('an unknown consensus topic is refused', async () => {
        const { status, body } = await call('POST', '/api/cluster/consensus', { token: 'active', body: { topic: 'made-up' } });

        assert.equal(status, 400);
        assert.equal(body.code, 'CLUSTER::UNKNOWN-TOPIC');
    });

    test('client-urls requires a non-empty array', async () => {
        for (const clientUrls of [undefined, [], 'https://a.example', {}]) {
            const { status, body } = await call('POST', '/api/cluster/client-urls', { token: 'active', body: { clientUrls } });

            assert.equal(status, 400, `accepted ${JSON.stringify(clientUrls)}`);
            assert.equal(body.code, 'CLUSTER::INVALID-CLIENT-URLS');
        }
    });

    test('secrets revoke rejects anything that is not a list of non-blank kid strings', async () => {
        for (const kids of [undefined, [], ['ok', ''], ['ok', '   '], ['ok', 42], 'kid-1']) {
            const { status, body } = await call('POST', '/api/cluster/secrets/revoke', { token: 'active', body: { kids } });

            assert.equal(status, 400, `accepted ${JSON.stringify(kids)}`);
            assert.equal(body.code, 'CLUSTER::INVALID-KIDS');
        }

        const { status } = await call('POST', '/api/cluster/secrets/revoke', { token: 'active', body: { kids: ['kid-1', 'kid-2'] } });
        assert.equal(status, 200);
    });

    test('rotate-node requires a workerId', async () => {
        const { status, body } = await call('POST', '/api/cluster/secrets/rotate-node', { token: 'active', body: { workerId: '   ' } });

        assert.equal(status, 400);
        assert.equal(body.code, 'CLUSTER::INVALID-WORKER');
    });

    test('the incident reason defaults to naming the admin who declared it', async () => {
        await call('POST', '/api/cluster/incident/declare', { token: 'active', body: {} });

        assert.equal(orch.calls.at(-1).args[0], 'declared by admin@orion.local');
    });

    test('an explicit incident reason is used verbatim', async () => {
        await call('POST', '/api/cluster/incident/resolve', { token: 'active', body: { reason: 'network restored' } });

        assert.equal(orch.calls.at(-1).args[0], 'network restored');
    });
});

describe('AdminServer — the keyvault wipe', () => {
    beforeEach(async () => {
        await boot();
    });

    const WIPE = { confirmation: 'WIPE ENCRYPTED FIELDS', reason: 'key vault destroyed in region outage' };

    test('a short or missing reason is refused before anything is destroyed', async () => {
        for (const reason of [undefined, '', '   ', 'too short']) {
            const { status, body } = await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: { ...WIPE, reason } });

            assert.equal(status, 400, `accepted reason ${JSON.stringify(reason)}`);
            assert.equal(body.code, 'KEYVAULT::REASON-REQUIRED');
            assert.equal(orch.calls.length, 0, 'the wipe ran despite an invalid reason');
        }
    });

    test('a valid wipe reaches the orchestrator with the trimmed reason', async () => {
        const { status } = await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: { ...WIPE, reason: `  ${WIPE.reason}  ` } });

        assert.equal(status, 200);
        assert.equal(orch.calls[0].args[0].reason, WIPE.reason);
    });

    test('overrideConsensus is only honoured when it is exactly true', async () => {
        await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: { ...WIPE, overrideConsensus: 'true' } });

        // A truthy string out of a form field must not override the fleet's
        // finding that the data is still recoverable.
        assert.equal(orch.calls[0].args[0].overrideConsensus, false);
    });

    test('admin TOTP enrollments are spared unless includeAdmins is set', async () => {
        const { body } = await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: WIPE });

        assert.equal(body.result.admins, null);
    });

    test('includeAdmins wipes admin enrollments and reports the count', async () => {
        const { body } = await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: { ...WIPE, includeAdmins: true } });

        assert.deepEqual(body.result.admins, { wiped: 2 });
    });

    test('a consensus refusal surfaces as 409 with the vote attached', async () => {
        await boot({
            async wipeEncryptedFields() {
                const error = new Error('Refusing to wipe encrypted fields: 2 of 3 node(s) can still decrypt');
                error.code = 'KEYVAULT::CONSENSUS-REFUSED';
                error.consensus = { decided: true, accepted: false, yes: 1, eligible: 3 };
                throw error;
            }
        });

        const { status, body } = await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: WIPE });

        // 409, not 500: the request was well-formed and the refusal is the
        // answer. The vote rides along so an operator can see who dissented.
        assert.equal(status, 409);
        assert.equal(body.code, 'KEYVAULT::CONSENSUS-REFUSED');
        assert.deepEqual(body.consensus, { decided: true, accepted: false, yes: 1, eligible: 3 });
    });

    test('a successful wipe writes its own dedicated audit row', async () => {
        await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: { ...WIPE, fields: ['totp_secret'], includeAdmins: true } });

        const row = service.audited.find(r => r.action === 'keyvault:encrypted-fields-wiped');
        assert.ok(row, 'the destructive action must be recorded beyond the route-level row');
        assert.equal(row.adminEmail, 'root@orion.local');
        assert.equal(row.details.reason, WIPE.reason);
        assert.deepEqual(row.details.fields, ['totp_secret']);
        assert.equal(row.details.adminsWiped, 2);
        assert.equal(row.details.rootAdminIncluded, false);
    });

    test('the audit row records "all" when no field list was given', async () => {
        await call('POST', '/api/cluster/keyvault/wipe', { token: 'root', body: WIPE });

        const row = service.audited.find(r => r.action === 'keyvault:encrypted-fields-wiped');
        assert.equal(row.details.fields, 'all');
    });
});

describe('AdminServer — the optional mailing plane', () => {
    test('every mailing route answers 503 naming the config key when it is disabled', async () => {
        await boot({ getMailingService: () => null });

        for (const [method, path] of [
            ['GET', '/api/mailing/jobs'],
            ['GET', '/api/mailing/queue'],
            ['GET', '/api/mailing/jobs/JOB_1'],
            ['GET', '/api/mailing/jobs/JOB_1/dead-letters'],
            ['POST', '/api/mailing/jobs/JOB_1/cancel'],
            ['GET', '/api/notifications']
        ]) {
            const { status, body } = await call(method, path, { token: 'active', body: {} });

            // A 404 here reads as a typo in the URL; a 503 naming mailing.enabled
            // tells the operator what to actually do.
            assert.equal(status, 503, `${method} ${path}`);
            assert.equal(body.code, 'MAILING::DISABLED');
            assert.match(body.message, /mailing\.enabled/);
        }
    });

    test('a job upload with no body is refused before the parser runs', async () => {
        await boot({ getMailingService: () => ({}) });

        const { status, body } = await call('POST', '/api/mailing/jobs', {
            token: 'active',
            raw: '',
            headers: { 'content-type': 'text/csv' }
        });

        assert.equal(status, 400);
        assert.equal(body.code, 'MAILING::NO-FILE');
    });

    test('an unreadable upload returns 400 rather than a 500', async () => {
        await boot({ getMailingService: () => ({}) });

        const { status, body } = await call('POST', '/api/mailing/jobs', {
            token: 'active',
            raw: 'this is not a spreadsheet at all',
            headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        });

        assert.equal(status, 400);
        assert.match(body.code, /^MAILING::/);
    });

    test('mailing reads reach the service when the plane is enabled', async () => {
        const jobs = [{ id: 'JOB_1', status: 'running' }];
        await boot({ getMailingService: () => ({ listJobs: async () => jobs, getQueueState: async () => ({ running: 1 }) }) });

        assert.deepEqual((await call('GET', '/api/mailing/jobs', { token: 'active' })).body.jobs, jobs);
        assert.deepEqual((await call('GET', '/api/mailing/queue', { token: 'active' })).body.queue, { running: 1 });
    });

    test('a cancel writes its own audit row alongside the route-level one', async () => {
        await boot({ getMailingService: () => ({ cancelJob: async () => ({ cancelled: 12 }) }) });

        const { status, body } = await call('POST', '/api/mailing/jobs/JOB_1/cancel', { token: 'active', body: { reason: 'wrong list' } });

        assert.equal(status, 200);
        assert.equal(body.cancelled, 12);

        const row = service.audited.find(r => r.action === 'mailing:job-cancelled');
        assert.equal(row.resource, 'job:JOB_1');
        assert.equal(row.details.reason, 'wrong list');
    });

    test('a cancel reason is truncated rather than stored unbounded', async () => {
        await boot({ getMailingService: () => ({ cancelJob: async () => ({ cancelled: 0 }) }) });

        await call('POST', '/api/mailing/jobs/JOB_1/cancel', { token: 'active', body: { reason: 'x'.repeat(2000) } });

        const row = service.audited.find(r => r.action === 'mailing:job-cancelled');
        assert.equal(row.details.reason.length, 500);
    });
});

describe('AdminServer — cookies', () => {
    test('the session cookie is HttpOnly, SameSite=Strict and path-scoped', async () => {
        await boot({}, { requestMagicLink: async () => {}, verifyMagicLink: async () => ({ token: 'raw-token', totpEnrolled: true }) });

        const response = await fetch(base + '/api/auth/magic-link/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: 'abc' })
        });
        const cookie = response.headers.getSetCookie().find(c => c.startsWith(SESSION_COOKIE));

        assert.ok(cookie, 'no session cookie was set');
        assert.match(cookie, /HttpOnly/, 'the token must be unreadable from JS');
        assert.match(cookie, /SameSite=Strict/, 'a cross-site POST must not carry the session');
        assert.match(cookie, /Path=\//);
        assert.match(cookie, /Max-Age=900/, 'the pending cookie lives only as long as the pending session');
    });

    test('Secure is set by default and only dropped when explicitly disabled', async () => {
        await boot({}, { verifyMagicLink: async () => ({ token: 't' }) }, { secureCookies: true });
        const secure = await fetch(base + '/api/auth/magic-link/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: 'abc' })
        });
        assert.match(secure.headers.getSetCookie().find(c => c.startsWith(SESSION_COOKIE)), /Secure/);

        await boot({}, { verifyMagicLink: async () => ({ token: 't' }) }, { secureCookies: false });
        const plain = await fetch(base + '/api/auth/magic-link/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: 'abc' })
        });
        assert.doesNotMatch(plain.headers.getSetCookie().find(c => c.startsWith(SESSION_COOKIE)), /Secure/);
    });

    test('elevation to active re-issues the cookie at the full session TTL', async () => {
        await boot({}, { totpVerify: async () => ({ token: 'elevated', admin: { id: 'SAD_1' } }) });

        const response = await fetch(base + '/api/auth/totp/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer pending-totp' },
            body: JSON.stringify({ token: '123456' })
        });
        const cookie = response.headers.getSetCookie().find(c => c.startsWith(SESSION_COOKIE));

        // 12h in seconds — the pending credential is replaced, not extended.
        assert.match(cookie, /Max-Age=43200/);
        assert.match(cookie, /elevated/);
    });

    test('logout clears the cookie with Max-Age=0', async () => {
        await boot();

        const response = await fetch(base + '/api/auth/logout', {
            method: 'POST',
            headers: { authorization: 'Bearer active' }
        });
        const cookie = response.headers.getSetCookie().find(c => c.startsWith(SESSION_COOKIE));

        assert.match(cookie, /Max-Age=0/);
        assert.match(cookie, /HttpOnly/);
    });

    test('a token with cookie-hostile characters survives the round trip', async () => {
        const token = 'a b;c=d,e';
        await boot({}, { verifyMagicLink: async () => ({ token }) });

        const response = await fetch(base + '/api/auth/magic-link/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: 'abc' })
        });
        const cookie = response.headers.getSetCookie().find(c => c.startsWith(SESSION_COOKIE));

        // The value is percent-encoded on the way out; parseCookies decodes it
        // on the way back in, so the two must agree.
        assert.match(cookie, /orch_admin_session=a%20b%3Bc%3Dd%2Ce/);
    });
});

describe('AdminServer — auth rate limiting', () => {
    test('the limiter refuses the 11th attempt in the window with 429', async () => {
        await boot({}, { requestMagicLink: async () => {} }, { authRateLimit: { max: 10, windowMs: 60_000 } });

        const statuses = [];
        for (let i = 0; i < 12; i++) {
            statuses.push((await call('POST', '/api/auth/magic-link', { body: { email: 'a@b.c' } })).status);
        }

        assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
        assert.deepEqual(statuses.slice(10), [429, 429]);
    });

    test('a rate-limited response names the reason', async () => {
        await boot({}, { requestMagicLink: async () => {} }, { authRateLimit: { max: 1, windowMs: 60_000 } });

        await call('POST', '/api/auth/magic-link', { body: { email: 'a@b.c' } });
        const { status, body } = await call('POST', '/api/auth/magic-link', { body: { email: 'a@b.c' } });

        assert.equal(status, 429);
        assert.equal(body.code, 'AUTH::RATE-LIMITED');
    });

    test('the window expires and the budget resets', async () => {
        await boot({}, { requestMagicLink: async () => {} }, { authRateLimit: { max: 1, windowMs: 1 } });

        await call('POST', '/api/auth/magic-link', { body: { email: 'a@b.c' } });
        await new Promise(resolve => setTimeout(resolve, 15));

        assert.equal((await call('POST', '/api/auth/magic-link', { body: { email: 'a@b.c' } })).status, 200);
    });

    test('the limiter guards every credential-accepting endpoint', async () => {
        // Endpoints that consume a secret (password, TOTP code, magic-link code)
        // are the ones brute force targets; unlimited attempts on any of them
        // makes the other limits pointless.
        await boot({}, {
            requestMagicLink: async () => {},
            verifyMagicLink: async () => ({ token: 't' }),
            rootLogin: async () => ({ token: 't' }),
            totpVerify: async () => ({ token: 't' }),
            totpActivate: async () => ({ token: 't' }),
            rootChangePassword: async () => ({ ok: true })
        }, { authRateLimit: { max: 1, windowMs: 60_000 } });

        await call('POST', '/api/auth/magic-link', { body: { email: 'a@b.c' } });

        for (const path of [
            '/api/auth/magic-link',
            '/api/auth/magic-link/verify',
            '/api/auth/root/login',
            '/api/auth/totp/verify',
            '/api/auth/totp/activate',
            '/api/auth/root/change-password'
        ]) {
            const { status } = await call('POST', path, { token: 'active', body: {} });
            assert.equal(status, 429, `${path} is not rate limited`);
        }
    });

    test('the magic-link response is identical whether or not the email exists', async () => {
        const seen = [];
        await boot({}, { requestMagicLink: async email => void seen.push(email) }, { authRateLimit: { max: 100, windowMs: 60_000 } });

        const known = await call('POST', '/api/auth/magic-link', { body: { email: 'admin@orion.local' } });
        const unknown = await call('POST', '/api/auth/magic-link', { body: { email: 'nobody@nowhere.test' } });

        // Any difference here is a user-enumeration oracle.
        assert.deepEqual(known, { ...known, status: unknown.status });
        assert.deepEqual(known.body, unknown.body);
        assert.deepEqual(known.body, { error: false, requested: true });
        assert.deepEqual(seen, ['admin@orion.local', 'nobody@nowhere.test']);
    });
});

describe('AdminServer — the error handler', () => {
    beforeEach(async () => {
        await boot();
    });

    test('an unknown endpoint is a JSON 404, not an HTML stack', async () => {
        const { status, body } = await call('GET', '/api/nope');

        assert.equal(status, 404);
        assert.equal(body.code, 'API::NOT-FOUND');
    });

    test('an AdminError maps to its own status and code', async () => {
        await boot({}, {
            async listAdmins() {
                throw new AdminError('GOV::NOT-FOUND', 'No such admin', 404);
            }
        });

        const { status, body } = await call('GET', '/api/admins', { token: 'root' });

        assert.equal(status, 404);
        assert.deepEqual({ code: body.code, message: body.message }, { code: 'GOV::NOT-FOUND', message: 'No such admin' });
    });

    test('a MAILING:: error is honoured without the mailing plane being loaded here', async () => {
        await boot({
            getMailingService: () => ({
                async listJobs() {
                    const err = new Error('Job not found');
                    err.code = 'MAILING::JOB-NOT-FOUND';
                    err.status = 404;
                    err.details = ['JOB_1'];
                    throw err;
                }
            })
        });

        const { status, body } = await call('GET', '/api/mailing/jobs', { token: 'active' });

        assert.equal(status, 404);
        assert.equal(body.code, 'MAILING::JOB-NOT-FOUND');
        assert.deepEqual(body.details, ['JOB_1']);
    });

    test('malformed JSON is a 400, not a 500', async () => {
        const { status, body } = await call('POST', '/api/auth/magic-link', {
            raw: '{"email": ',
            headers: { 'content-type': 'application/json' }
        });

        assert.equal(status, 400);
        assert.equal(body.code, 'API::BAD-BODY');
    });

    test('an oversized JSON body is a 413', async () => {
        const { status, body } = await call('POST', '/api/auth/magic-link', {
            raw: JSON.stringify({ email: 'x'.repeat(200_000) }),
            headers: { 'content-type': 'application/json' }
        });

        assert.equal(status, 413);
        assert.equal(body.code, 'API::BODY-TOO-LARGE');
    });

    test('an unexpected handler error is a generic 500 that leaks nothing', async () => {
        await boot({
            async getClusterStatus() {
                throw new Error('pg: password authentication failed for user "orch"');
            }
        });

        const { status, body } = await call('GET', '/api/cluster/status', { token: 'active' });

        assert.equal(status, 500);
        assert.deepEqual(body, { error: true, code: 'API::INTERNAL', message: 'Internal error' });
        assert.doesNotMatch(JSON.stringify(body), /password/);
    });

    test('an unexpected error is audited with the underlying message for operators', async () => {
        await boot({
            async getClusterStatus() {
                throw new Error('pg: connection refused');
            }
        });

        await call('GET', '/api/cluster/status', { token: 'active' });
        await new Promise(resolve => setImmediate(resolve));

        // The detail the client is denied still has to reach the audit trail.
        const row = service.audited.find(r => r.action === 'api:error');
        assert.equal(row.statusCode, 500);
        assert.match(row.details.message, /connection refused/);
    });

    test('a 500 is audited by the PBAC gate as an error, not as an allow', async () => {
        await boot({
            async getClusterStatus() {
                throw new Error('boom');
            }
        });

        await call('GET', '/api/cluster/status', { token: 'active' });
        await new Promise(resolve => setImmediate(resolve));

        const row = service.audited.find(r => r.action === AdminActions.READ_STATUS);
        assert.equal(row.decision, 'error');
        assert.equal(row.statusCode, 500);
    });
});

describe('AdminServer — audit rows', () => {
    beforeEach(async () => {
        await boot();
    });

    test('every audited row identifies the admin, the request and the outcome', async () => {
        await call('GET', '/api/cluster/health', { token: 'active' });
        await new Promise(resolve => setImmediate(resolve));

        const row = service.audited.at(-1);
        assert.equal(row.adminId, 'SAD_1');
        assert.equal(row.adminEmail, 'admin@orion.local');
        assert.equal(row.method, 'GET');
        assert.equal(row.path, '/api/cluster/health');
        assert.equal(row.action, AdminActions.READ_HEALTH);
        assert.equal(row.decision, 'allow');
        assert.ok(row.ip, 'the source address must be recorded');
    });

    test('a database-level audit failure is fail-open for reads and never reaches the client', async () => {
        // The real AuditLog against a database that is down — writeSafe fires
        // and forgets, so an unreachable audit table must degrade to a logged
        // error rather than a 500 on an otherwise valid read.
        const failing = new AuditLog({
            async query() {
                throw new Error('pg: the database system is starting up');
            }
        });
        await boot({}, { audit: Object.assign(failing, { list: async () => [] }) });

        const { status, body } = await call('GET', '/api/cluster/health', { token: 'active' });

        assert.equal(status, 200);
        assert.deepEqual(body.health, { state: 'HEALTHY' });

        // And the rejection must stay swallowed — an unhandled one from the
        // res.on('finish') handler would take the orchestrator process down.
        await new Promise(resolve => setImmediate(resolve));
    });
});

describe('AdminServer — GUI theming and path resolution', () => {
    test('an unknown theme falls back to modern rather than serving a broken page', () => {
        assert.equal(new AdminServer(fakeOrch(), fakeService(), { theme: 'neon' }).guiTheme, 'modern');
        assert.equal(new AdminServer(fakeOrch(), fakeService(), { theme: 'classic' }).guiTheme, 'classic');
        assert.equal(new AdminServer(fakeOrch(), fakeService(), {}).guiTheme, 'modern');
    });

    test('the theme name is normalised for case and whitespace', () => {
        assert.equal(new AdminServer(fakeOrch(), fakeService(), { theme: '  CLASSIC ' }).guiTheme, 'classic');
    });

    test('config beats the environment variable', () => {
        const previous = process.env.ORION_GUI_THEME;
        process.env.ORION_GUI_THEME = 'classic';
        try {
            assert.equal(new AdminServer(fakeOrch(), fakeService(), {}).guiTheme, 'classic', 'env applies when config is silent');
            assert.equal(new AdminServer(fakeOrch(), fakeService(), { theme: 'modern' }).guiTheme, 'modern');
        } finally {
            if (previous === undefined) delete process.env.ORION_GUI_THEME;
            else process.env.ORION_GUI_THEME = previous;
        }
    });

    test('_resolveHtml refuses to escape the GUI directory', () => {
        const app = new AdminServer(fakeOrch(), fakeService(), {});

        for (const attempt of [
            '/../../../../etc/passwd',
            '/../../lib/SystemAdmin/AdminServer.js',
            '/%2e%2e%2f%2e%2e%2fpackage.json',
            '/..%2f..%2fpackage.json'
        ]) {
            assert.equal(app._resolveHtml(attempt), null, `traversal escaped via ${attempt}`);
        }
    });

    test('_themedHtml stamps the theme onto <html> and replaces any pre-existing one', () => {
        const app = new AdminServer(fakeOrch(), fakeService(), { theme: 'classic' });
        const file = join(TEST_ARTIFACTS_DIR, 'themed.html');

        writeFileSync(file, '<!doctype html><html lang="en" data-theme="modern" class="x"><body>hi</body></html>');
        const stamped = app._themedHtml(file);

        assert.match(stamped, /data-theme="classic"/);
        assert.doesNotMatch(stamped, /data-theme="modern"/, 'a stale theme must be stripped, not duplicated');
        assert.match(stamped, /lang="en"/, 'unrelated attributes survive');
        assert.match(stamped, /class="x"/);
        assert.equal(stamped.match(/data-theme=/g).length, 1);
    });

    test('_themedHtml caches per file, so the document is read once', () => {
        const app = new AdminServer(fakeOrch(), fakeService(), {});
        const file = join(TEST_ARTIFACTS_DIR, 'cached.html');

        writeFileSync(file, '<html><body>first</body></html>');
        assert.match(app._themedHtml(file), /first/);

        writeFileSync(file, '<html><body>second</body></html>');
        assert.match(app._themedHtml(file), /first/, 'the second read must come from the cache');
    });

    test('a document with no <html> tag passes through untouched', () => {
        const app = new AdminServer(fakeOrch(), fakeService(), {});
        const file = join(TEST_ARTIFACTS_DIR, 'fragment.html');

        writeFileSync(file, '<div>fragment</div>');
        assert.equal(app._themedHtml(file), '<div>fragment</div>');
    });
});

describe('AdminServer — trust proxy', () => {
    test('the client IP is taken from the socket when proxy trust is off', async () => {
        await boot({}, {}, { trustProxy: false });

        await call('GET', '/api/cluster/health', { token: 'active', headers: { 'x-forwarded-for': '203.0.113.9' } });
        await new Promise(resolve => setImmediate(resolve));

        // Trusting a forwarded header by default would let any client forge the
        // address in its own audit rows and dodge the per-IP rate limiter.
        assert.notEqual(service.audited.at(-1).ip, '203.0.113.9');
    });

    test('a forwarded address is honoured once proxy trust is configured', async () => {
        await boot({}, {}, { trustProxy: 1 });

        await call('GET', '/api/cluster/health', { token: 'active', headers: { 'x-forwarded-for': '203.0.113.9' } });
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(service.audited.at(-1).ip, '203.0.113.9');
    });
});
