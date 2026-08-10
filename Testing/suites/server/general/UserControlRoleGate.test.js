import '../../../helpers/bootstrap.js';
import test, { describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { userControl } from '../../../../Packages/server/Orion-core/lib/Utils/Core/AccountManagment/UserControl.js';

/**
 * updateUserRole — validation gates, the allowlist lookup, and the write.
 *
 * `UserModel` reaches the database through globalAccessPoint's `db` module, so a
 * recording fake standing in for it keeps this suite hermetic while still
 * exercising the real UserModel SQL. What stays 🔌 in the integration harness is
 * whether Postgres honours that SQL — not whether UserControl issues it.
 *
 * The custom-role defect this pins: the allowlist lookup at gate 4 read
 * `undefined` from globalAccessPoint because the boot-time setter used a
 * misspelled config path, so every custom-role assignment was refused before any
 * database work happened.
 */

const KNOWN_UID = 'UID_EXISTS_0001';
const MISSING_UID = 'UID_ABSENT_0002';

// ── Recording fake for the `db` module ───────────────────────────────────────
// `db` is a locked GAP key (settable once, never overwritten), so it is a single
// stateful object installed in `before` and reset per test.
const queries = [];
const fakeDb = {
    async query(text, params) {
        queries.push({ text, params });

        if (/SELECT \* FROM users WHERE uid/i.test(text)) {
            return params?.[0] === KNOWN_UID ? { rows: [{ uid: KNOWN_UID, email: 'known@orion.local', role: 'USER', disabled: false }] } : { rows: [] };
        }

        return { rows: [], rowCount: 1 };
    }
};

const auditRecords = [];
const auditStub = {
    record(entry) {
        auditRecords.push(entry);
        return { error: false };
    }
};

before(() => {
    // `db` is locked; `auditTrailSystem` is not.
    assert.equal(globalAccessPoint.setValue('db', fakeDb), true, 'db was already set — cannot install the fake');
    globalAccessPoint.setValue('auditTrailSystem', auditStub);
});

beforeEach(() => {
    auditRecords.length = 0;
    queries.length = 0;
    globalAccessPoint.setValue('allowedUserRoles', undefined);
});

const lastRecord = () => auditRecords[auditRecords.length - 1];
const roleUpdateQuery = () => queries.find(q => /UPDATE users SET role/i.test(q.text));

describe('updateUserRole — argument gates', () => {
    test('a missing role is refused', async () => {
        const result = await userControl.updateUserRole(KNOWN_UID, undefined, false);

        assert.equal(result.error, true);
        assert.equal(result.errorCode, 'USER-CONTROL::NO-ROLE-PROVIDED::A::p');
        assert.equal(lastRecord().status, 'FAILED');
        assert.equal(lastRecord().metadata.reason, 'NO_ROLE_PROVIDED');
        assert.equal(queries.length, 0, 'refusal must not touch the database');
    });

    test('a missing uid is refused', async () => {
        const result = await userControl.updateUserRole(undefined, 'ADMIN', false);

        assert.equal(result.error, true);
        assert.equal(result.errorCode, 'USER-CONTROL::NO-UID-PROVIDED::A::p');
        assert.equal(lastRecord().metadata.reason, 'NO_UID_PROVIDED');
        assert.equal(queries.length, 0);
    });

    test('the role check runs before the uid check', async () => {
        // Pins the documented ordering: both missing reports the role first.
        const result = await userControl.updateUserRole(undefined, undefined, false);

        assert.equal(result.errorCode, 'USER-CONTROL::NO-ROLE-PROVIDED::A::p');
    });

    test('a uid with no matching user is refused after validation passes', async () => {
        const result = await userControl.updateUserRole(MISSING_UID, 'ADMIN', false);

        assert.equal(result.errorCode, 'USER-CONTROL::NO-SUCH-USER::A::p');
        assert.equal(lastRecord().metadata.reason, 'USER_NOT_FOUND');
        assert.equal(roleUpdateQuery(), undefined, 'no write for a user that does not exist');
    });
});

describe('updateUserRole — standard roles without custom roles enabled', () => {
    test('a non-standard role is refused when customRolesAllowed is false', async () => {
        const result = await userControl.updateUserRole(KNOWN_UID, 'AUDITOR', false);

        assert.equal(result.error, true);
        assert.equal(result.errorCode, 'USER-CONTROL::NOT-STANDARD-ROLE::A::p');
        assert.equal(lastRecord().metadata.reason, 'NOT_STANDARD_ROLE');
        assert.equal(queries.length, 0);
    });

    test('the allowlist is ignored entirely when customRolesAllowed is false', async () => {
        // customRolesAllowed is caller-asserted, not derived from config: a
        // configured allowlist does NOT implicitly widen a `false` call.
        globalAccessPoint.setValue('allowedUserRoles', ['USER', 'ADMIN', 'AUDITOR']);

        const result = await userControl.updateUserRole(KNOWN_UID, 'AUDITOR', false);

        assert.equal(result.errorCode, 'USER-CONTROL::NOT-STANDARD-ROLE::A::p');
    });

    test('USER and ADMIN both pass without any configuration', async () => {
        for (const role of ['USER', 'ADMIN']) {
            queries.length = 0;
            const result = await userControl.updateUserRole(KNOWN_UID, role, false);

            assert.equal(result.error, false, `${role} should be assignable out of the box`);
            assert.equal(result.updated, true);
        }
    });

    test('role matching is case-insensitive and the stored value is uppercased', async () => {
        const result = await userControl.updateUserRole(KNOWN_UID, 'admin', false);

        assert.equal(result.error, false);
        assert.equal(roleUpdateQuery().params[0], 'ADMIN');
    });
});

describe('updateUserRole — the custom-role allowlist gate', () => {
    test('an unconfigured allowlist refuses the assignment', async () => {
        // The state the misspelled config path produced: config was valid, boot
        // was clean, and the store held undefined.
        const result = await userControl.updateUserRole(KNOWN_UID, 'AUDITOR', true);

        assert.equal(result.error, true);
        assert.equal(result.errorCode, 'USER-CONTROL::CUSTOM-ROLES-NOT-CONFIGURED::A::i');
        assert.equal(lastRecord().metadata.reason, 'CUSTOM_ROLES_NOT_CONFIGURED');
        assert.equal(queries.length, 0);
    });

    test('null (custom roles deliberately off) refuses the same way', async () => {
        globalAccessPoint.setValue('allowedUserRoles', null);

        const result = await userControl.updateUserRole(KNOWN_UID, 'AUDITOR', true);

        assert.equal(result.errorCode, 'USER-CONTROL::CUSTOM-ROLES-NOT-CONFIGURED::A::i');
    });

    test('a role outside a configured allowlist is refused, and the audit names the allowlist', async () => {
        globalAccessPoint.setValue('allowedUserRoles', ['USER', 'ADMIN', 'AUDITOR']);

        const result = await userControl.updateUserRole(KNOWN_UID, 'SUPERUSER', true);

        assert.equal(result.error, true);
        assert.equal(result.errorCode, 'USER-CONTROL::ROLE-NOT-FOUND-IN-CONFIG::A::p');
        assert.deepEqual(lastRecord().metadata.allowedRoles, ['USER', 'ADMIN', 'AUDITOR']);
        assert.equal(queries.length, 0);
    });

    test('an allowlisted custom role is assigned end to end', async () => {
        globalAccessPoint.setValue('allowedUserRoles', ['USER', 'ADMIN', 'AUDITOR']);

        const result = await userControl.updateUserRole(KNOWN_UID, 'AUDITOR', true);

        // With the config bug present this returned CUSTOM-ROLES-NOT-CONFIGURED
        // and never reached the write.
        assert.equal(result.error, false);
        assert.equal(result.updated, true);
        assert.equal(roleUpdateQuery().params[0], 'AUDITOR');
    });

    test('a lowercase custom role is uppercased before the allowlist comparison', async () => {
        globalAccessPoint.setValue('allowedUserRoles', ['AUDITOR']);

        const result = await userControl.updateUserRole(KNOWN_UID, 'auditor', true);

        assert.equal(result.error, false);
        assert.equal(roleUpdateQuery().params[0], 'AUDITOR');
    });

    test('a standard role is NOT implicitly allowed once customRolesAllowed is true', async () => {
        // The allowlist REPLACES the standard set rather than extending it. This
        // is the next surprise after the config fix, so it is pinned deliberately:
        // an allowlist omitting ADMIN makes `updateUserRole(uid, 'ADMIN', true)`
        // fail even though ADMIN is a standard role.
        globalAccessPoint.setValue('allowedUserRoles', ['AUDITOR']);

        const result = await userControl.updateUserRole(KNOWN_UID, 'ADMIN', true);

        assert.equal(result.errorCode, 'USER-CONTROL::ROLE-NOT-FOUND-IN-CONFIG::A::p');
    });
});

describe('updateUserRole — the write invalidates live sessions', () => {
    test('the role UPDATE also moves sessions_valid_from', async () => {
        // This is what makes a demotion bite instead of propagating stale
        // privilege for as long as the session keeps refreshing. If the watermark
        // bump is ever dropped from the same statement, a demoted user keeps
        // their old role until their refresh token expires.
        const result = await userControl.updateUserRole(KNOWN_UID, 'USER', false);

        assert.equal(result.error, false);
        const write = roleUpdateQuery();
        assert.match(write.text, /sessions_valid_from\s*=\s*NOW\(\)/i);
        assert.match(write.text, /updated_at\s*=\s*NOW\(\)/i);
        assert.deepEqual(write.params, ['USER', KNOWN_UID]);
    });

    test('a successful change is audited with both the previous and the new role', async () => {
        globalAccessPoint.setValue('allowedUserRoles', ['AUDITOR']);

        await userControl.updateUserRole(KNOWN_UID, 'AUDITOR', true);

        const record = lastRecord();
        assert.equal(record.action, 'USER_ROLE_UPDATED');
        assert.equal(record.status, 'SUCCESS');
        assert.equal(record.metadata.previousRole, 'USER');
        assert.equal(record.metadata.newRole, 'AUDITOR');
        assert.equal(record.metadata.customRolesAllowed, true);
    });
});

describe('updateUserRole — every refusal is audited', () => {
    test('each failure path writes exactly one FAILED record carrying its error code', async () => {
        const cases = [
            [[KNOWN_UID, undefined, false], 'USER-CONTROL::NO-ROLE-PROVIDED::A::p'],
            [[undefined, 'ADMIN', false], 'USER-CONTROL::NO-UID-PROVIDED::A::p'],
            [[KNOWN_UID, 'AUDITOR', false], 'USER-CONTROL::NOT-STANDARD-ROLE::A::p'],
            [[KNOWN_UID, 'AUDITOR', true], 'USER-CONTROL::CUSTOM-ROLES-NOT-CONFIGURED::A::i'],
            [[MISSING_UID, 'ADMIN', false], 'USER-CONTROL::NO-SUCH-USER::A::p']
        ];

        for (const [args, expectedCode] of cases) {
            auditRecords.length = 0;
            const result = await userControl.updateUserRole(...args);

            assert.equal(result.errorCode, expectedCode);
            assert.equal(auditRecords.length, 1, `expected one audit record for ${expectedCode}`);
            assert.equal(auditRecords[0].action, 'USER_ROLE_UPDATE_ATTEMPT');
            assert.equal(auditRecords[0].status, 'FAILED');
            assert.equal(auditRecords[0].errorCode, expectedCode);
            assert.equal(auditRecords[0].functionName, 'updateUserRole');
        }
    });
});
