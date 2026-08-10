import '../../../helpers/bootstrap.js';
import test, { describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SystemAdminModel, PolicyModel, GroupModel, MagicLinkModel, SessionModel } from '../../../../Packages/server/Orion-Orchestrator/lib/SystemAdmin/models.js';

/**
 * Models for the system-admin plane.
 *
 * Every method here is one SQL statement, so what is worth testing is the
 * statement itself rather than Postgres' behaviour: the WHERE clauses ARE the
 * security properties. `DELETE ... AND role <> 'root'` is the only thing
 * stopping the root account from being deleted; `consumed_at IS NULL AND
 * expires_at > now()` is the only thing making a magic link single-use. A
 * refactor that drops one of those guards changes nothing observable in a
 * mocked test unless the guard is asserted directly — so it is.
 *
 * The db double records every call and returns whatever the test queued, which
 * also pins the row-unwrapping contract (rows[0] vs rows vs rowCount > 0).
 */

const fakeDb = (queued = []) => ({
    queries: [],
    queued: [...queued],
    async query(text, params) {
        this.queries.push({ text, params });
        const next = this.queued.shift();
        const rows = next ?? [];
        return { rows, rowCount: rows.length };
    },
    /** The single statement issued, with whitespace collapsed for matching. */
    get sql() {
        assert.equal(this.queries.length, 1, 'expected exactly one statement');
        return this.queries[0].text.replace(/\s+/g, ' ').trim();
    },
    get params() {
        return this.queries[0].params;
    }
});

