import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// The managers must be imported BEFORE GlobalAccessPoint: logger.js and
// GlobalAccessPoint.js are circular, and the cycle only resolves cleanly when
// logger's chain (loaded via the managers' index import) evaluates first.
import { TokenSecretsManager } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/TokenSecretsManager.js';
import { SignatureSecretsManager } from '../../../../Packages/server/Orion-core/lib/Utils/Systems/SignatureSecretsManager.js';
import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { silenceConsole } from '../../../helpers/mocks.js';

// clusterMode is a locked GAP key (single set per process) — managers read it
// at construction. Instance type is overridden per test where cluster
// behaviour is exercised.
globalAccessPoint.setValue('clusterMode', false);

const ES256 = { algorithm: 'ES256', size: 256, type: 'ECDSA' };

/** Builds an initialized manager with freshly generated signing pairs, skipping initialize() (no cron, no boot file IO). */
const makeManager = async (Ctor, domain, nPairs = 2) => {
    const manager = new Ctor(domain, 'ES256', nPairs);
    const keys = await Promise.all(
        Array(nPairs)
            .fill(ES256)
            .map(c => manager.tokenSecretsCrypto.generateECDSAKey(c))
    );
    manager.signingPairs.push(...keys);
    manager.initialized = true;
    return manager;
};

/** Capture-only Redis fake covering the two calls forceRotate makes. */
const makeRedisFake = (overrides = {}) => {
    const calls = { hashDelete: [], hashSet: [] };
    return {
        calls,
        hashDelete: async (key, fields) => {
            calls.hashDelete.push({ key, fields });
            return { error: false };
        },
        hashSet: async (key, fields, ttl) => {
            calls.hashSet.push({ key, fields, ttl });
            return { error: false };
        },
        ...overrides
    };
};

