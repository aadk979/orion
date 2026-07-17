/**
 * Data models for the system-admin plane. Every model takes the AdminDatabase
 * (anything exposing `query(text, params)`) so tests can inject a stub.
 *
 * The orchestrator is the ONLY writer of these tables — workers read at most
 * (enforced later via DB grants), and nothing here is reachable from worker
 * code paths.
 */

import { valueGeneratorExports } from 'r-sync';

const { generateId } = valueGeneratorExports;

// ── System admins ────────────────────────────────────────────────────────────

class SystemAdminModel {

    constructor(db) {
        this.db = db;
    }

    async create({ email, displayName = null, role = 'admin', passwordHash = null, passwordChangeRequired = false, createdBy = null }) {
        const id = generateId('SAD', 24);
        const { rows } = await this.db.query(
            `INSERT INTO orch_system_admins
                (id, email, display_name, role, password_hash, password_change_required, created_by)
             VALUES ($1, lower($2), $3, $4, $5, $6, $7)
             RETURNING *`,
            [id, email, displayName, role, passwordHash, passwordChangeRequired, createdBy]
        );
        return rows[0];
    }

    async findByEmail(email) {
        const { rows } = await this.db.query(
            'SELECT * FROM orch_system_admins WHERE email = lower($1)',
            [email]
        );
        return rows[0] || null;
    }

    async findById(id) {
        const { rows } = await this.db.query('SELECT * FROM orch_system_admins WHERE id = $1', [id]);
        return rows[0] || null;
    }

    async list() {
        const { rows } = await this.db.query(
            `SELECT id, email, display_name, role, status, totp_enabled,
                    password_change_required, created_by, created_at, updated_at, last_login_at
             FROM orch_system_admins ORDER BY created_at`
        );
        return rows;
    }

    async rootExists() {
        const { rows } = await this.db.query("SELECT 1 FROM orch_system_admins WHERE role = 'root' LIMIT 1");
        return rows.length > 0;
    }

    async setStatus(id, status) {
        const { rows } = await this.db.query(
            'UPDATE orch_system_admins SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
            [id, status]
        );
        return rows[0] || null;
    }

    async delete(id) {
        const { rowCount } = await this.db.query(
            "DELETE FROM orch_system_admins WHERE id = $1 AND role <> 'root'",
            [id]
        );
        return rowCount > 0;
    }

    async savePendingTotpSecret(id, secret) {
        await this.db.query(
            'UPDATE orch_system_admins SET totp_pending_secret = $2, updated_at = now() WHERE id = $1',
            [id, secret]
        );
    }

    /** Promotes the pending TOTP secret to active; enrollment is complete. */
    async activateTotp(id) {
        const { rows } = await this.db.query(
            `UPDATE orch_system_admins
             SET totp_secret = totp_pending_secret,
                 totp_pending_secret = NULL,
                 totp_enabled = TRUE,
                 updated_at = now()
             WHERE id = $1 AND totp_pending_secret IS NOT NULL
             RETURNING *`,
            [id]
        );
        return rows[0] || null;
    }

    /**
     * An account is deemed usable only once MFA enrollment completed (and, for
     * root, the initial password was rotated) — this flips pending → active
     * when every activation requirement is met.
     */
    async activateIfComplete(id) {
        const { rows } = await this.db.query(
            `UPDATE orch_system_admins
             SET status = 'active', updated_at = now()
             WHERE id = $1 AND status = 'pending'
               AND totp_enabled = TRUE
               AND password_change_required = FALSE
             RETURNING *`,
            [id]
        );
        return rows[0] || null;
    }

    async setPasswordHash(id, passwordHash, changeRequired = false) {
        await this.db.query(
            `UPDATE orch_system_admins
             SET password_hash = $2, password_change_required = $3, updated_at = now()
             WHERE id = $1 AND role = 'root'`,
            [id, passwordHash, changeRequired]
        );
    }

    async markLogin(id) {
        await this.db.query(
            'UPDATE orch_system_admins SET last_login_at = now(), updated_at = now() WHERE id = $1',
            [id]
        );
    }
}

// ── Policies + attachments ───────────────────────────────────────────────────

class PolicyModel {

    constructor(db) {
        this.db = db;
    }

