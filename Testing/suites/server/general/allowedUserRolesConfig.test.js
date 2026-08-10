import '../../../helpers/bootstrap.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { globalAccessPoint } from '../../../../Packages/server/Orion-core/lib/Utils/GlobalAccessPoint.js';
import { handleAllowedUserRolesConfig } from '../../../../Packages/server/Orion-core/lib/Server/onStartConfigurations.js';

/**
 * Boot-time loading of the custom end-user role allowlist.
 *
 * This suite exists because of a real defect: the setter read
 * `systemConfig.utilites` (sic) while the validator above it read
 * `systemConfig.utilities`. Optional chaining short-circuited the whole
 * expression, so a VALID config passed validation and then stored `undefined`.
 * No throw, no warning, clean boot — and every custom-role assignment failed
 * afterwards with CUSTOM-ROLES-NOT-CONFIGURED.
 *
 * The lesson these tests encode: it is not enough to assert that a good config
 * boots. Assert on the VALUE that lands in globalAccessPoint, because the store
 * is the only thing UserControl ever reads.
 */

// `systemConfig` is a locked GAP key, writable only inside the post-boot window
// (1 minute from GlobalAccessPoint construction). Each test file runs in its own
// child process, so that window is open for the whole file.
const setSystemConfig = config => {
    const accepted = globalAccessPoint.setValue('systemConfig', config);
    assert.equal(accepted, true, 'post-boot window closed — systemConfig became unwritable mid-suite');
};

describe('handleAllowedUserRolesConfig — the allowlist actually reaches the store', () => {
    beforeEach(() => {
        globalAccessPoint.setValue('allowedUserRoles', undefined);
    });

    test('a configured allowlist lands in globalAccessPoint as an array', () => {
        setSystemConfig({ utilities: { userRoles: { allowedUserRoles: ['USER', 'ADMIN', 'AUDITOR'] } } });

        handleAllowedUserRolesConfig();

        const stored = globalAccessPoint.allowedUserRoles();
        // The regression guard: `undefined` here is precisely the bug. UserControl
        // treats a falsy allowlist as "custom roles not configured" and refuses
        // every assignment, so asserting truthiness is the whole point.
        assert.ok(Array.isArray(stored), `expected an array, got ${typeof stored} (${stored})`);
        assert.deepEqual(stored, ['USER', 'ADMIN', 'AUDITOR']);
    });

    test('roles are uppercased and trimmed, so config casing is free', () => {
        setSystemConfig({ utilities: { userRoles: { allowedUserRoles: ['  auditor ', 'Support', 'uSeR'] } } });

        handleAllowedUserRolesConfig();

        assert.deepEqual(globalAccessPoint.allowedUserRoles(), ['AUDITOR', 'SUPPORT', 'USER']);
    });

    test('a single-role allowlist is stored as-is (length is not a filter)', () => {
        setSystemConfig({ utilities: { userRoles: { allowedUserRoles: ['auditor'] } } });

        handleAllowedUserRolesConfig();

        assert.deepEqual(globalAccessPoint.allowedUserRoles(), ['AUDITOR']);
    });

    test('no userRoles block stores null — custom roles stay off, boot succeeds', () => {
        setSystemConfig({ utilities: { logToFile: false } });

        handleAllowedUserRolesConfig();

        assert.equal(globalAccessPoint.allowedUserRoles(), null);
    });

    test('no utilities block at all is equally benign', () => {
        setSystemConfig({ apiSlug: '' });

        handleAllowedUserRolesConfig();

        assert.equal(globalAccessPoint.allowedUserRoles(), null);
    });

    test('a top-level allowedUserRoles is NOT read — only utilities.userRoles is', () => {
        // Pins the config contract. The integration example fixture once declared
        // the key at the top level, which is silently ignored; anyone copying that
        // shape would believe custom roles were enabled when they were not.
        setSystemConfig({ allowedUserRoles: ['AUDITOR'] });

        handleAllowedUserRolesConfig();

        assert.equal(globalAccessPoint.allowedUserRoles(), null);
    });
});

describe('handleAllowedUserRolesConfig — misconfiguration fails the boot loudly', () => {
    test('a present userRoles block with a non-array allowlist throws', () => {
        setSystemConfig({ utilities: { userRoles: { allowedUserRoles: 'AUDITOR' } } });

        assert.throws(() => handleAllowedUserRolesConfig(), /must be a valid array of roles/);
    });

    test('an empty allowlist throws rather than silently disabling custom roles', () => {
        setSystemConfig({ utilities: { userRoles: { allowedUserRoles: [] } } });

        assert.throws(() => handleAllowedUserRolesConfig(), /array is empty/);
    });

    test('a userRoles block with the key missing entirely throws', () => {
        setSystemConfig({ utilities: { userRoles: {} } });

        assert.throws(() => handleAllowedUserRolesConfig(), /must be a valid array of roles/);
    });

    test('the error message reports the real type, not a hardcoded undefined', () => {
        // The message read `systemConfig.userRoles?...` (missing `.utilities`), so
        // it always said "got undefined" no matter what was passed — actively
        // misleading whoever hit the validation error.
        setSystemConfig({ utilities: { userRoles: { allowedUserRoles: 'AUDITOR' } } });

        assert.throws(() => handleAllowedUserRolesConfig(), /got string$/);

        setSystemConfig({ utilities: { userRoles: { allowedUserRoles: 42 } } });

        assert.throws(() => handleAllowedUserRolesConfig(), /got number$/);
    });
});
