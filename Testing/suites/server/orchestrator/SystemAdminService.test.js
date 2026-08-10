import '../../../helpers/bootstrap.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as plane from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/index.js';
import { SystemAdminService } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/SystemAdminService.js';

/**
 * SystemAdminService — the parts that need no Postgres.
 *
 * The constructor only wraps `db` in model classes without querying, so a
 * recording fake covers authorization end to end: real PBACEngine evaluation
 * driven by real effective-policy SQL. Governance mutations, magic links,
 * sessions and TOTP enrollment write rows and stay 🔌.
 *
 * A hard lesson is encoded in the first suite below: `totpVerify` once declared
 * `const fresh` twice in one scope, which is a SyntaxError, so the module could
 * not be imported at all — the whole system-admin plane was dead. Nothing caught
 * it because no suite imported the plane. A smoke import is now the cheapest
 * possible guard against a repeat.
 */

const fakeDb = (rowsByPattern = []) => ({
    queries: [],
    async query(text, params) {
        this.queries.push({ text, params });
        const hit = rowsByPattern.find(([pattern]) => pattern.test(text));
        return { rows: hit ? hit[1] : [], rowCount: hit ? hit[1].length : 0 };
    }
});

const policyRow = (name, statements) => ({ id: `POL_${name}`, name, document: { version: 1, statements } });

const admin = (overrides = {}) => ({ id: 'ADM_1', email: 'admin@orion.local', role: 'admin', status: 'active', ...overrides });

describe('system-admin plane — module load', () => {
    test('the plane imports and exports its full surface', () => {
        // Regression guard for the duplicate-declaration SyntaxError that made
        // every export below unreachable.
        for (const name of [
            'SystemAdminService',
            'AdminServer',
            'AdminActions',
            'AdminDatabase',
            'AdminError',
            'AuditLog',
            'SystemAdminModel',
            'PolicyModel',
            'GroupModel',
            'MagicLinkModel',
            'SessionModel',
            'evaluate',
            'validatePolicyDocument',
            'matchesPattern',
            'commandAction',
            'nodeResource',
            'hashPassword',
            'verifyPassword'
        ]) {
            assert.ok(name in plane, `missing export: ${name}`);
        }
    });

    test('the service constructs without touching the database', () => {
        const db = fakeDb();
        const service = new SystemAdminService(db, {});

        assert.equal(db.queries.length, 0);
        assert.equal(typeof service.authorize, 'function');
        assert.ok(service.admins && service.policies && service.groups && service.sessions);
    });

    test('config defaults are applied and overridable', () => {
        const defaults = new SystemAdminService(fakeDb(), {});
        assert.equal(defaults.config.magicLinkTtlMinutes, 10);
        assert.equal(defaults.config.pendingSessionTtlMinutes, 15);
        assert.equal(defaults.config.sessionTtlHours, 12);

        const custom = new SystemAdminService(fakeDb(), { sessionTtlHours: 1, totpIssuer: 'Acme' });
        assert.equal(custom.config.sessionTtlHours, 1);
        assert.equal(custom.config.totpIssuer, 'Acme');
        // Unspecified keys keep their defaults rather than becoming undefined.
        assert.equal(custom.config.magicLinkTtlMinutes, 10);
    });
});

describe('SystemAdminService — TOTP codes are single-use', () => {
    let service;

    beforeEach(() => {
        service = new SystemAdminService(fakeDb(), {});
    });

    test('the first claim succeeds and an immediate replay is refused', () => {
        assert.equal(service._claimTotpCode('ADM_1', '123456'), true);
        assert.equal(service._claimTotpCode('ADM_1', '123456'), false);
        assert.equal(service._claimTotpCode('ADM_1', '123456'), false);
    });

    test('the claim is scoped per admin — one admin cannot burn another admin code', () => {
        assert.equal(service._claimTotpCode('ADM_1', '123456'), true);
        assert.equal(service._claimTotpCode('ADM_2', '123456'), true);
    });

    test('different codes for the same admin are tracked independently', () => {
        assert.equal(service._claimTotpCode('ADM_1', '111111'), true);
        assert.equal(service._claimTotpCode('ADM_1', '222222'), true);
        assert.equal(service._claimTotpCode('ADM_1', '111111'), false);
    });

    test('an expired entry is swept, so the map does not grow without bound', () => {
        service._claimTotpCode('ADM_1', '123456');
        assert.equal(service._consumedTotp.size, 1);

        // Backdate the entry past its retention rather than sleeping ~120s.
        service._consumedTotp.set('ADM_1:123456', Date.now() - 1);

        // The sweep runs on the next claim; the stale key is dropped.
        assert.equal(service._claimTotpCode('ADM_9', '999999'), true);
        assert.equal(service._consumedTotp.has('ADM_1:123456'), false);
    });

    test('retention outlives the TOTP validity window', () => {
        // A code stays arithmetically valid for ~90s (30s step, ±1 step). If
        // retention were shorter, a code could be replayed while still valid.
        service._claimTotpCode('ADM_1', '123456');
        const expiry = service._consumedTotp.get('ADM_1:123456');

        assert.ok(expiry - Date.now() > 90 * 1000, 'retention must exceed the ~90s validity window');
    });
});