describe('SystemAdminModel', () => {
    let db;
    let admins;

    beforeEach(() => {
        db = fakeDb();
        admins = new SystemAdminModel(db);
    });

    test('create mints a prefixed id and lowercases the email in SQL', async () => {
        db.queued.push([{ id: 'SAD_x' }]);

        const created = await admins.create({ email: 'Admin@Orion.Local', displayName: 'Ada', createdBy: 'SAD_root' });

        assert.deepEqual(created, { id: 'SAD_x' });
        assert.match(db.sql, /INSERT INTO orch_system_admins/i);
        // Case folding happens in the statement, not in JS — findByEmail relies
        // on the stored value already being lowercase.
        assert.match(db.sql, /VALUES \(\$1, lower\(\$2\)/);
        assert.match(db.params[0], /^ID_SAD-/, 'id must carry the SAD prefix');
        assert.deepEqual(db.params.slice(1), ['Admin@Orion.Local', 'Ada', 'admin', null, false, 'SAD_root']);
    });

    test('create defaults to a non-root admin with no password', async () => {
        db.queued.push([{}]);

        await admins.create({ email: 'a@b.c' });

        const [, , displayName, role, passwordHash, changeRequired, createdBy] = db.params;
        assert.deepEqual([displayName, role, passwordHash, changeRequired, createdBy], [null, 'admin', null, false, null]);
    });

    test('findByEmail folds case on the lookup side too', async () => {
        db.queued.push([{ id: 'SAD_1' }]);

        assert.deepEqual(await admins.findByEmail('ADMIN@ORION.LOCAL'), { id: 'SAD_1' });
        assert.match(db.sql, /WHERE email = lower\(\$1\)/);
    });

    test('findByEmail and findById return null rather than undefined when absent', async () => {
        assert.equal(await admins.findByEmail('nobody@orion.local'), null);
        assert.equal(await new SystemAdminModel(fakeDb()).findById('SAD_missing'), null);
    });

    test('list never selects secret columns', async () => {
        await admins.list();

        // Enumerated explicitly rather than SELECT * — this list is returned to
        // the panel, and totp_secret/password_hash must not ride along.
        assert.doesNotMatch(db.sql, /totp_secret|totp_pending_secret|password_hash/);
        assert.match(db.sql, /ORDER BY created_at/);
    });

    test('rootExists asks only whether a row exists', async () => {
        assert.equal(await admins.rootExists(), false);
        assert.match(db.sql, /WHERE role = 'root' LIMIT 1/);

        const populated = fakeDb([[{ '?column?': 1 }]]);
        assert.equal(await new SystemAdminModel(populated).rootExists(), true);
    });

    test('delete refuses to remove the root admin', async () => {
        await admins.delete('SAD_root');

        // The guard is in the statement: without it a root admin could delete
        // itself and leave the plane with no governance principal at all.
        assert.match(db.sql, /DELETE FROM orch_system_admins WHERE id = \$1 AND role <> 'root'/);
    });

    test('delete reports whether a row actually went away', async () => {
        assert.equal(await admins.delete('SAD_1'), false, 'no rows deleted → false');
        assert.equal(await new SystemAdminModel(fakeDb([[{ id: 'SAD_1' }]])).delete('SAD_1'), true);
    });

    test('setPasswordHash only ever touches the root row', async () => {
        await admins.setPasswordHash('SAD_1', 'hash', true);

        // Passwords are a root-only concept here; every other admin signs in by
        // magic link. The role predicate stops the column being set elsewhere.
        assert.match(db.sql, /WHERE id = \$1 AND role = 'root'/);
        assert.deepEqual(db.params, ['SAD_1', 'hash', true]);
    });

    test('setPasswordHash clears the change-required flag by default', async () => {
        await admins.setPasswordHash('SAD_1', 'hash');
        assert.equal(db.params[2], false);
    });

    test('activateTotp promotes the pending secret and requires one to exist', async () => {
        db.queued.push([{ id: 'SAD_1', totp_enabled: true }]);

        assert.deepEqual(await admins.activateTotp('SAD_1'), { id: 'SAD_1', totp_enabled: true });
        assert.match(db.sql, /totp_secret = totp_pending_secret/);
        assert.match(db.sql, /totp_pending_secret = NULL/);
        // Without this predicate a replayed activate would blank a live secret.
        assert.match(db.sql, /WHERE id = \$1 AND totp_pending_secret IS NOT NULL/);
    });

    test('activateTotp returns null when there was nothing pending', async () => {
        assert.equal(await admins.activateTotp('SAD_1'), null);
    });

    test('activateIfComplete demands every activation requirement at once', async () => {
        await admins.activateIfComplete('SAD_1');

        const sql = db.sql;
        assert.match(sql, /status = 'active'/);
        assert.match(sql, /AND status = 'pending'/, 'only a pending account is promoted');
        assert.match(sql, /AND totp_enabled = TRUE/, 'MFA enrollment is mandatory');
        assert.match(sql, /AND password_change_required = FALSE/, 'a bootstrap password must be rotated first');
    });

    describe('wipeTotpEnrollments', () => {
        test('spares root by default', async () => {
            await admins.wipeTotpEnrollments();

            // Root cannot use the magic-link path, so a root whose authenticator
            // is wiped has no route back in. Sparing it keeps one guaranteed door.
            assert.match(db.sql, /AND role <> 'root'/);
        });

        test('includes root only when explicitly asked', async () => {
            await admins.wipeTotpEnrollments({ includeRoot: true });

            assert.doesNotMatch(db.sql, /role <> 'root'/);
        });

        test('clears both secrets and returns active accounts to pending', async () => {
            const sql = (await admins.wipeTotpEnrollments(), db.sql);

            assert.match(sql, /totp_enabled = FALSE/);
            assert.match(sql, /totp_secret = NULL/);
            assert.match(sql, /totp_pending_secret = NULL/);
            // Suspended accounts stay suspended — a wipe is not a reinstatement.
            assert.match(sql, /status = CASE WHEN status = 'active' THEN 'pending' ELSE status END/);
        });

        test('only touches rows that had an enrollment to lose', async () => {
            await admins.wipeTotpEnrollments();

            assert.match(db.sql, /WHERE \(totp_enabled = TRUE OR totp_secret IS NOT NULL OR totp_pending_secret IS NOT NULL\)/);
        });

        test('returns the affected admins for the audit record', async () => {
            const populated = fakeDb([[{ id: 'SAD_1', email: 'a@b.c', role: 'admin' }]]);

            const wiped = await new SystemAdminModel(populated).wipeTotpEnrollments();

            assert.deepEqual(wiped, [{ id: 'SAD_1', email: 'a@b.c', role: 'admin' }]);
            assert.match(populated.sql, /RETURNING id, email, role/);
        });
    });
});

describe('PolicyModel', () => {
    let db;
    let policies;

    beforeEach(() => {
        db = fakeDb();
        policies = new PolicyModel(db);
    });

    test('create serialises the document and casts it to jsonb', async () => {
        db.queued.push([{ id: 'POL_x' }]);
        const document = { version: 1, statements: [{ sid: 's', effect: 'allow', actions: ['*'], resources: ['*'] }] };

        await policies.create({ name: 'admin-all', document, createdBy: 'SAD_root' });

        assert.match(db.sql, /\$4::jsonb/);
        assert.match(db.params[0], /^ID_POL-/);
        assert.equal(db.params[3], JSON.stringify(document), 'the document is passed as JSON text, not an object');
    });

    test('update leaves omitted fields alone via COALESCE', async () => {
        await policies.update('POL_1', { name: 'renamed' });

        assert.match(db.sql, /name = COALESCE\(\$2, name\)/);
        assert.match(db.sql, /description = COALESCE\(\$3, description\)/);
        assert.match(db.sql, /document = COALESCE\(\$4::jsonb, document\)/);
        // undefined would be sent as NULL by pg anyway; normalising here keeps
        // the "omitted means unchanged" contract explicit.
        assert.deepEqual(db.params, ['POL_1', 'renamed', null, null]);
    });

    test('update serialises a supplied document but passes null when omitted', async () => {
        const doc = { version: 1, statements: [] };
        await policies.update('POL_1', { document: doc });

        assert.equal(db.params[3], JSON.stringify(doc));
    });

    test('managed policies are neither editable nor deletable', async () => {
        await policies.update('POL_builtin', { name: 'hijacked' });
        assert.match(db.sql, /AND managed = FALSE/);

        const del = fakeDb();
        await new PolicyModel(del).delete('POL_builtin');
        assert.match(del.sql, /DELETE FROM orch_admin_policies WHERE id = \$1 AND managed = FALSE/);
    });

    test('delete reports whether the row was managed (and so survived)', async () => {
        assert.equal(await policies.delete('POL_builtin'), false);
        assert.equal(await new PolicyModel(fakeDb([[{ id: 'POL_1' }]])).delete('POL_1'), true);
    });

    test('attach is idempotent', async () => {
        await policies.attach('POL_1', 'admin', 'SAD_1', 'SAD_root');

        // Re-attaching the same policy is a no-op rather than a 500 — the panel
        // and CLI both allow re-issuing the same grant.
        assert.match(db.sql, /ON CONFLICT DO NOTHING/);
        assert.deepEqual(db.params, ['POL_1', 'admin', 'SAD_1', 'SAD_root']);
    });

    test('detach is scoped to one exact attachment', async () => {
        assert.equal(await policies.detach('POL_1', 'group', 'GRP_1'), false);

        assert.match(db.sql, /WHERE policy_id = \$1 AND principal_type = \$2 AND principal_id = \$3/);
    });

    test('getEffectiveDocuments unions direct grants with group membership', async () => {
        await policies.getEffectiveDocuments('SAD_1');

        const sql = db.sql;
        assert.match(sql, /SELECT DISTINCT/, 'a policy attached both ways must not be evaluated twice');
        assert.match(sql, /a\.principal_type = 'admin' AND a\.principal_id = \$1/);
        assert.match(sql, /a\.principal_type = 'group'/);
        assert.match(sql, /SELECT group_id FROM orch_admin_group_members WHERE admin_id = \$1/);
        assert.deepEqual(db.params, ['SAD_1']);
    });
});

describe('GroupModel', () => {
    test('create mints a GRP-prefixed id', async () => {
        const db = fakeDb([[{ id: 'GRP_x' }]]);

        await new GroupModel(db).create({ name: 'operators' });

        assert.match(db.params[0], /^ID_GRP-/);
        assert.deepEqual(db.params.slice(1), ['operators', null, null]);
    });

    test('list carries a member count so the panel needs one round trip', async () => {
        const db = fakeDb();
        await new GroupModel(db).list();

        assert.match(db.sql, /count\(\*\).*orch_admin_group_members.*AS member_count/);
        assert.match(db.sql, /::int/, 'Postgres count() is bigint — cast, or it arrives as a string');
    });

    test('addMember is idempotent', async () => {
        const db = fakeDb();
        await new GroupModel(db).addMember('GRP_1', 'SAD_1', 'SAD_root');

        assert.match(db.sql, /ON CONFLICT DO NOTHING/);
    });

    test('removeMember reports whether the membership existed', async () => {
        assert.equal(await new GroupModel(fakeDb()).removeMember('GRP_1', 'SAD_1'), false);
        assert.equal(await new GroupModel(fakeDb([[{}]])).removeMember('GRP_1', 'SAD_1'), true);
    });

    test('listMembers joins the admin record and never exposes secrets', async () => {
        const db = fakeDb();
        await new GroupModel(db).listMembers('GRP_1');

        assert.match(db.sql, /JOIN orch_system_admins a ON a\.id = m\.admin_id/);
        assert.doesNotMatch(db.sql, /totp_secret|password_hash/);
    });
});

describe('MagicLinkModel', () => {
    test('create stores only the hash and computes expiry in the database', async () => {
        const db = fakeDb([[{ id: 'MLK_x' }]]);

        await new MagicLinkModel(db).create('SAD_1', 'sha256-hash', 600, '10.0.0.1');

        assert.match(db.params[0], /^ID_MLK-/);
        // Expiry is `now() + interval` server-side: a skewed orchestrator clock
        // must not be able to mint a link that outlives its TTL.
        assert.match(db.sql, /now\(\) \+ \(\$4 \|\| ' seconds'\)::interval/);
        assert.deepEqual(db.params.slice(1), ['SAD_1', 'sha256-hash', '600', '10.0.0.1']);
        assert.equal(typeof db.params[4], 'string', 'the interval operand must be text, not a number');
    });

    test('consume is a single atomic statement, not read-then-write', async () => {
        const db = fakeDb([[{ id: 'MLK_1', admin_id: 'SAD_1' }]]);

        const row = await new MagicLinkModel(db).consume('sha256-hash');

        assert.deepEqual(row, { id: 'MLK_1', admin_id: 'SAD_1' });
        // The UPDATE ... RETURNING is what makes the link single-use: two
        // concurrent redemptions cannot both match consumed_at IS NULL.
        assert.match(db.sql, /^UPDATE orch_admin_magic_links SET consumed_at = now\(\)/);
        assert.match(db.sql, /WHERE token_hash = \$1 AND consumed_at IS NULL AND expires_at > now\(\)/);
    });

    test('consume returns null for a spent or expired link', async () => {
        assert.equal(await new MagicLinkModel(fakeDb()).consume('sha256-hash'), null);
    });

    test('issuing a new link voids every outstanding one for that admin', async () => {
        const db = fakeDb();
        await new MagicLinkModel(db).voidOutstanding('SAD_1');

        assert.match(db.sql, /WHERE admin_id = \$1 AND consumed_at IS NULL/);
    });

    test('purgeExpired keeps a day of history rather than deleting on expiry', async () => {
        const db = fakeDb();
        await new MagicLinkModel(db).purgeExpired();

        assert.match(db.sql, /expires_at < now\(\) - interval '1 day'/);
    });
});

describe('SessionModel', () => {
    test('create records the stage and computes expiry in the database', async () => {
        const db = fakeDb([[{ id: 'SES_x' }]]);

        await new SessionModel(db).create('SAD_1', 'hash', 'pending_totp', 900, '10.0.0.1', 'curl/8');

        assert.match(db.params[0], /^ID_SES-/);
        assert.match(db.sql, /now\(\) \+ \(\$5 \|\| ' seconds'\)::interval/);
        // Trailing null is the RFC 8705 cert_thumbprint: an unbound session,
        // which is what a deployment without mTLS creates.
        assert.deepEqual(db.params.slice(1), ['SAD_1', 'hash', 'pending_totp', '900', '10.0.0.1', 'curl/8', null]);
    });

    test('create binds the session to a client certificate when one is presented', async () => {
        const db = fakeDb([[{ id: 'SES_x' }]]);

        await new SessionModel(db).create('SAD_1', 'hash', 'active', 900, '10.0.0.1', 'curl/8', 'x5t-thumbprint');

        // RFC 8705: the thumbprint is stored so every later request can be
        // checked against the certificate on its own connection.
        assert.match(db.sql, /cert_thumbprint/);
        assert.equal(db.params.at(-1), 'x5t-thumbprint');
    });

    test('findLive excludes revoked and expired sessions in the lookup itself', async () => {
        const db = fakeDb([[{ session_id: 'SES_1', stage: 'active' }]]);

        await new SessionModel(db).findLive('hash');

        // Liveness is a predicate, not a post-filter — a revoked session must be
        // unresolvable rather than resolved-then-rejected.
        assert.match(db.sql, /WHERE s\.token_hash = \$1 AND s\.revoked_at IS NULL AND s\.expires_at > now\(\)/);
        assert.match(db.sql, /JOIN orch_system_admins a ON a\.id = s\.admin_id/);
    });

    test('findLive returns null when nothing matches', async () => {
        assert.equal(await new SessionModel(fakeDb()).findLive('hash'), null);
    });

    test('upgradeToActive cannot resurrect a revoked or expired session', async () => {
        const db = fakeDb([[{ id: 'SES_1', stage: 'active' }]]);

        await new SessionModel(db).upgradeToActive('SES_1', 43200);

        assert.match(db.sql, /SET stage = 'active'/);
        assert.match(db.sql, /WHERE id = \$1 AND revoked_at IS NULL AND expires_at > now\(\)/);
        assert.deepEqual(db.params, ['SES_1', '43200']);
    });

    test('upgradeToActive returns null when the session was no longer eligible', async () => {
        assert.equal(await new SessionModel(fakeDb()).upgradeToActive('SES_1', 43200), null);
    });

    test('revoke is idempotent and preserves the original revocation time', async () => {
        const db = fakeDb();
        await new SessionModel(db).revoke('SES_1');

        assert.match(db.sql, /WHERE id = \$1 AND revoked_at IS NULL/);
    });

    test('revokeAllForAdmin cuts every live session at once', async () => {
        const db = fakeDb();
        await new SessionModel(db).revokeAllForAdmin('SAD_1');

        // Suspension and deletion both depend on this: an already-issued session
        // must stop working immediately, not at its next expiry.
        assert.match(db.sql, /WHERE admin_id = \$1 AND revoked_at IS NULL/);
    });

    test('purgeExpired retains a week for forensics', async () => {
        const db = fakeDb();
        await new SessionModel(db).purgeExpired();

        assert.match(db.sql, /expires_at < now\(\) - interval '7 days'/);
    });
});

describe('models — id prefixes are distinct across tables', () => {
    test('each model mints its own recognisable prefix', async () => {
        const captured = {};

        const capture = key => ({
            queries: [],
            async query(_text, params) {
                captured[key] = params[0];
                return { rows: [{}], rowCount: 1 };
            }
        });

        await new SystemAdminModel(capture('admin')).create({ email: 'a@b.c' });
        await new PolicyModel(capture('policy')).create({ name: 'p', document: {} });
        await new GroupModel(capture('group')).create({ name: 'g' });
        await new MagicLinkModel(capture('link')).create('SAD_1', 'h', 60);
        await new SessionModel(capture('session')).create('SAD_1', 'h', 'active', 60);

        // generateId('SAD', n) yields `ID_SAD-<random>` — the table marker is
        // the segment between the ID_ namespace and the random tail.
        const prefixes = Object.values(captured).map(id => id.split('_')[1].split('-')[0]);
        assert.deepEqual(prefixes, ['SAD', 'POL', 'GRP', 'MLK', 'SES']);
        assert.equal(new Set(prefixes).size, 5, 'an id must identify which table it came from');
    });
});