    async create({ name, description = null, document, createdBy = null }) {
        const id = generateId('POL', 24);
        const { rows } = await this.db.query(
            `INSERT INTO orch_admin_policies (id, name, description, document, created_by)
             VALUES ($1, $2, $3, $4::jsonb, $5)
             RETURNING *`,
            [id, name, description, JSON.stringify(document), createdBy]
        );
        return rows[0];
    }

    async update(id, { name, description, document }) {
        const { rows } = await this.db.query(
            `UPDATE orch_admin_policies
             SET name = COALESCE($2, name),
                 description = COALESCE($3, description),
                 document = COALESCE($4::jsonb, document),
                 updated_at = now()
             WHERE id = $1 AND managed = FALSE
             RETURNING *`,
            [id, name ?? null, description ?? null, document ? JSON.stringify(document) : null]
        );
        return rows[0] || null;
    }

    /** Managed (built-in) policies are undeletable. */
    async delete(id) {
        const { rowCount } = await this.db.query(
            'DELETE FROM orch_admin_policies WHERE id = $1 AND managed = FALSE',
            [id]
        );
        return rowCount > 0;
    }

    async list() {
        const { rows } = await this.db.query('SELECT * FROM orch_admin_policies ORDER BY created_at');
        return rows;
    }

    async findById(id) {
        const { rows } = await this.db.query('SELECT * FROM orch_admin_policies WHERE id = $1', [id]);
        return rows[0] || null;
    }

    async findByName(name) {
        const { rows } = await this.db.query('SELECT * FROM orch_admin_policies WHERE name = $1', [name]);
        return rows[0] || null;
    }

    async attach(policyId, principalType, principalId, attachedBy = null) {
        await this.db.query(
            `INSERT INTO orch_admin_policy_attachments (policy_id, principal_type, principal_id, attached_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [policyId, principalType, principalId, attachedBy]
        );
    }

    async detach(policyId, principalType, principalId) {
        const { rowCount } = await this.db.query(
            `DELETE FROM orch_admin_policy_attachments
             WHERE policy_id = $1 AND principal_type = $2 AND principal_id = $3`,
            [policyId, principalType, principalId]
        );
        return rowCount > 0;
    }

    async listAttachments(policyId) {
        const { rows } = await this.db.query(
            'SELECT * FROM orch_admin_policy_attachments WHERE policy_id = $1',
            [policyId]
        );
        return rows;
    }

    /**
     * The admin's effective policy documents: policies attached to them
     * directly plus policies attached to any group they belong to.
     */
    async getEffectiveDocuments(adminId) {
        const { rows } = await this.db.query(
            `SELECT DISTINCT p.id, p.name, p.document
             FROM orch_admin_policies p
             JOIN orch_admin_policy_attachments a ON a.policy_id = p.id
             WHERE (a.principal_type = 'admin' AND a.principal_id = $1)
                OR (a.principal_type = 'group' AND a.principal_id IN (
                        SELECT group_id FROM orch_admin_group_members WHERE admin_id = $1))`,
            [adminId]
        );
        return rows;
    }
}

// ── Groups ───────────────────────────────────────────────────────────────────

class GroupModel {

    constructor(db) {
        this.db = db;
    }

    async create({ name, description = null, createdBy = null }) {
        const id = generateId('GRP', 24);
        const { rows } = await this.db.query(
            `INSERT INTO orch_admin_groups (id, name, description, created_by)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [id, name, description, createdBy]
        );
        return rows[0];
    }

    async delete(id) {
        const { rowCount } = await this.db.query('DELETE FROM orch_admin_groups WHERE id = $1', [id]);
        return rowCount > 0;
    }

    async list() {
        const { rows } = await this.db.query(
            `SELECT g.*,
                    (SELECT count(*) FROM orch_admin_group_members m WHERE m.group_id = g.id)::int AS member_count
             FROM orch_admin_groups g ORDER BY g.created_at`
        );
        return rows;
    }

    async findById(id) {
        const { rows } = await this.db.query('SELECT * FROM orch_admin_groups WHERE id = $1', [id]);
        return rows[0] || null;
    }