describe('SystemAdminService — authorize()', () => {
    test('root bypasses PBAC without reading any policy', async () => {
        const db = fakeDb();
        const service = new SystemAdminService(db, {});

        const verdict = await service.authorize(admin({ role: 'root' }), 'cluster:ops:lock', 'cluster');

        assert.equal(verdict.allowed, true);
        assert.equal(verdict.reason, 'root');
        assert.deepEqual(verdict.policies, []);
        assert.equal(db.queries.length, 0, 'root must not require a policy lookup');
    });

    test('a non-root admin with no attachments is denied by default', async () => {
        const service = new SystemAdminService(fakeDb(), {});

        const verdict = await service.authorize(admin(), 'cluster:read:status', 'cluster');

        assert.equal(verdict.allowed, false);
        assert.equal(verdict.reason, 'default-deny');
    });

    test('an attached policy grants exactly what it names', async () => {
        const db = fakeDb([[/FROM orch_admin_policies/i, [policyRow('read-only', [{ sid: 'ro', effect: 'allow', actions: ['cluster:read:*'], resources: ['*'] }])]]]);
        const service = new SystemAdminService(db, {});

        const allowed = await service.authorize(admin(), 'cluster:read:status', 'cluster');
        assert.equal(allowed.allowed, true);
        assert.deepEqual(allowed.policies, ['read-only']);

        const denied = await service.authorize(admin(), 'cluster:ops:lock', 'cluster');
        assert.equal(denied.allowed, false);
        assert.equal(denied.reason, 'default-deny');
    });

    test('a deny in any attached policy overrides an allow in another', async () => {
        const db = fakeDb([
            [
                /FROM orch_admin_policies/i,
                [
                    policyRow('broad', [{ sid: 'all', effect: 'allow', actions: ['*'], resources: ['*'] }]),
                    policyRow('guard', [{ sid: 'no-lock', effect: 'deny', actions: ['cluster:ops:lock'], resources: ['*'] }])
                ]
            ]
        ]);
        const service = new SystemAdminService(db, {});

        const verdict = await service.authorize(admin(), 'cluster:ops:lock', 'cluster');

        assert.equal(verdict.allowed, false);
        assert.equal(verdict.reason, 'explicit-deny');
        assert.equal(verdict.matchedSid, 'no-lock');
    });

    test('the effective-policy query unions direct and group attachments', async () => {
        const db = fakeDb();
        const service = new SystemAdminService(db, {});

        await service.authorize(admin(), 'cluster:read:status', 'cluster');

        const sql = db.queries[0].text;
        assert.match(sql, /principal_type = 'admin'/);
        assert.match(sql, /principal_type = 'group'/);
        assert.match(sql, /orch_admin_group_members/);
        assert.deepEqual(db.queries[0].params, ['ADM_1']);
    });

    test('resource scoping distinguishes nodes', async () => {
        const db = fakeDb([
            [
                /FROM orch_admin_policies/i,
                [
                    policyRow('ops', [
                        { sid: 'cmd', effect: 'allow', actions: ['cluster:command:*'], resources: ['*'] },
                        { sid: 'protect-prod', effect: 'deny', actions: ['cluster:command:*'], resources: ['node:PROD-1'] }
                    ])
                ]
            ]
        ]);
        const service = new SystemAdminService(db, {});

        assert.equal((await service.authorize(admin(), 'cluster:command:server:lock', 'node:STAGE-1')).allowed, true);
        assert.equal((await service.authorize(admin(), 'cluster:command:server:lock', 'node:PROD-1')).allowed, false);
    });

    test('governance actions are not grantable by policy', async () => {
        // Listed in the vocabulary for audit labelling only. A policy naming them
        // must not let a non-root admin through the role gate — the route layer
        // and _assertRoot both check role, never policy.
        const db = fakeDb([[/FROM orch_admin_policies/i, [policyRow('sneaky', [{ sid: 'gov', effect: 'allow', actions: ['governance:*'], resources: ['*'] }])]]]);
        const service = new SystemAdminService(db, {});

        // PBAC itself will match the pattern — that is expected and harmless...
        assert.equal((await service.authorize(admin(), 'governance:admins', 'cluster')).allowed, true);

        // ...because governance is role-gated independently. A non-root actor is
        // refused regardless of the verdict above.
        assert.throws(() => service._assertRoot(admin({ role: 'admin' })), /GOV::ROOT-ONLY|root admin/);
        assert.doesNotThrow(() => service._assertRoot(admin({ role: 'root' })));
    });

    test('_assertRoot rejects a missing or malformed actor', () => {
        const service = new SystemAdminService(fakeDb(), {});

        assert.throws(() => service._assertRoot(undefined), /root admin/);
        assert.throws(() => service._assertRoot({}), /root admin/);
        assert.throws(() => service._assertRoot({ role: 'ROOT' }), /root admin/, 'role comparison is case-sensitive');
    });
});

