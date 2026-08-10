import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { planGroups, assignGroup, DEFAULT_MAX_PER_GROUP } from '../../../../Packages/server/Orion-Orchestrator/lib/Mailing/GroupPlanner.js';

/**
 * Grouping is the decision that shapes every blast: it fixes how the work
 * spreads across the fleet, how much is lost when one node dies, and how many
 * rounds the job takes. It is pure arithmetic precisely so it can be pinned
 * here rather than inferred from watching a live cluster.
 */

describe('planGroups — the specified behaviour', () => {
    test('100 recipients, 5 nodes, cap 15 → seven groups of 15/15/15/15/15/15/10', () => {
        const plan = planGroups(100, 5, 15);

        assert.equal(plan.groupSize, 15);
        assert.equal(plan.groupCount, 7);
        assert.deepEqual(plan.groupSizes, [15, 15, 15, 15, 15, 15, 10]);
        // Five nodes take one group each in the first round (75 mails); the
        // remaining two groups are the overflow that keeps the fleet cycling.
        assert.equal(plan.capBound, true);
        assert.equal(plan.idealShare, 20);
    });

    test('every recipient lands in exactly one group', () => {
        for (const [total, nodes, cap] of [
            [100, 5, 15],
            [1, 5, 15],
            [7, 3, 4],
            [10_000, 12, 15],
            [999, 7, 100]
        ]) {
            const plan = planGroups(total, nodes, cap);
            assert.equal(
                plan.groupSizes.reduce((a, b) => a + b, 0),
                total,
                `sizes for (${total}, ${nodes}, ${cap}) must sum to the total`
            );
            assert.equal(plan.groupSizes.length, plan.groupCount);
        }
    });

    test('no group ever exceeds the cap', () => {
        for (const [total, nodes, cap] of [
            [100, 5, 15],
            [1000, 2, 15],
            [37, 9, 4],
            [10_000, 1, 15]
        ]) {
            const plan = planGroups(total, nodes, cap);
            for (const size of plan.groupSizes) {
                assert.ok(size <= cap, `group of ${size} exceeds cap ${cap} for (${total}, ${nodes})`);
                assert.ok(size >= 1, 'a group is never empty');
            }
        }
    });
});

describe('planGroups — the cap versus the node count', () => {
    test('a generous cap lets the node count decide, giving one group per node', () => {
        const plan = planGroups(100, 5, 50);

        assert.equal(plan.groupSize, 20);
        assert.equal(plan.groupCount, 5, 'with no binding cap there is exactly one round');
        assert.equal(plan.capBound, false);
    });

    test('a tight cap decides instead, producing more groups than nodes', () => {
        const plan = planGroups(100, 5, 7);

        assert.equal(plan.groupSize, 7);
        assert.equal(plan.groupCount, 15);
        assert.equal(plan.capBound, true);
        assert.ok(plan.groupCount > plan.liveNodeCount, 'a bound cap must produce overflow rounds');
    });

    test('fewer recipients than nodes gives one recipient per group, never a zero-size group', () => {
        const plan = planGroups(3, 5, 15);

        assert.equal(plan.groupSize, 1);
        assert.equal(plan.groupCount, 3);
        assert.deepEqual(plan.groupSizes, [1, 1, 1]);
    });

    test('a single node takes the whole job in cap-sized rounds', () => {
        const plan = planGroups(100, 1, 15);

        assert.equal(plan.groupSize, 15);
        assert.equal(plan.groupCount, 7);
        assert.equal(plan.capBound, true);
    });

    test('an exact multiple leaves no short trailing group', () => {
        const plan = planGroups(75, 5, 15);

        assert.equal(plan.groupCount, 5);
        assert.deepEqual(plan.groupSizes, [15, 15, 15, 15, 15]);
    });
});

describe('planGroups — edges', () => {
    test('an empty sheet plans nothing rather than one empty group', () => {
        const plan = planGroups(0, 5, 15);

        assert.equal(plan.groupCount, 0);
        assert.equal(plan.groupSize, 0);
        assert.deepEqual(plan.groupSizes, []);
    });

    test('planning against zero nodes is refused, not silently divided by zero', () => {
        assert.throws(() => planGroups(100, 0, 15), /no live nodes/i);
    });

    test('a cap of zero or nonsense falls back rather than producing empty groups', () => {
        assert.equal(planGroups(100, 5, 0).maxPerGroup, DEFAULT_MAX_PER_GROUP);
        assert.equal(planGroups(100, 5, -3).maxPerGroup, 1);
    });

    test('fractional and string inputs are floored to whole recipients', () => {
        assert.equal(planGroups('100', '5', '15').groupCount, 7);
        assert.equal(planGroups(100.9, 5, 15).totalRecipients, 100);
    });
});

describe('assignGroup — row index to group number', () => {
    test('rows are numbered 1-based in sheet order', () => {
        assert.equal(assignGroup(0, 15), 1);
        assert.equal(assignGroup(14, 15), 1);
        assert.equal(assignGroup(15, 15), 2);
        assert.equal(assignGroup(99, 15), 7);
    });

    test('assignment agrees with the plan for every row', () => {
        const plan = planGroups(100, 5, 15);
        const counts = new Map();

        for (let i = 0; i < 100; i++) {
            const group = assignGroup(i, plan.groupSize);
            assert.ok(group >= 1 && group <= plan.groupCount, `row ${i} landed in group ${group}, outside 1..${plan.groupCount}`);
            counts.set(group, (counts.get(group) || 0) + 1);
        }

        for (let g = 1; g <= plan.groupCount; g++) {
            assert.equal(counts.get(g), plan.groupSizes[g - 1], `group ${g} size disagrees with the plan`);
        }
    });

    test('invalid arguments are refused rather than producing group NaN', () => {
        assert.throws(() => assignGroup(-1, 15), /non-negative/);
        assert.throws(() => assignGroup(0, 0), /positive integer/);
    });
});
