import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { AdminActions, commandAction, nodeResource, CLUSTER_RESOURCE } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/adminActions.js';
import { matchesPattern } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/PBACEngine.js';

/**
 * The PBAC action vocabulary is a wire contract in three directions: policy
 * documents stored in Postgres name these strings, the panel and CLI send them,
 * and audit rows record them. Renaming one silently voids every policy that
 * referenced it — statements stop matching and, because evaluation is default
 * deny, an operator loses access with no error pointing at the cause. A deny
 * statement that stops matching is worse still: it fails open.
 *
 * Hence these are pinned as literals rather than derived from the enum.
 */

const EXPECTED = {
    READ_STATUS: 'cluster:read:status',
    READ_NODES: 'cluster:read:nodes',
    READ_HEALTH: 'cluster:read:health',
    READ_ESCALATIONS: 'cluster:read:escalations',
    READ_CONSENSUS: 'cluster:read:consensus',
    READ_POLICY_RULES: 'cluster:read:policy-rules',
    READ_POLICY_OUTCOMES: 'cluster:read:policy-outcomes',
    READ_COMMAND_LOG: 'cluster:read:command-log',
    OPS_LOCK_CLUSTER: 'cluster:ops:lock',
    OPS_UNLOCK_CLUSTER: 'cluster:ops:unlock',
    OPS_DECLARE_INCIDENT: 'cluster:ops:incident-declare',
    OPS_RESOLVE_INCIDENT: 'cluster:ops:incident-resolve',
    OPS_PROPOSE_CONSENSUS: 'cluster:ops:consensus-propose',
    OPS_ADD_CLIENT_URLS: 'cluster:ops:client-urls-add',
    COMMAND_PREFIX: 'cluster:command',
    KEYVAULT_READ_STATUS: 'keyvault:read:status',
    KEYVAULT_ROTATE_KEK: 'keyvault:ops:rotate-kek',
    KEYVAULT_ROTATE_DEK: 'keyvault:ops:rotate-dek',
    KEYVAULT_WIPE: 'keyvault:ops:wipe-encrypted',
    MAILING_READ_JOBS: 'mailing:read:jobs',
    MAILING_READ_QUEUE: 'mailing:read:queue',
    MAILING_SUBMIT: 'mailing:ops:submit',
    MAILING_CANCEL: 'mailing:ops:cancel',
    NOTIFICATIONS_READ: 'notifications:read',
    READ_AUDIT: 'audit:read',
    MANAGE_ADMINS: 'governance:admins',
    MANAGE_POLICIES: 'governance:policies',
    MANAGE_GROUPS: 'governance:groups'
};

describe('AdminActions — vocabulary contract', () => {
    test('every action name is pinned', () => {
        for (const [key, value] of Object.entries(EXPECTED)) {
            assert.equal(AdminActions[key], value, `${key} changed value — every stored policy naming it is now dead`);
        }
    });

    test('no action was added or removed without updating this contract', () => {
        assert.deepEqual(Object.keys(AdminActions).sort(), Object.keys(EXPECTED).sort());
    });

    test('the vocabulary is frozen against mutation at runtime', () => {
        assert.equal(Object.isFrozen(AdminActions), true);
    });

    test('action names are unique — no two keys collide on one string', () => {
        const values = Object.values(AdminActions);
        assert.equal(new Set(values).size, values.length);
    });

    test('every name is lowercase and colon-segmented with no empty segments', () => {
        for (const value of Object.values(AdminActions)) {
            assert.equal(value, value.toLowerCase(), `${value} must be lowercase`);
            assert.ok(!value.includes(' '), `${value} must not contain spaces`);
            for (const segment of value.split(':')) {
                assert.ok(segment.length > 0, `${value} has an empty segment`);
            }
        }
    });

    test('CLUSTER_RESOURCE is the default resource name', () => {
        assert.equal(CLUSTER_RESOURCE, 'cluster');
    });
});

describe('AdminActions — derived names', () => {
    test('commandAction builds under the command prefix', () => {
        assert.equal(commandAction('server:lock'), 'cluster:command:server:lock');
        assert.equal(commandAction('node:ping'), 'cluster:command:node:ping');
        assert.equal(commandAction('ets:clear-lockdown'), 'cluster:command:ets:clear-lockdown');
    });

    test('nodeResource namespaces a worker id', () => {
        assert.equal(nodeResource('WKR-1'), 'node:WKR-1');
        assert.equal(nodeResource('WKR_prod7'), 'node:WKR_prod7');
    });
});

