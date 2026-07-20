import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluate, matchesPattern, validatePolicyDocument } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/PBACEngine.js';

const doc = statements => ({ version: 1, statements });

describe('PBACEngine — pattern matching', () => {
    test('exact match', () => {
        assert.equal(matchesPattern('cluster:read:status', 'cluster:read:status'), true);
        assert.equal(matchesPattern('cluster:read:status', 'cluster:read:nodes'), false);
    });

    test('lone * matches anything', () => {
        assert.equal(matchesPattern('*', 'cluster:ops:lock'), true);
        assert.equal(matchesPattern('*', 'node:WKR-1'), true);
    });

    test('trailing * swallows the multi-segment remainder', () => {
        assert.equal(matchesPattern('cluster:command:*', 'cluster:command:server:lock'), true);
        assert.equal(matchesPattern('cluster:command:*', 'cluster:command:ets:clear-lockdown'), true);
        // but requires at least one remaining segment
        assert.equal(matchesPattern('cluster:command:*', 'cluster:command'), false);
    });

    test('mid-pattern * matches exactly one segment', () => {
        assert.equal(matchesPattern('cluster:*:status', 'cluster:read:status'), true);
        assert.equal(matchesPattern('cluster:*:status', 'cluster:read:deep:status'), false);
    });

    test('segment counts must line up without a trailing wildcard', () => {
        assert.equal(matchesPattern('cluster:read', 'cluster:read:status'), false);
        assert.equal(matchesPattern('cluster:read:status', 'cluster:read'), false);
    });

    test('never matches empty or non-string input', () => {
        assert.equal(matchesPattern('', 'x'), false);
        assert.equal(matchesPattern('x', ''), false);
        assert.equal(matchesPattern(undefined, 'x'), false);
    });
});

describe('PBACEngine — evaluation semantics', () => {
    const readOnly = doc([{ sid: 'ro', effect: 'allow', actions: ['cluster:read:*', 'audit:read'], resources: ['*'] }]);

    test('default deny: nothing allowed without a matching statement', () => {
        const verdict = evaluate([readOnly], 'cluster:ops:lock', 'cluster');
        assert.equal(verdict.allowed, false);
        assert.equal(verdict.reason, 'default-deny');
    });

    test('allow statements grant exactly what they name', () => {
        assert.equal(evaluate([readOnly], 'cluster:read:status', 'cluster').allowed, true);
        assert.equal(evaluate([readOnly], 'audit:read', 'audit').allowed, true);
        assert.equal(evaluate([readOnly], 'cluster:command:node:ping', 'node:W1').allowed, false);
    });

    test('deny overrides allow regardless of statement or document order', () => {
        const allowAll = doc([{ effect: 'allow', actions: ['*'], resources: ['*'] }]);
        const denyLock = doc([{ sid: 'no-lock', effect: 'deny', actions: ['cluster:ops:lock'], resources: ['*'] }]);

        for (const documents of [
            [allowAll, denyLock],
            [denyLock, allowAll]
        ]) {
            const verdict = evaluate(documents, 'cluster:ops:lock', 'cluster');
            assert.equal(verdict.allowed, false);
            assert.equal(verdict.reason, 'explicit-deny');
            assert.equal(verdict.matchedSid, 'no-lock');
        }
    });

    test('resources scope the statement — a node-scoped deny leaves other nodes allowed', () => {
        const documents = [
            doc([
                { effect: 'allow', actions: ['cluster:command:*'], resources: ['*'] },
                { sid: 'protect-prod', effect: 'deny', actions: ['cluster:command:*'], resources: ['node:PROD-1'] }
            ])
        ];

        assert.equal(evaluate(documents, 'cluster:command:server:lock', 'node:STAGE-1').allowed, true);
        assert.equal(evaluate(documents, 'cluster:command:server:lock', 'node:PROD-1').allowed, false);
    });

    test('empty/malformed document sets deny by default', () => {
        assert.equal(evaluate([], 'cluster:read:status', 'cluster').allowed, false);
        assert.equal(evaluate([{}, null, { statements: 'nope' }], 'cluster:read:status', 'cluster').allowed, false);
        assert.equal(evaluate([doc([{ effect: 'bogus', actions: ['*'], resources: ['*'] }])], 'x', 'y').allowed, false);
    });
});

describe('PBACEngine — document validation', () => {
    test('accepts a well-formed document', () => {
        const { valid, errors } = validatePolicyDocument(
            doc([
                { sid: 'a', effect: 'allow', actions: ['cluster:read:*'], resources: ['*'] },
                { effect: 'deny', actions: ['cluster:ops:lock'], resources: ['cluster'] }
            ])
        );
        assert.equal(valid, true);
        assert.deepEqual(errors, []);
    });

    test('rejects wrong version, empty statements, bad effects, and empty action/resource lists', () => {
        assert.equal(validatePolicyDocument(null).valid, false);
        assert.equal(validatePolicyDocument({ version: 2, statements: [{}] }).valid, false);
        assert.equal(validatePolicyDocument(doc([])).valid, false);
        assert.equal(validatePolicyDocument(doc([{ effect: 'permit', actions: ['*'], resources: ['*'] }])).valid, false);
        assert.equal(validatePolicyDocument(doc([{ effect: 'allow', actions: [], resources: ['*'] }])).valid, false);
        assert.equal(validatePolicyDocument(doc([{ effect: 'allow', actions: ['*'], resources: [''] }])).valid, false);
    });
});
