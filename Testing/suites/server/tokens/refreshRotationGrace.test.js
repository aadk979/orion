/**
 * Regression cover for refresh-rotation reuse detection.
 *
 * Reuse detection treated ANY replay of a retired refresh token as theft and
 * revoked the entire session family. Two entirely benign situations produce an
 * identical signal — a client retrying a rotation whose response it never
 * received, and two in-flight requests racing the same rotation — so a dropped
 * response cost the user every session they had, plus a fabricated reuse
 * incident in the audit trail.
 *
 * The grace window separates them by age. These tests pin the boundary: inside
 * it, a benign retry; outside it, still theft.
 */
import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { ROTATION_GRACE_SECONDS, isWithinRotationGrace } from '../../../../Packages/server/Orion-core/lib/Utils/Core/TokenManagement/RefreshTokens.js';

const secondsAgo = seconds => new Date(Date.now() - seconds * 1000);

describe('refresh rotation — grace window boundary', () => {
    test('a rotation that just happened is inside the window', () => {
        assert.equal(isWithinRotationGrace(new Date()), true);
        assert.equal(isWithinRotationGrace(secondsAgo(1)), true);
    });

    test('a rotation just inside the window is benign', () => {
        assert.equal(isWithinRotationGrace(secondsAgo(ROTATION_GRACE_SECONDS - 1)), true);
    });

    test('a rotation past the window is treated as reuse', () => {
        assert.equal(isWithinRotationGrace(secondsAgo(ROTATION_GRACE_SECONDS + 1)), false);
        assert.equal(isWithinRotationGrace(secondsAgo(3600)), false);
    });

    test('the window is short enough to be a retry window, not a replay window', () => {
        assert.ok(ROTATION_GRACE_SECONDS > 0);
        assert.ok(ROTATION_GRACE_SECONDS <= 60, 'a wide window would hand an attacker a usable replay period');
    });

    test('a missing or unparseable timestamp fails CLOSED, i.e. as reuse', () => {
        // A consumed row predating the consumed_at column, or a corrupt value,
        // must not be read as "recently rotated, let it through".
        assert.equal(isWithinRotationGrace(null), false);
        assert.equal(isWithinRotationGrace(undefined), false);
        assert.equal(isWithinRotationGrace(''), false);
        assert.equal(isWithinRotationGrace('not-a-date'), false);
    });

    test('an ISO string from the driver is accepted as well as a Date', () => {
        assert.equal(isWithinRotationGrace(new Date().toISOString()), true);
        assert.equal(isWithinRotationGrace(secondsAgo(3600).toISOString()), false);
    });
});
