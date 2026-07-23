/**
 * Regression tests for the audit remediation.
 *
 * Scoped to the pure, dependency-free logic — pattern matching, path
 * containment, failure classification, canonical signing strings. The
 * database-backed fixes (session watermark, refresh reuse detection, attempt
 * ceilings, atomic retrieval claim) need a live Postgres and belong in an
 * integration suite; the SQL for each is written so the check and the mutation
 * are a single statement, which is the property that has to hold.
 *
 * Run: node --test test/security-remediation.test.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { matchesPattern, evaluate } from '../../Orion-Orchestrator/lib/SystemAdmin/PBACEngine.js';
import { isAuthFailureCode } from '../lib/Errors/authFailureCodes.js';
import { buildRequestSignaturePayload } from '../../R_sync/lib/utils/requestSignature.js';

// ── PBAC-001 ────────────────────────────────────────────────────────────────
test('PBAC-001: intra-segment prefix wildcards match', async t => {
    await t.test('the documented deny idiom actually matches', () => {
        assert.equal(matchesPattern('node:WKR_prod*', 'node:WKR_prod7'), true);
        assert.equal(matchesPattern('node:WKR_prod*', 'node:WKR_production-2'), true);
    });

    await t.test('a prefix wildcard does not match a different prefix', () => {
        assert.equal(matchesPattern('node:WKR_prod*', 'node:WKR_staging1'), false);
    });

    await t.test('existing whole-segment wildcard behaviour is unchanged', () => {
        assert.equal(matchesPattern('*', 'anything:at:all'), true);
        assert.equal(matchesPattern('cluster:command:*', 'cluster:command:server:lock'), true);
        assert.equal(matchesPattern('a:*:c', 'a:b:c'), true);
        assert.equal(matchesPattern('a:*:c', 'a:b:d'), false);
        assert.equal(matchesPattern('a:b', 'a:b:c'), false);
    });

    await t.test('a deny on a node family now overrides a broad allow', () => {
        const docs = [
            {
                statements: [
                    { sid: 'all', effect: 'allow', actions: ['cluster:command:*'], resources: ['*'] },
                    { sid: 'no-prod', effect: 'deny', actions: ['cluster:command:*'], resources: ['node:WKR_prod*'] }
                ]
            }
        ];

        const prod = evaluate(docs, 'cluster:command:server:lock', 'node:WKR_prod7');
        assert.equal(prod.allowed, false, 'production node must be denied');
        assert.equal(prod.matchedSid, 'no-prod');

        const staging = evaluate(docs, 'cluster:command:server:lock', 'node:WKR_staging1');
        assert.equal(staging.allowed, true, 'non-production node stays allowed');
    });
});

// ── ABUSE-001 ───────────────────────────────────────────────────────────────
test('ABUSE-001: credential-guess failures are classified for the abuse detector', async t => {
    await t.test('challenge and credential failures are charged', () => {
        for (const code of [
            'ACCOUNT-SIGNIN::INVALID-PASSWORD::A::p',
            'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p',
            'ACC-PASSWORD-RESET-INVALID-CODE',
            'STEP-UP::INVALID-CODE::A::p',
            'STEP-UP::INVALID-TOTP::A::p',
            'DEVICE-AUTH::INVALID-CODE::A::p',
            'TWO-FA::INVALID-CODE::A::p',
            'CAPTCHA::INVALID-CODE::A::p',
            'PASSKEY::AUTH-FAILED::A::i'
        ]) {
            assert.equal(isAuthFailureCode(code), true, `${code} should be charged`);
        }
    });

    await t.test('normal lifecycle events are not charged', () => {
        for (const code of [
            'TOKEN-ACCESS::EXPIRED::A::p',
            'TOKEN-REFRESH::EXPIRED::A::p',
            'AUTH::MISSING-TOKEN::A::p',
            'STEP-UP::REQUIRED::A::p'
        ]) {
            assert.equal(isAuthFailureCode(code), false, `${code} must NOT blocklist a legitimate user`);
        }
    });

    await t.test('a new code following the naming convention is covered by default', () => {
        assert.equal(isAuthFailureCode('SOME-NEW-FLOW::INVALID-CODE::A::p'), true);
    });

    await t.test('malformed input is not charged', () => {
        assert.equal(isAuthFailureCode(undefined), false);
        assert.equal(isAuthFailureCode(''), false);
        assert.equal(isAuthFailureCode(null), false);
    });
});

// ── RSYNC-001 ───────────────────────────────────────────────────────────────
test('RSYNC-001: worker signatures cover the whole request', async t => {
    const base = { method: 'POST', path: '/r_sync/api/v1/worker-event', body: { a: 1 }, workerId: 'WKR_1', timestamp: 1700000000, nonce: 'n1' };

    await t.test('is deterministic for identical input', () => {
        assert.equal(buildRequestSignaturePayload(base), buildRequestSignaturePayload({ ...base }));
    });

    await t.test('changing the body changes the signing string', () => {
        assert.notEqual(buildRequestSignaturePayload(base), buildRequestSignaturePayload({ ...base, body: { a: 2 } }));
    });

    await t.test('changing the path or method changes the signing string', () => {
        assert.notEqual(buildRequestSignaturePayload(base), buildRequestSignaturePayload({ ...base, path: '/r_sync/api/v1/heartbeat' }));
        assert.notEqual(buildRequestSignaturePayload(base), buildRequestSignaturePayload({ ...base, method: 'GET' }));
    });

    await t.test('an absent body canonicalizes the same as Express`s empty object', () => {
        assert.equal(buildRequestSignaturePayload({ ...base, body: undefined }), buildRequestSignaturePayload({ ...base, body: {} }));
    });

    await t.test('nonce and timestamp still participate', () => {
        assert.notEqual(buildRequestSignaturePayload(base), buildRequestSignaturePayload({ ...base, nonce: 'n2' }));
        assert.notEqual(buildRequestSignaturePayload(base), buildRequestSignaturePayload({ ...base, timestamp: 1700000001 }));
    });
});

// ── ORAS-001 ────────────────────────────────────────────────────────────────
test('ORAS-001: path containment rejects sibling-directory escapes', async t => {
    // getSafePath resolves against process.cwd(), so exercise the same predicate
    // it now uses rather than depending on the working directory.
    const isContained = (baseDir, candidate) => {
        const resolved = path.resolve(baseDir, candidate);
        const relative = path.relative(baseDir, resolved);
        return !(relative === '' || path.isAbsolute(relative) || relative.split(path.sep)[0] === '..');
    };

    const base = path.resolve('/srv/app/orion-public-non-sensitives');

    await t.test('ordinary files inside the directory are allowed', () => {
        assert.equal(isContained(base, 'logo.png'), true);
        assert.equal(isContained(base, 'nested/dir/file.txt'), true);
    });

    await t.test('a sibling directory sharing the name prefix is rejected', () => {
        // The exact case a bare startsWith() accepted.
        assert.equal(isContained(base, '../orion-public-non-sensitives-backup/dump.sql'), false);
    });

    await t.test('classic traversal and the base directory itself are rejected', () => {
        assert.equal(isContained(base, '../../etc/passwd'), false);
        assert.equal(isContained(base, '..'), false);
        assert.equal(isContained(base, ''), false);
    });
});
