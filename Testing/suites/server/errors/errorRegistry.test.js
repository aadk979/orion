import '../../../helpers/bootstrap.js';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

// Import each error module DIRECTLY (not internal-errors.js, which writes
// errors.json as an import side effect). Each is a plain data object.
import { AccessTokens } from '../../../../Packages/server/Orion-core/lib/Errors/Authentication/accessTokens.js';
import { AuthenticationMiddleware } from '../../../../Packages/server/Orion-core/lib/Errors/Authentication/authenticationMiddleware.js';
import { RefreshTokens } from '../../../../Packages/server/Orion-core/lib/Errors/Authentication/refreshTokens.js';
import { ResourceTokens } from '../../../../Packages/server/Orion-core/lib/Errors/Authentication/resourceTokens.js';
import { AccountRegistration } from '../../../../Packages/server/Orion-core/lib/Errors/Account/registration.js';
import { AccountSignIn } from '../../../../Packages/server/Orion-core/lib/Errors/Account/signIn.js';
import { Passkeys } from '../../../../Packages/server/Orion-core/lib/Errors/Account/passkeys.js';
import { TOTP } from '../../../../Packages/server/Orion-core/lib/Errors/Account/totp.js';
import { UserControl } from '../../../../Packages/server/Orion-core/lib/Errors/Account/userControl.js';
import { OAuth } from '../../../../Packages/server/Orion-core/lib/Errors/OAuth/oauth.js';
import { StepUpAuth } from '../../../../Packages/server/Orion-core/lib/Errors/Security/stepUpAuth.js';
import { DeviceAuthorization } from '../../../../Packages/server/Orion-core/lib/Errors/Security/deviceAuthorization.js';
import { TwoFARemoval } from '../../../../Packages/server/Orion-core/lib/Errors/Security/twoFARemoval.js';
import { Captcha } from '../../../../Packages/server/Orion-core/lib/Errors/Security/captcha.js';
import { NoAuthToken } from '../../../../Packages/server/Orion-core/lib/Errors/Security/noAuthToken.js';
import { DataValidation } from '../../../../Packages/server/Orion-core/lib/Errors/Security/dataValidation.js';
import { General } from '../../../../Packages/server/Orion-core/lib/Errors/Security/general.js';
import { Mail } from '../../../../Packages/server/Orion-core/lib/Errors/Communication/mail.js';
import { Database } from '../../../../Packages/server/Orion-core/lib/Errors/System/database.js';
import { FileOperations } from '../../../../Packages/server/Orion-core/lib/Errors/System/fileOperations.js';
import { System } from '../../../../Packages/server/Orion-core/lib/Errors/System/system.js';
import { ResourceAccessS3 } from '../../../../Packages/server/Orion-core/lib/Errors/System/resourceAccessS3.js';

const modules = {
    AccessTokens,
    AuthenticationMiddleware,
    RefreshTokens,
    ResourceTokens,
    AccountRegistration,
    AccountSignIn,
    Passkeys,
    TOTP,
    UserControl,
    OAuth,
    StepUpAuth,
    DeviceAuthorization,
    TwoFARemoval,
    Captcha,
    NoAuthToken,
    DataValidation,
    General,
    Mail,
    Database,
    FileOperations,
    System,
    ResourceAccessS3
};

describe('Error registry — per-module structural integrity', () => {
    for (const [name, mod] of Object.entries(modules)) {
        test(`${name}: every entry is well-formed`, () => {
            assert.equal(typeof mod, 'object');
            assert.ok(Object.keys(mod).length > 0, `${name} is empty`);

            for (const [key, entry] of Object.entries(mod)) {
                assert.equal(entry.errorCode, key, `${name}.${key}: errorCode must equal its key`);

                assert.equal(typeof entry.status, 'number', `${name}.${key}: status must be a number`);
                assert.ok(entry.status >= 100 && entry.status <= 599, `${name}.${key}: status out of HTTP range`);

                assert.equal(typeof entry.context, 'string', `${name}.${key}: context must be a string`);
                assert.ok(entry.context.trim().length > 0, `${name}.${key}: context must be non-empty`);

                assert.ok(
                    ['CLIENT', 'SERVER', 'NEITHER', 'PROVIDER'].includes(entry.fault),
                    `${name}.${key}: fault must be one of CLIENT/SERVER/NEITHER/PROVIDER (got ${entry.fault})`
                );

                assert.ok(Array.isArray(entry.solutions), `${name}.${key}: solutions must be an array`);
                assert.ok(entry.solutions.length > 0, `${name}.${key}: solutions must be non-empty`);
                for (const s of entry.solutions) {
                    assert.equal(typeof s, 'string', `${name}.${key}: each solution must be a string`);
                }
            }
        });
    }
});

describe('Error registry — global uniqueness', () => {
    test('no error code is defined in more than one module', () => {
        const seen = new Map();
        const dupes = [];
        for (const [name, mod] of Object.entries(modules)) {
            for (const key of Object.keys(mod)) {
                if (seen.has(key)) dupes.push(`${key} (in ${seen.get(key)} and ${name})`);
                else seen.set(key, name);
            }
        }
        assert.deepEqual(dupes, [], `duplicate error codes: ${dupes.join(', ')}`);
    });

    test('the registry contains a meaningful number of codes', () => {
        const total = Object.values(modules).reduce((n, m) => n + Object.keys(m).length, 0);
        assert.ok(total >= 21, `expected many error codes, found ${total}`);
    });
});