    async addMember(groupId, adminId, addedBy = null) {
        await this.db.query(
            `INSERT INTO orch_admin_group_members (group_id, admin_id, added_by)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [groupId, adminId, addedBy]
        );
    }

    async removeMember(groupId, adminId) {
        const { rowCount } = await this.db.query(
            'DELETE FROM orch_admin_group_members WHERE group_id = $1 AND admin_id = $2',
            [groupId, adminId]
        );
        return rowCount > 0;
    }

    async listMembers(groupId) {
        const { rows } = await this.db.query(
            `SELECT a.id, a.email, a.display_name, a.role, a.status, m.added_at
             FROM orch_admin_group_members m
             JOIN orch_system_admins a ON a.id = m.admin_id
             WHERE m.group_id = $1 ORDER BY m.added_at`,
            [groupId]
        );
        return rows;
    }
}

// ── Magic links ──────────────────────────────────────────────────────────────

class MagicLinkModel {

    constructor(db) {
        this.db = db;
    }

    async create(adminId, tokenHash, ttlSeconds, requestedIp = null) {
        const id = generateId('MLK', 24);
        const { rows } = await this.db.query(
            `INSERT INTO orch_admin_magic_links (id, admin_id, token_hash, expires_at, requested_ip)
             VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval, $5)
             RETURNING *`,
            [id, adminId, tokenHash, String(ttlSeconds), requestedIp]
        );
        return rows[0];
    }

    /** Atomic single-use consumption — returns the row only on first valid use. */
    async consume(tokenHash) {
        const { rows } = await this.db.query(
            `UPDATE orch_admin_magic_links
             SET consumed_at = now()
             WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
             RETURNING *`,
            [tokenHash]
        );
        return rows[0] || null;
    }

    /** All still-live links for an admin are voided when a new one is issued. */
    async voidOutstanding(adminId) {
        await this.db.query(
            `UPDATE orch_admin_magic_links SET consumed_at = now()
             WHERE admin_id = $1 AND consumed_at IS NULL`,
            [adminId]
        );
    }

    async purgeExpired() {
        await this.db.query(
            "DELETE FROM orch_admin_magic_links WHERE expires_at < now() - interval '1 day'"
        );
    }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

class SessionModel {

    constructor(db) {
        this.db = db;
    }

    async create(adminId, tokenHash, stage, ttlSeconds, ip = null, userAgent = null) {
        const id = generateId('SES', 24);
        const { rows } = await this.db.query(
            `INSERT INTO orch_admin_sessions (id, admin_id, token_hash, stage, expires_at, ip, user_agent)
             VALUES ($1, $2, $3, $4, now() + ($5 || ' seconds')::interval, $6, $7)
             RETURNING *`,
            [id, adminId, tokenHash, stage, String(ttlSeconds), ip, userAgent]
        );
        return rows[0];
    }

    /** Returns the session joined with its admin, only while live. */
    async findLive(tokenHash) {
        const { rows } = await this.db.query(
            `SELECT s.id AS session_id, s.stage, s.expires_at, s.ip, s.user_agent,
                    a.*
             FROM orch_admin_sessions s
             JOIN orch_system_admins a ON a.id = s.admin_id
             WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
            [tokenHash]
        );
        return rows[0] || null;
    }

    /** pending_totp → active, extending the session to the full TTL. */
    async upgradeToActive(sessionId, ttlSeconds) {
        const { rows } = await this.db.query(
            `UPDATE orch_admin_sessions
             SET stage = 'active', expires_at = now() + ($2 || ' seconds')::interval
             WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()
             RETURNING *`,
            [sessionId, String(ttlSeconds)]
        );
        return rows[0] || null;
    }

    async revoke(sessionId) {
        await this.db.query(
            'UPDATE orch_admin_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
            [sessionId]
        );
    }

    /** Suspension/deletion must cut every live session instantly. */
    async revokeAllForAdmin(adminId) {
        await this.db.query(
            'UPDATE orch_admin_sessions SET revoked_at = now() WHERE admin_id = $1 AND revoked_at IS NULL',
            [adminId]
        );
    }

    async purgeExpired() {
        await this.db.query(
            "DELETE FROM orch_admin_sessions WHERE expires_at < now() - interval '7 days'"
        );
    }
}

export { SystemAdminModel, PolicyModel, GroupModel, MagicLinkModel, SessionModel };
