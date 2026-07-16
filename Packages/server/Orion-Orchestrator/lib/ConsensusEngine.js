/**
 * ConsensusEngine — quorum decisions backed by the fleet's own view.
 *
 * The orchestrator's registry is ONE observer's picture of the cluster; before
 * acting on (or declaring) a cluster-wide condition, the engine asks every
 * reachable node to evaluate the condition against its LOCAL state
 * (consensus:vote command) and tallies the ballots against a quorum.
 *
 * Semantics:
 *   - `accepted`  — at least `quorumRatio` of ELIGIBLE voters voted true.
 *   - `decided`   — enough ballots came back to make the tally meaningful:
 *                   at least `minVoters` responded AND at least `quorumRatio`
 *                   of eligible voters responded. An undecided proposal must be
 *                   treated as "unknown", never as "no".
 *   - Unreachable / timed-out nodes are counted as non-participants, not as
 *     "false" votes — a partitioned fleet yields `decided: false` rather than
 *     a fake rejection.
 *
 * A proposal history ring is kept for observability.
 */

import { ClusterCommands, buildVote } from './protocol.js';

const HISTORY_LIMIT = 50;

const defaultOptions = Object.freeze({
    /** Fraction of ELIGIBLE voters that must vote true for acceptance */
    quorumRatio: 0.5,
    /** Minimum ballots required for the proposal to be decidable at all */
    minVoters: 1,
    /** Per-node vote timeout */
    timeoutMs: 8_000
});

class ConsensusEngine {

    /**
     * @param {(workerId, action, args, timeoutMs) => Promise} commandFn - orchestrator command executor
     * @param {() => Promise<Array<{id: string}>>} eligibleVotersFn - returns ACTIVE transport workers
     */
    constructor(commandFn, eligibleVotersFn) {
        this._commandFn = commandFn;
        this._eligibleVotersFn = eligibleVotersFn;
        this._history = [];
    }

    /**
     * Runs a vote across the fleet.
     *
     * @param {string} topic - a ConsensusTopics value (validated node-side)
     * @param {Object} [params] - topic parameters forwarded to every node
     * @param {Object} [options] - { quorumRatio, minVoters, timeoutMs }
     * @returns {Promise<{topic, decided, accepted, eligible, responded, yes, no, ratio, votes}>}
     */
    async propose(topic, params = {}, options = {}) {
        const opts = { ...defaultOptions, ...options };
        const voters = await this._eligibleVotersFn();

        const ballots = await Promise.allSettled(
            voters.map(v => this._commandFn(v.id, ClusterCommands.CONSENSUS_VOTE, { topic, params }, opts.timeoutMs))
        );

        const votes = ballots.map((b, i) => {
            const workerId = voters[i].id;
            if (b.status === 'fulfilled' && b.value?.ok === true) {
                return { workerId, responded: true, vote: b.value.result?.vote === true, details: b.value.result?.details || {} };
            }
            const reason = b.status === 'rejected'
                ? (b.reason?.message || 'vote failed')
                : (b.value?.error?.message || 'node rejected the vote');
            return { workerId, responded: false, vote: null, error: reason };
        });

        const eligible = voters.length;
        const responded = votes.filter(v => v.responded).length;
        const yes = votes.filter(v => v.vote === true).length;
        const no = votes.filter(v => v.vote === false).length;

        // Decidability: quorum of the fleet must have actually answered.
        const decided = eligible > 0 &&
            responded >= opts.minVoters &&
            responded / eligible >= opts.quorumRatio;

        // Acceptance is measured against ELIGIBLE voters, so silent nodes make
        // acceptance harder, never easier.
        const ratio = eligible > 0 ? yes / eligible : 0;
        const accepted = decided && ratio >= opts.quorumRatio;

        const outcome = {
            topic,
            params,
            decided,
            accepted,
            eligible,
            responded,
            yes,
            no,
            ratio: Number(ratio.toFixed(4)),
            quorumRatio: opts.quorumRatio,
            votes,
            proposedAt: Math.floor(Date.now() / 1000)
        };

        this._history.push(outcome);
        if (this._history.length > HISTORY_LIMIT) {
            this._history.splice(0, this._history.length - HISTORY_LIMIT);
        }

        return outcome;
    }

    getHistory(limit = 10) {
        return this._history.slice(-limit);
    }
}

export { ConsensusEngine, HISTORY_LIMIT as CONSENSUS_HISTORY_LIMIT };

// Re-exported for convenience in tests / integrators building fake ballots
export { buildVote };
