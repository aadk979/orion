import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    hashPassword,
    verifyPassword,
    generateToken,
    hashToken
} from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/authCrypto.js';

describe('authCrypto — passwords (scrypt)', () => {
    test('round-trips a password and rejects a wrong one', async () => {
        const hash = await hashPassword('correct horse battery staple');
        assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
        assert.equal(await verifyPassword('correct horse battery staple', hash), true);
        assert.equal(await verifyPassword('wrong password entirely', hash), false);
    });

    test('same password hashes differently each time (random salt)', async () => {
        const [a, b] = await Promise.all([hashPassword('same-input-12'), hashPassword('same-input-12')]);
        assert.notEqual(a, b);
        assert.equal(await verifyPassword('same-input-12', a), true);
        assert.equal(await verifyPassword('same-input-12', b), true);
    });

    test('verify never throws on garbage stored values', async () => {
        assert.equal(await verifyPassword('x', null), false);
        assert.equal(await verifyPassword('x', ''), false);
        assert.equal(await verifyPassword('x', 'bcrypt$whatever'), false);
        assert.equal(await verifyPassword('x', 'scrypt$not$numbers$at$all$!!'), false);
    });
});

describe('authCrypto — tokens', () => {
    test('raw token carries the prefix; only the hash is meant for storage', () => {
        const { raw, hash } = generateToken('MLT');
        assert.ok(raw.startsWith('MLT_'));
        assert.equal(hash, hashToken(raw));
        assert.equal(hash.length, 64); // sha256 hex
        assert.ok(!hash.includes(raw));
    });

    test('tokens are unique and long enough to be unguessable', () => {
        const seen = new Set();
        for (let i = 0; i < 200; i++) {
            const { raw } = generateToken('SES');
            assert.ok(raw.length >= 40);
            seen.add(raw);
        }
        assert.equal(seen.size, 200);
    });
});
