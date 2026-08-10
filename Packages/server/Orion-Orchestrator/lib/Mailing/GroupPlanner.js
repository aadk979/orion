/**
 * GroupPlanner — how a mailing job is cut into groups.
 *
 * Pure arithmetic, no I/O, so the one decision that shapes every blast is
 * testable in isolation.
 *
 * Two forces set the group size:
 *
 *   1. Spread the work across the fleet — ideally every live node gets an equal
 *      share, so the size that would achieve that is ceil(total / liveNodes).
 *   2. Keep any single hand-off small — a group is the unit of work a node
 *      claims, sends, and reports on, so an oversized group means a long silent
 *      stretch and a lot of re-work if that node dies mid-way. `maxPerGroup`
 *      caps it.
 *
 * The size is the smaller of the two, and then EVERY recipient is chunked at
 * that size — including the overflow. That is what produces more groups than
 * nodes when the cap binds:
 *
 *   100 recipients, 5 live nodes, maxPerGroup 15
 *     → ideal share      = ceil(100 / 5)  = 20
 *     → capped at        = min(20, 15)    = 15
 *     → groups           = ceil(100 / 15) = 7  → 15×6 + 10
 *
 * The first round hands one group to each of the 5 nodes (75 mails); groups 6
 * and 7 wait, and go to whichever nodes report back first. The fleet stays busy
 * without any node ever holding more than one group at a time.
 *
 * Group numbers are 1-based and assigned in row order, so a sheet sorted by
 * priority mails its most important recipients in the earliest groups.
 */

const DEFAULT_MAX_PER_GROUP = 300;

/**
 * @param {number} totalRecipients
 * @param {number} liveNodeCount   nodes available at planning time
 * @param {number} maxPerGroup     hard ceiling on one group's size
 * @returns {{ groupSize: number, groupCount: number, totalRecipients: number,
 *             liveNodeCount: number, maxPerGroup: number, idealShare: number,
 *             capBound: boolean, groupSizes: number[] }}
 */
const planGroups = (totalRecipients, liveNodeCount, maxPerGroup = DEFAULT_MAX_PER_GROUP) => {
    const total = Math.max(0, Math.floor(Number(totalRecipients) || 0));
    const nodes = Math.max(0, Math.floor(Number(liveNodeCount) || 0));
    const cap = Math.max(1, Math.floor(Number(maxPerGroup) || DEFAULT_MAX_PER_GROUP));

    if (total === 0) {
        return { groupSize: 0, groupCount: 0, totalRecipients: 0, liveNodeCount: nodes, maxPerGroup: cap, idealShare: 0, capBound: false, groupSizes: [] };
    }
    if (nodes === 0) {
        throw new Error('Cannot plan a mailing job with no live nodes');
    }

    const idealShare = Math.ceil(total / nodes);
    const groupSize = Math.max(1, Math.min(idealShare, cap));
    const groupCount = Math.ceil(total / groupSize);

    // The last group holds the remainder; every other group is exactly groupSize.
    const groupSizes = Array.from({ length: groupCount }, (_, i) => (i === groupCount - 1 ? total - groupSize * (groupCount - 1) : groupSize));

    return {
        groupSize,
        groupCount,
        totalRecipients: total,
        liveNodeCount: nodes,
        maxPerGroup: cap,
        idealShare,
        // True when the per-group ceiling — not the node count — decided the
        // size, i.e. there will be more groups than nodes and a second round.
        capBound: idealShare > cap,
        groupSizes
    };
};

/**
 * The group number for a 0-based row index under a given plan. Rows keep their
 * sheet order, so `assignGroup(0..n)` walks 1,1,…,2,2,…
 */
const assignGroup = (rowIndex, groupSize) => {
    if (!Number.isInteger(rowIndex) || rowIndex < 0) throw new Error('assignGroup: rowIndex must be a non-negative integer');
    if (!Number.isInteger(groupSize) || groupSize < 1) throw new Error('assignGroup: groupSize must be a positive integer');
    return Math.floor(rowIndex / groupSize) + 1;
};

export { planGroups, assignGroup, DEFAULT_MAX_PER_GROUP };