describe('SystemAdminService — governance is refused for non-root before any write', () => {
    const NON_ROOT = admin({ role: 'admin' });

    // Every governance entry point, named explicitly rather than probed. If a new
    // one is added without _assertRoot, this list goes stale and the completeness
    // assertion below fails — which is the point.
    const GOVERNANCE_CALLS = {
        createAdmin: s => s.createAdmin(NON_ROOT, { email: 'new@orion.local' }),
        listAdmins: s => s.listAdmins(NON_ROOT),
        setAdminStatus: s => s.setAdminStatus(NON_ROOT, 'ADM_2', 'suspended'),
        deleteAdmin: s => s.deleteAdmin(NON_ROOT, 'ADM_2'),
        createPolicy: s => s.createPolicy(NON_ROOT, { name: 'p', document: { version: 1, statements: [] } }),
        updatePolicy: s => s.updatePolicy(NON_ROOT, 'POL_1', { name: 'p2' }),
        deletePolicy: s => s.deletePolicy(NON_ROOT, 'POL_1'),
        attachPolicy: s => s.attachPolicy(NON_ROOT, 'POL_1', 'admin', 'ADM_2'),
        detachPolicy: s => s.detachPolicy(NON_ROOT, 'POL_1', 'admin', 'ADM_2'),
        createGroup: s => s.createGroup(NON_ROOT, { name: 'g' }),
        deleteGroup: s => s.deleteGroup(NON_ROOT, 'GRP_1'),
        addGroupMember: s => s.addGroupMember(NON_ROOT, 'GRP_1', 'ADM_2'),
        removeGroupMember: s => s.removeGroupMember(NON_ROOT, 'GRP_1', 'ADM_2')
    };

    test('every governance method exists — no entry here is silently skipped', () => {
        const service = new SystemAdminService(fakeDb(), {});

        for (const name of Object.keys(GOVERNANCE_CALLS)) {
            assert.equal(typeof service[name], 'function', `${name} is not a method — this test list is stale`);
        }
    });

    test('every governance method refuses a non-root actor with 403 and no database write', async () => {
        for (const [name, invoke] of Object.entries(GOVERNANCE_CALLS)) {
            const db = fakeDb();
            const service = new SystemAdminService(db, {});

            await assert.rejects(
                invoke(service),
                err => {
                    assert.match(err.message, /root admin/, `${name} rejected for the wrong reason`);
                    assert.equal(err.code, 'GOV::ROOT-ONLY', `${name} used the wrong error code`);
                    assert.equal(err.status, 403, `${name} used the wrong status`);
                    return true;
                },
                `${name} did not refuse a non-root actor`
            );

            assert.equal(db.queries.length, 0, `${name} touched the database before the role check`);
        }
    });

    test('the governance surface matches the root-only action vocabulary', () => {
        // The vocabulary declares three governance actions; the service exposes
        // admin, policy and group management to match. This pins the pairing so a
        // fourth governance area cannot appear without a deliberate decision.
        assert.deepEqual(Object.keys(plane.AdminActions).filter(k => plane.AdminActions[k].startsWith('governance:')).sort(), [
            'MANAGE_ADMINS',
            'MANAGE_GROUPS',
            'MANAGE_POLICIES'
        ]);
    });
});
