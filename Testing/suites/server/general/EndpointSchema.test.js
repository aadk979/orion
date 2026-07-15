import '../../../helpers/bootstrap.js';
// logger.js must evaluate before anything pulls in GlobalAccessPoint.js: the two are
// circular and logger's module body calls globalAccessPoint at top level, so entering
// the cycle at GlobalAccessPoint leaves its binding in TDZ and the import throws.
import '../../../../Packages/server/Orion-core/lib/Utils/logger.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { endpointSchemas } from '../../../../Packages/server/Orion-core/lib/General/EndpointSchema.js';

const NS = 'alpine';
const route = suffix => `/${NS}/api/v1/${suffix}`;

describe('endpointSchemas — registry shape', () => {
    test('every value is a Joi schema with validate()', () => {
        const entries = Object.entries(endpointSchemas);
        assert.ok(entries.length > 0);
        for (const [path, schema] of entries) {
            assert.ok(path.startsWith(`/${NS}/api/v1/`), `unexpected path ${path}`);
            assert.equal(typeof schema.validate, 'function');
        }
    });
});

describe('sign-up-user schema', () => {
    const schema = endpointSchemas[route('action/sign-up-user')];

    test('accepts a valid email + password', () => {
        const { error } = schema.validate({ email: 'user@example.com', password: 'longenough' });
        assert.equal(error, undefined);
    });

    test('rejects an invalid email', () => {
        const { error } = schema.validate({ email: 'not-an-email', password: 'longenough' });
        assert.ok(error);
    });

    test('rejects a too-short password (min 7)', () => {
        const { error } = schema.validate({ email: 'user@example.com', password: 'short' });
        assert.ok(error);
    });

    test('rejects missing fields', () => {
        assert.ok(schema.validate({ email: 'user@example.com' }).error);
        assert.ok(schema.validate({}).error);
    });
});

describe('no-body endpoints (Joi.object().max(0))', () => {
    test('sign-out-user accepts an empty object and rejects extra keys', () => {
        const schema = endpointSchemas[route('action/sign-out-user')];
        assert.equal(schema.validate({}).error, undefined);
        assert.ok(schema.validate({ unexpected: true }).error);
    });
});

describe('totp code schema', () => {
    const schema = endpointSchemas[route('action/verify-and-enable-totp')];

    test('requires a 6-character code', () => {
        assert.equal(schema.validate({ totpCode: '123456' }).error, undefined);
        assert.ok(schema.validate({ totpCode: '123' }).error);
        assert.ok(schema.validate({ totpCode: '1234567' }).error);
        assert.ok(schema.validate({}).error);
    });
});

describe('captcha transaction schema (hex length 64)', () => {
    const schema = endpointSchemas[route('action/generate-no-auth-token-transaction')];

    test('accepts a 64-char hex hash and rejects non-hex/wrong length', () => {
        assert.equal(schema.validate({ captchaQuestionsHash: 'a'.repeat(64) }).error, undefined);
        assert.ok(schema.validate({ captchaQuestionsHash: 'zz' }).error);
        assert.ok(schema.validate({ captchaQuestionsHash: 'g'.repeat(64) }).error); // not hex
    });
});
