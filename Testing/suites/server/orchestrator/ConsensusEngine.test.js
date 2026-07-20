import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { ConsensusEngine } from '../../../../Packages/server/Orion-Orchestrator/lib/ConsensusEngine.js';

// Builds an engine over a fixed fleet. `behaviors` maps workerId → true/false
// (ballot), 'reject' (node refuses), or 'timeout' (transport failure).
const makeEngine = behaviors => {
    const voters = Object.keys(behaviors).map(id => ({ id }));
    const commandFn = async workerId => {
        const behavior = behaviors[workerId];
        if (behavior === 'timeout') throw new Error('timed out');
        if (behavior === 'reject') return { workerId, ok: false, error: { message: 'REMOTE_CONTROL_DISABLED' } };
        return { workerId, ok: true, result: { topic: 't', vote: behavior, details: {} } };
    };
    return new ConsensusEngine(commandFn, async () => voters);
};

describe('ConsensusEngine — acceptance', () => {
    test('unanimous yes is decided and accepted', async () => {
        const engine = makeEngine({ W1: true, W2: true, W3: true });
        const outcome = await engine.propose('node-healthy');
        assert.equal(outcome.decided, true);
        assert.equal(outcome.accepted, true);
        assert.equal(outcome.yes, 3);
        assert.equal(outcome.ratio, 1);
    });

    test('majority yes meets the default 0.5 quorum', async () => {
        const engine = makeEngine({ W1: true, W2: true, W3: false });
        const outcome = await engine.propose('node-healthy');
        assert.equal(outcome.accepted, true);
        assert.equal(outcome.yes, 2);
        assert.equal(outcome.no, 1);
    });

    test('minority yes is decided but rejected', async () => {
        const engine = makeEngine({ W1: true, W2: false, W3: false });
        const outcome = await engine.propose('node-healthy');
        assert.equal(outcome.decided, true);
        assert.equal(outcome.accepted, false);
    });

    test('custom quorumRatio is honored', async () => {
        const engine = makeEngine({ W1: true, W2: true, W3: false });
        const outcome = await engine.propose('node-healthy', {}, { quorumRatio: 0.75 });
        assert.equal(outcome.accepted, false); // 2/3 < 0.75
    });
});

describe('ConsensusEngine — partitions and failures', () => {
    test('silent nodes count against acceptance, never for it', async () => {
        // 2 yes of 4 eligible = 0.5 ratio → accepted at default quorum,
        // but if the two silent nodes had counted as yes it would mask reality.
        const engine = makeEngine({ W1: true, W2: true, W3: 'timeout', W4: 'timeout' });
        const outcome = await engine.propose('node-healthy');
        assert.equal(outcome.responded, 2);
        assert.equal(outcome.ratio, 0.5);
        assert.equal(outcome.decided, true); // 2/4 responded = exactly quorum of participants
        assert.equal(outcome.accepted, true);
    });

    test('a mostly-unreachable fleet yields UNDECIDED, not a fake rejection', async () => {
        const engine = makeEngine({ W1: true, W2: 'timeout', W3: 'timeout', W4: 'timeout' });
        const outcome = await engine.propose('node-healthy');
        assert.equal(outcome.decided, false);
        assert.equal(outcome.accepted, false);
        assert.equal(outcome.responded, 1);
    });

    test('nodes that reject the vote command are non-participants with an error recorded', async () => {
        const engine = makeEngine({ W1: true, W2: 'reject' });
        const outcome = await engine.propose('node-healthy');
        const rejected = outcome.votes.find(v => v.workerId === 'W2');
        assert.equal(rejected.responded, false);
        assert.match(rejected.error, /REMOTE_CONTROL_DISABLED/);
    });

    test('empty fleet is never decided', async () => {
        const engine = makeEngine({});
        const outcome = await engine.propose('node-healthy');
        assert.equal(outcome.decided, false);
        assert.equal(outcome.accepted, false);
        assert.equal(outcome.eligible, 0);
    });

    test('minVoters blocks decisions on too-thin participation', async () => {
        const engine = makeEngine({ W1: true, W2: 'timeout' });
        const outcome = await engine.propose('node-healthy', {}, { minVoters: 2 });
        assert.equal(outcome.decided, false);
    });
});

describe('ConsensusEngine — history', () => {
    test('proposals are recorded newest-last', async () => {
        const engine = makeEngine({ W1: true });
        await engine.propose('a');
        await engine.propose('b');
        const history = engine.getHistory();
        assert.deepEqual(
            history.map(h => h.topic),
            ['a', 'b']
        );
    });
});