describe('AdminActions — the vocabulary works with the matcher it is written for', () => {
    test('cluster:read:* covers every read action and nothing else', () => {
        const reads = Object.entries(AdminActions).filter(([key]) => key.startsWith('READ_') && key !== 'READ_AUDIT');

        for (const [key, action] of reads) {
            assert.equal(matchesPattern('cluster:read:*', action), true, `${key} should match cluster:read:*`);
        }

        // audit:read is deliberately outside the cluster namespace, so a
        // cluster-read grant must not confer audit access.
        assert.equal(matchesPattern('cluster:read:*', AdminActions.READ_AUDIT), false);
    });

    test('cluster:ops:* covers every ops action but no read or command action', () => {
        for (const [key, action] of Object.entries(AdminActions)) {
            const expected = key.startsWith('OPS_');
            assert.equal(matchesPattern('cluster:ops:*', action), expected, `${key} mismatched against cluster:ops:*`);
        }
    });

    test('keyvault:* is its own namespace, separate from cluster and governance', () => {
        // Field-encryption capabilities are graded from "read the status" to
        // "destroy every user's enrollment". Keeping them out of cluster:* means
        // a broad cluster grant cannot silently confer the destructive one.
        for (const [key, action] of Object.entries(AdminActions)) {
            assert.equal(matchesPattern('keyvault:*', action), key.startsWith('KEYVAULT_'), `${key} mismatched against keyvault:*`);
        }

        assert.equal(matchesPattern('cluster:*', AdminActions.KEYVAULT_WIPE), false);
        assert.equal(matchesPattern('governance:*', AdminActions.KEYVAULT_WIPE), false);
    });

    test('mailing:* is its own namespace — a cluster grant never confers sending rights', () => {
        // Submitting a blast sends mail from the organisation's own domain to an
        // arbitrary list. That is closer to a publishing right than an
        // operational one, so a broad cluster:* grant must not imply it.
        for (const [key, action] of Object.entries(AdminActions)) {
            assert.equal(matchesPattern('mailing:*', action), key.startsWith('MAILING_'), `${key} mismatched against mailing:*`);
        }

        assert.equal(matchesPattern('cluster:*', AdminActions.MAILING_SUBMIT), false);
        assert.equal(matchesPattern('governance:*', AdminActions.MAILING_SUBMIT), false);
        assert.equal(matchesPattern('keyvault:*', AdminActions.MAILING_SUBMIT), false);
    });

    test('a mailing read grant does not confer submitting or cancelling', () => {
        const grant = 'mailing:read:*';

        assert.equal(matchesPattern(grant, AdminActions.MAILING_READ_JOBS), true);
        assert.equal(matchesPattern(grant, AdminActions.MAILING_READ_QUEUE), true);
        assert.equal(matchesPattern(grant, AdminActions.MAILING_SUBMIT), false);
        assert.equal(matchesPattern(grant, AdminActions.MAILING_CANCEL), false);
    });

    test('a key-vault read grant does not confer rotation or the wipe', () => {
        const grant = 'keyvault:read:*';

        assert.equal(matchesPattern(grant, AdminActions.KEYVAULT_READ_STATUS), true);
        assert.equal(matchesPattern(grant, AdminActions.KEYVAULT_ROTATE_KEK), false);
        assert.equal(matchesPattern(grant, AdminActions.KEYVAULT_ROTATE_DEK), false);
        assert.equal(matchesPattern(grant, AdminActions.KEYVAULT_WIPE), false);
    });

    test('cluster:command:* covers built command actions but not the bare prefix', () => {
        assert.equal(matchesPattern('cluster:command:*', commandAction('server:lock')), true);
        assert.equal(matchesPattern('cluster:command:*', commandAction('node:ping')), true);
        // The prefix alone is not an executable action.
        assert.equal(matchesPattern('cluster:command:*', AdminActions.COMMAND_PREFIX), false);
    });

    test('a single node command can be granted without granting its siblings', () => {
        const grant = commandAction('node:ping');

        assert.equal(matchesPattern(grant, commandAction('node:ping')), true);
        assert.equal(matchesPattern(grant, commandAction('ets:clear-lockdown')), false);
        assert.equal(matchesPattern(grant, commandAction('server:lock')), false);
    });

    test('governance:* does not overlap the cluster or audit namespaces', () => {
        for (const [key, action] of Object.entries(AdminActions)) {
            const expected = key.startsWith('MANAGE_');
            assert.equal(matchesPattern('governance:*', action), expected, `${key} mismatched against governance:*`);
        }
    });

    test('a lone * matches every action in the vocabulary', () => {
        for (const action of Object.values(AdminActions)) {
            assert.equal(matchesPattern('*', action), true);
        }
    });
});