// Both managers implement the identical force-rotation contract — run the
// whole suite against each.
for (const [name, Ctor] of [
    ['TokenSecretsManager', TokenSecretsManager],
    ['SignatureSecretsManager', SignatureSecretsManager]
]) {
    describe(`${name} — forceRotate`, () => {
        test('kid mode revokes a signing pair, replaces it 1:1, and wipes its material', async () => {
            const manager = await makeManager(Ctor, 'access');
            const victim = manager.signingPairs[0];
            const survivor = manager.signingPairs[1];

            const summary = await silenceConsole(() => manager.forceRotate({ kids: [victim.keyPairId] }));

            assert.deepEqual(summary.revokedSigning, [victim.keyPairId]);
            assert.deepEqual(summary.revokedVerification, []);
            assert.deepEqual(summary.unknown, []);
            assert.equal(summary.generated.length, 1);
            assert.equal(summary.mode, 'kids');

            // Pool size preserved; the revoked kid is gone, the survivor kept
            assert.equal(manager.signingPairs.length, 2);
            assert.ok(!manager.signingPairs.some(k => k.keyPairId === victim.keyPairId));
            assert.ok(manager.signingPairs.some(k => k.keyPairId === survivor.keyPairId));

            // Revoked pairs are decommissioned — NOT demoted to verification
            assert.ok(!manager.verificationPairs.some(k => k.keyPairId === victim.keyPairId));

            // Private material scrubbed from the discarded object
            assert.equal(victim._nodePrivateKey, undefined);
            assert.equal(victim._cryptoKey, undefined);
            assert.equal(victim.keys.private, undefined);
        });

        test('kid mode drops a verification kid without regenerating anything', async () => {
            const manager = await makeManager(Ctor, 'access');
            const foreign = await manager.tokenSecretsCrypto.generateECDSAKey(ES256);
            manager.verificationPairs.push(foreign);

            const summary = await silenceConsole(() => manager.forceRotate({ kids: [foreign.keyPairId] }));

            assert.deepEqual(summary.revokedVerification, [foreign.keyPairId]);
            assert.deepEqual(summary.revokedSigning, []);
            assert.deepEqual(summary.generated, []);
            assert.equal(manager.verificationPairs.length, 0);
            assert.equal(manager.signingPairs.length, 2);
        });

        test('kids in neither pool are reported as unknown', async () => {
            const manager = await makeManager(Ctor, 'access');
            const summary = await silenceConsole(() => manager.forceRotate({ kids: ['ghost-kid'] }));
            assert.deepEqual(summary.unknown, ['ghost-kid']);
            assert.deepEqual(summary.generated, []);
            assert.equal(manager.signingPairs.length, 2);
        });

        test('full mode decommissions the entire signing pool and regenerates nPairs', async () => {
            const manager = await makeManager(Ctor, 'access');
            const oldKids = manager.signingPairs.map(k => k.keyPairId);
            const oldPairs = [...manager.signingPairs];

            const summary = await silenceConsole(() => manager.forceRotate({ full: true }));

            assert.equal(summary.mode, 'full');
            assert.deepEqual(summary.revokedSigning.sort(), [...oldKids].sort());
            assert.equal(summary.generated.length, 2);
            assert.equal(manager.signingPairs.length, 2);
            assert.ok(manager.signingPairs.every(k => !oldKids.includes(k.keyPairId)));
            // Decommissioned immediately — no demotion to verification
            assert.ok(oldKids.every(kid => !manager.verificationPairs.some(k => k.keyPairId === kid)));
            assert.ok(oldPairs.every(pair => pair._nodePrivateKey === undefined));
        });

        test('rejects calls without a mode and before initialization', async () => {
            const manager = await makeManager(Ctor, 'access');
            await assert.rejects(manager.forceRotate(), /requires \{ kids/);
            await assert.rejects(manager.forceRotate({ kids: [] }), /requires \{ kids/);

            manager.initialized = false;
            await assert.rejects(manager.forceRotate({ full: true }), /not initialized/);
        });

        test('cluster mode deletes every targeted kid from Redis and publishes only the replacements', async () => {
            const manager = await makeManager(Ctor, 'access');
            manager.instanceType = 'CLUSTER';
            const redis = makeRedisFake();
            globalAccessPoint.setValue('redisInstance', redis);

            const victim = manager.signingPairs[0];
            const summary = await silenceConsole(() => manager.forceRotate({ kids: [victim.keyPairId, 'ghost-kid'] }));

            // HDEL covers ALL targeted kids — including ones this node never held
            assert.equal(redis.calls.hashDelete.length, 1);
            assert.deepEqual([...redis.calls.hashDelete[0].fields].sort(), [victim.keyPairId, 'ghost-kid'].sort());

            // Publish carries only the fresh replacement, stripped of private material
            assert.equal(redis.calls.hashSet.length, 1);
            const published = Object.values(redis.calls.hashSet[0].fields);
            assert.deepEqual(
                published.map(k => k.keyPairId),
                summary.generated
            );
            for (const key of published) {
                assert.equal(key.keys.private, undefined);
                assert.equal(key._nodePrivateKey, undefined);
            }
        });

        test('a Redis failure reverts the pools and surfaces as a thrown error', async () => {
            const manager = await makeManager(Ctor, 'access');
            manager.instanceType = 'CLUSTER';
            globalAccessPoint.setValue(
                'redisInstance',
                makeRedisFake({
                    hashDelete: async () => {
                        throw new Error('redis unreachable');
                    }
                })
            );

            const before = [...manager.signingPairs];
            await silenceConsole(async () => {
                await assert.rejects(manager.forceRotate({ full: true }), /force rotation failed/);
            });

            // Snapshot revert: pools unchanged, private material intact
            assert.deepEqual(
                manager.signingPairs.map(k => k.keyPairId),
                before.map(k => k.keyPairId)
            );
            assert.ok(manager.signingPairs.every(k => k._nodePrivateKey !== undefined));
        });

        test('describeKeys reports non-expired kids only, without key material', async () => {
            const manager = await makeManager(Ctor, 'access');
            const expired = await manager.tokenSecretsCrypto.generateECDSAKey(ES256);
            expired.privateKeyExp = 1; // long past
            expired.publicKeyExp = 1;
            manager.signingPairs.push(expired);

            const description = manager.describeKeys();
            assert.equal(description.domain, 'access');
            assert.equal(description.algorithm, 'ES256');
            assert.equal(description.signing.length, 2);
            assert.ok(!description.signing.some(k => k.kid === expired.keyPairId));
            for (const key of description.signing) {
                assert.deepEqual(Object.keys(key).sort(), ['kid', 'privateKeyExp', 'publicKeyExp']);
            }
        });
    });
}
