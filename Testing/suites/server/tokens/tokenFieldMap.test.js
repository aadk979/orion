import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    toShortPayload,
    toVerbosePayload,
    getShortFormAuthMethod,
    getLongFormAuthMethod
} from '../../../../Packages/server/Orion-core/lib/Utils/Core/TokenManagement/tokenFieldMap.js';

describe('tokenFieldMap — payload compression', () => {
    test('round-trips a full stateful payload including tokenData nesting', () => {
        const payload = {
            uid: 'USER_abc123',
            email: 'user@example.com',
            authMethod: 'PROVIDER-GOOGLE',
            role: 'USER',
            securityTier: 4,
            hashedDeviceFingerprint: '$2b$12$somebcrypthash',
            ipRange: '203.0.113.0/24',
            refreshCount: 2,
            maxRefreshes: 10,
            tokenData: {
                tokenId: 'ACCESS_TOKEN_xyz',
                type: 'ACCESS_TOKEN',
                accessTokenLinkCode: 'AT_LINK_123'
            },
            aud: 'compressed-aud-string',
            iss: 'compressed-iss-string'
        };

        const short = toShortPayload(payload);

        // Verbose names must actually be gone from the wire format
        assert.equal(short.u, 'USER_abc123');
        assert.equal(short.am, 'PG');
        assert.equal(short.st, 4);
        assert.equal(short.td.t, 'at');
        assert.equal(short.td.ti, 'ACCESS_TOKEN_xyz');
        assert.equal(short.td.lc, 'AT_LINK_123');
        assert.ok(!('uid' in short));
        assert.ok(!('tokenData' in short));

        assert.deepEqual(toVerbosePayload(short), payload);
    });

    test('round-trips each token type shorthand', () => {
        for (const type of ['ACCESS_TOKEN', 'REFRESH_TOKEN', 'RESOURCE_TOKEN']) {
            const short = toShortPayload({ tokenData: { type } });
            const verbose = toVerbosePayload(short);
            assert.equal(verbose.tokenData.type, type);
        }
    });

    test('unknown keys pass through unchanged in both directions', () => {
        const short = toShortPayload({ exp: 1234567890, customClaim: 'kept' });
        assert.equal(short.exp, 1234567890);
        assert.equal(short.customClaim, 'kept');

        const verbose = toVerbosePayload({ exp: 1234567890, customClaim: 'kept' });
        assert.equal(verbose.exp, 1234567890);
        assert.equal(verbose.customClaim, 'kept');
    });

    test('auth method mapping is bijective and passes unknown values through', () => {
        const methods = [
            'PASSKEY',
            'PASSWORD',
            'PROVIDER-GOOGLE',
            'PROVIDER-GITHUB',
            'PROVIDER-DISCORD',
            'PROVIDER-SLACK',
            'PROVIDER-MICROSOFT',
            'PROVIDER-FACEBOOK',
            'PROVIDER-AMAZON',
            'PROVIDER-TWITTER',
            'PROVIDER-LINKEDIN',
            'PROVIDER-REDDIT',
            'PROVIDER-SPOTIFY'
        ];

        const shortForms = new Set();
        for (const method of methods) {
            const short = getShortFormAuthMethod(method);
            assert.notEqual(short, method, `${method} has no short form`);
            assert.equal(getLongFormAuthMethod(short), method);
            shortForms.add(short);
        }
        assert.equal(shortForms.size, methods.length, 'short forms collide');

        assert.equal(getShortFormAuthMethod('SOME-FUTURE-METHOD'), 'SOME-FUTURE-METHOD');
        assert.equal(getLongFormAuthMethod('SOME-FUTURE-METHOD'), 'SOME-FUTURE-METHOD');
    });
});
