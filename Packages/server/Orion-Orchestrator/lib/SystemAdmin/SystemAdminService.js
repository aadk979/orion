/**
 * SystemAdminService — every system-admin capability behind the orch panel
 * and CLI, independent of HTTP:
 *
 *   - Root bootstrap: on first boot (no root row), the root admin is created
 *     from config with a forced password rotation + mandatory TOTP enrollment
 *     before the account is deemed active.
 *   - Authentication: passwordless magic links (+ required TOTP) for every
 *     admin; password + TOTP for root. Sessions are two-stage — the first
 *     factor yields a short 'pending_totp' session that can only talk to the
 *     TOTP endpoints; the code upgrades it to 'active'.
 *   - Governance (ROOT ONLY): admin CRUD/suspension, policy CRUD, groups,
 *     attachments. Enforced by role here — never only at the route layer.
 *   - Authorization: PBAC evaluation of the caller's effective policy set
 *     (direct + group attachments, deny-overrides, default deny). Root
 *     bypasses PBAC; everyone else gets exactly their policy — no more,
 *     no less.
 *
 * Every decision that matters lands in the immutable AuditLog.
 */

import { generateSecret, verify as verifyTotp, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { logger } from 'r-sync';
import { SystemAdminModel, PolicyModel, GroupModel, MagicLinkModel, SessionModel } from './models.js';
import { AuditLog } from './AuditLog.js';
import { AdminMailer } from './AdminMailer.js';
import { hashPassword, verifyPassword, generateToken, hashToken } from './authCrypto.js';
import { evaluate, validatePolicyDocument } from './PBACEngine.js';

const DEFAULT_READ_ONLY_POLICY_ID = 'POL_DEFAULT_READ_ONLY';
const MIN_PASSWORD_LENGTH = 12;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

// TOTP step is 30s and verification allows ±1 step, so a code stays arithmetically
// valid for ~90s. Remembering consumed codes a little past that window makes them
// genuinely one-time, as RFC 6238 §5.2 requires.
const TOTP_CONSUMED_RETENTION_MS = 120 * 1000;

class AdminError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

const publicAdmin = a =>
    a && {
        id: a.id,
        email: a.email,
        displayName: a.display_name,
        role: a.role,
        status: a.status,
        totpEnrolled: a.totp_enabled === true,
        passwordChangeRequired: a.password_change_required === true,
        createdBy: a.created_by,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
        lastLoginAt: a.last_login_at
    };

class SystemAdminService {
    constructor(db, config = {}) {
        this.db = db;
        this.config = {
            magicLinkTtlMinutes: 10,
            pendingSessionTtlMinutes: 15,
            sessionTtlHours: 12,
            totpIssuer: 'Orion Orchestrator',
            baseUrl: null,
            ...config
        };

        this.admins = new SystemAdminModel(db);
        this.policies = new PolicyModel(db);
        this.groups = new GroupModel(db);
        this.magicLinks = new MagicLinkModel(db);
        this.sessions = new SessionModel(db);
        this.audit = new AuditLog(db);
        this.mailer = new AdminMailer(config.mail || {});

        this._purgeTimer = null;

        // adminId:code -> expiry. Makes an accepted TOTP code single-use, so an
        // observed code cannot be replayed inside its validity window.
        this._consumedTotp = new Map();
    }

    /**
     * Records a TOTP code as consumed. Returns false when it was already used,
     * which the caller must treat exactly like an invalid code.
     */
    _claimTotpCode(adminId, token) {
        const key = `${adminId}:${token}`;
        const now = Date.now();

        for (const [k, expiry] of this._consumedTotp) {
            if (expiry <= now) this._consumedTotp.delete(k);
        }

        if (this._consumedTotp.has(key)) return false;

        this._consumedTotp.set(key, now + TOTP_CONSUMED_RETENTION_MS);
        return true;
    }

    start() {
        this._purgeTimer = setInterval(() => {
            Promise.all([this.magicLinks.purgeExpired(), this.sessions.purgeExpired()]).catch(err =>
                logger.warn(`SystemAdminService: purge cycle failed — ${err.message}`)
            );
        }, PURGE_INTERVAL_MS);
        this._purgeTimer.unref?.();
    }

    stop() {
        if (this._purgeTimer) {
            clearInterval(this._purgeTimer);
            this._purgeTimer = null;
        }
    }

    // ── Bootstrap ─────────────────────────────────────────────────────────────

    /**
     * Creates the root admin on first boot. Root holds total governance and is
     * the only account with a password — rotated on first login, then TOTP
     * enrollment, before the account activates.
     */
    async bootstrapRoot(rootConfig = {}) {
        if (await this.admins.rootExists()) return null;

        const { email, initialPassword } = rootConfig;
        if (!email || !initialPassword) {
            throw new Error(
                'System admin bootstrap: no root admin exists and systemAdmin.rootAdmin ' +
                    '{ email, initialPassword } is not configured — the control plane cannot start ungoverned'
            );
        }
        if (initialPassword.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`System admin bootstrap: rootAdmin.initialPassword must be at least ${MIN_PASSWORD_LENGTH} characters`);
        }

        const passwordHash = await hashPassword(initialPassword);
        const root = await this.admins.create({
            email,
            displayName: 'Root Administrator',
            role: 'root',
            passwordHash,
            passwordChangeRequired: true,
            createdBy: 'first-boot'
        });

        await this.audit.write({
            adminId: root.id,
            adminEmail: root.email,
            action: 'auth:root-bootstrapped',
            resource: 'system',
            decision: 'allow',
            details: { note: 'root admin created on first boot; password rotation + TOTP enrollment pending' }
        });

        logger.warn(`SystemAdminService: root admin ${root.email} bootstrapped — first login must rotate the password and enroll TOTP`);
        return publicAdmin(root);
    }

    // ── Authentication: magic link ────────────────────────────────────────────

    /**
     * Always resolves without revealing whether the email exists — magic-link
     * request responses are indistinguishable by design.
     */
    async requestMagicLink(email, ip = null) {
        const admin = email ? await this.admins.findByEmail(email) : null;

        // Root signs in with password + TOTP; suspended admins get nothing.
        if (!admin || admin.role === 'root' || admin.status === 'suspended') {
            this.audit.writeSafe({
                adminId: admin?.id || null,
                adminEmail: String(email || '').toLowerCase() || null,
                ip,
                action: 'auth:magic-link-refused',
                resource: 'auth',
                decision: 'deny',
                details: { reason: !admin ? 'unknown-email' : admin.role === 'root' ? 'root-uses-password' : 'suspended' }
            });
            return { requested: true };
        }

        await this.magicLinks.voidOutstanding(admin.id);

        const { raw, hash } = generateToken('MLT');
        const ttlMinutes = this.config.magicLinkTtlMinutes;
        await this.magicLinks.create(admin.id, hash, ttlMinutes * 60, ip);

        const link = this.config.baseUrl
            ? `${String(this.config.baseUrl).replace(/\/$/, '')}/login/?code=${encodeURIComponent(raw)}`
            : `(no baseUrl configured — use the code in the panel or CLI)`;

        await this.mailer.sendMagicLink(admin.email, { link, code: raw, ttlMinutes });

        this.audit.writeSafe({
            adminId: admin.id,
            adminEmail: admin.email,
            ip,
            action: 'auth:magic-link-issued',
            resource: 'auth',
            decision: 'allow',
            details: { ttlMinutes }
        });

        return { requested: true };
    }

    /** First factor complete → short pending session; TOTP is always required next. */
    async verifyMagicLink(code, ip = null, userAgent = null) {
        const link = code ? await this.magicLinks.consume(hashToken(code)) : null;
        if (!link) {
            this.audit.writeSafe({
                ip,
                action: 'auth:magic-link-rejected',
                resource: 'auth',
                decision: 'deny',
                details: { reason: 'invalid-expired-or-reused' }
            });
            throw new AdminError('AUTH::MAGIC-LINK-INVALID', 'Sign-in link is invalid, expired, or already used', 401);
        }

        const admin = await this.admins.findById(link.admin_id);
        if (!admin || admin.status === 'suspended') {
            throw new AdminError('AUTH::ACCOUNT-UNAVAILABLE', 'This account cannot sign in', 403);
        }

        return this._openPendingSession(admin, ip, userAgent, 'magic-link');
    }

    // ── Authentication: root password ─────────────────────────────────────────

    async rootLogin(email, password, ip = null, userAgent = null) {
        const admin = email ? await this.admins.findByEmail(email) : null;
        const valid = admin && admin.role === 'root' && admin.status !== 'suspended' && (await verifyPassword(password || '', admin.password_hash));

        if (!valid) {
            this.audit.writeSafe({
                adminEmail: String(email || '').toLowerCase() || null,
                ip,
                action: 'auth:root-login-rejected',
                resource: 'auth',
                decision: 'deny',
                details: {}
            });
            throw new AdminError('AUTH::INVALID-CREDENTIALS', 'Invalid credentials', 401);
        }

        return this._openPendingSession(admin, ip, userAgent, 'root-password');
    }

    async _openPendingSession(admin, ip, userAgent, method) {
        const { raw, hash } = generateToken('OAS');
        await this.sessions.create(admin.id, hash, 'pending_totp', this.config.pendingSessionTtlMinutes * 60, ip, userAgent);

        this.audit.writeSafe({
            adminId: admin.id,
            adminEmail: admin.email,
            ip,
            action: `auth:first-factor-passed:${method}`,
            resource: 'auth',
            decision: 'allow',
            details: { totpEnrolled: admin.totp_enabled === true }
        });

        return {
            token: raw,
            stage: 'pending_totp',
            totpEnrolled: admin.totp_enabled === true,
            passwordChangeRequired: admin.password_change_required === true,
            admin: publicAdmin(admin)
        };
    }

    /**
     * Issues a NEW session credential at the pending → active transition and
     * revokes the pending one, instead of upgrading the pending row in place.
     *
     * The pending token exists before the second factor has been presented, and
     * for non-root admins it is delivered by email. Carrying that same value
     * forward as the fully privileged session means anyone who observed it holds
     * the elevated session — the standard session-fixation-on-elevation problem.
     *
     * @returns {{ token: string }} the raw token to hand back to the caller
     */
    async _rotateSessionOnElevation(session, adminId, ip = null) {
        const { raw, hash } = generateToken('OAS');

        await this.sessions.create(adminId, hash, 'active', this.config.sessionTtlHours * 3600, ip, session.userAgent || null);
        await this.sessions.revoke(session.sessionId);

        this.audit.writeSafe({
            adminId,
            ip,
            action: 'auth:session-rotated-on-elevation',
            resource: 'auth',
            decision: 'allow',
            details: { previousSessionId: session.sessionId }
        });

        return { token: raw };
    }

    // ── Session resolution (used by API middleware and the CLI) ──────────────

    async resolveSession(rawToken) {
        if (!rawToken) return null;
        const row = await this.sessions.findLive(hashToken(rawToken));
        if (!row) return null;

        return {
            sessionId: row.session_id,
            stage: row.stage,
            expiresAt: row.expires_at,
            admin: {
                id: row.id,
                email: row.email,
                display_name: row.display_name,
                role: row.role,
                status: row.status,
                totp_enabled: row.totp_enabled,
                totp_secret: row.totp_secret,
                totp_pending_secret: row.totp_pending_secret,
                password_hash: row.password_hash,
                password_change_required: row.password_change_required,
                created_by: row.created_by,
                created_at: row.created_at,
                updated_at: row.updated_at,
                last_login_at: row.last_login_at
            }
        };
    }

    async logout(sessionId, admin, ip = null) {
        await this.sessions.revoke(sessionId);
        this.audit.writeSafe({
            adminId: admin?.id || null,
            adminEmail: admin?.email || null,
            ip,
            action: 'auth:logout',
            resource: 'auth',
            decision: 'allow',
            details: {}
        });
    }

    // ── TOTP (mandatory MFA layer) ────────────────────────────────────────────

    /** Begins enrollment — allowed only while the account has no active TOTP. */
    async totpSetupStart(session) {
        const admin = session.admin;
        if (admin.totp_enabled) {
            throw new AdminError('TOTP::ALREADY-ENROLLED', 'TOTP is already enrolled for this account', 409);
        }

        const secret = generateSecret();
        await this.admins.savePendingTotpSecret(admin.id, secret);

        const uri = generateURI({ label: admin.email, issuer: this.config.totpIssuer, secret });
        let qrDataUrl = null;
        try {
            qrDataUrl = await QRCode.toDataURL(uri);
        } catch (_) {
            /* URI + manual secret entry still work */
        }

        this.audit.writeSafe({
            adminId: admin.id,
            adminEmail: admin.email,
            action: 'auth:totp-enrollment-started',
            resource: 'auth',
            decision: 'allow',
            details: {}
        });

        return { secret, uri, qrDataUrl };
    }

    /** Completes enrollment; upgrades the session and activates the account when done. */
    async totpActivate(session, token, ip = null) {
        const admin = await this.admins.findById(session.admin.id);
        if (!admin?.totp_pending_secret) {
            throw new AdminError('TOTP::NO-PENDING-ENROLLMENT', 'No TOTP enrollment in progress', 409);
        }

        const result = await verifyTotp({ token: String(token || ''), secret: admin.totp_pending_secret, window: 1 });
        if (!result?.valid) {
            this.audit.writeSafe({
                adminId: admin.id,
                adminEmail: admin.email,
                ip,
                action: 'auth:totp-activate-rejected',
                resource: 'auth',
                decision: 'deny',
                details: {}
            });
            throw new AdminError('TOTP::INVALID-TOKEN', 'Invalid authenticator code', 401);
        }

        await this.admins.activateTotp(admin.id);
        // Root still rotating its bootstrap password stays 'pending' until done.
        await this.admins.activateIfComplete(admin.id);
        // Rotate the session credential on privilege elevation rather than
        // upgrading the existing row in place. The pending token was handed out
        // BEFORE the second factor — for non-root admins it arrives via a magic
        // link through email — so promoting that same value to a fully
        // privileged session hands the elevated session to anyone who saw it.
        const elevated = await this._rotateSessionOnElevation(session, admin.id, ip);
        await this.admins.markLogin(admin.id);

        const fresh = await this.admins.findById(admin.id);
        await this.audit.write({
            adminId: admin.id,
            adminEmail: admin.email,
            ip,
            action: 'auth:totp-enrolled',
            resource: 'auth',
            decision: 'allow',
            details: { accountStatus: fresh.status }
        });

        return { stage: 'active', admin: publicAdmin(fresh), token: elevated.token };
    }

    /** Second factor for every subsequent login. */
    async totpVerify(session, token, ip = null) {
        const admin = session.admin;
        if (!admin.totp_enabled || !admin.totp_secret) {
            throw new AdminError('TOTP::NOT-ENROLLED', 'TOTP enrollment is required first', 409);
        }

        const result = await verifyTotp({ token: String(token || ''), secret: admin.totp_secret, window: 1 });

        // A code that verifies but has already been spent is rejected exactly
        // like an invalid one — same audit action, same error, no oracle.
        const fresh = result?.valid ? this._claimTotpCode(admin.id, String(token || '')) : false;

        if (!result?.valid || !fresh) {
            this.audit.writeSafe({
                adminId: admin.id,
                adminEmail: admin.email,
                ip,
                action: 'auth:totp-rejected',
                resource: 'auth',
                decision: 'deny',
                details: {}
            });
            throw new AdminError('TOTP::INVALID-TOKEN', 'Invalid authenticator code', 401);
        }

        // Rotate the session credential on privilege elevation rather than
        // upgrading the existing row in place. The pending token was handed out
        // BEFORE the second factor — for non-root admins it arrives via a magic
        // link through email — so promoting that same value to a fully
        // privileged session hands the elevated session to anyone who saw it.
        const elevated = await this._rotateSessionOnElevation(session, admin.id, ip);
        await this.admins.markLogin(admin.id);

        this.audit.writeSafe({
            adminId: admin.id,
            adminEmail: admin.email,
            ip,
            action: 'auth:login-completed',
            resource: 'auth',
            decision: 'allow',
            details: {}
        });

        const fresh = await this.admins.findById(admin.id);
        return { stage: 'active', admin: publicAdmin(fresh), token: elevated.token };
    }

    /** Root only — rotates the password (mandatory after bootstrap). */
    async rootChangePassword(session, currentPassword, newPassword, ip = null) {
        const admin = await this.admins.findById(session.admin.id);
        if (!admin || admin.role !== 'root') {
            throw new AdminError('AUTH::ROOT-ONLY', 'Only the root admin has a password', 403);
        }
        if (!(await verifyPassword(currentPassword || '', admin.password_hash))) {
            throw new AdminError('AUTH::INVALID-CREDENTIALS', 'Current password is incorrect', 401);
        }
        if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new AdminError('AUTH::WEAK-PASSWORD', `New password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
        }
        if (newPassword === currentPassword) {
            throw new AdminError('AUTH::PASSWORD-REUSED', 'New password must differ from the current one', 400);
        }

        await this.admins.setPasswordHash(admin.id, await hashPassword(newPassword), false);
        await this.admins.activateIfComplete(admin.id);

        const fresh = await this.admins.findById(admin.id);
        await this.audit.write({
            adminId: admin.id,
            adminEmail: admin.email,
            ip,
            action: 'auth:root-password-rotated',
            resource: 'auth',
            decision: 'allow',
            details: { accountStatus: fresh.status }
        });

        return { admin: publicAdmin(fresh) };
    }

    // ── Authorization (PBAC) ──────────────────────────────────────────────────

    /**
     * Root: full governance, always allowed. Everyone else: strictly the
     * effective policy set — deny-overrides, default deny.
     */
    async authorize(admin, action, resource = 'cluster') {
        if (admin.role === 'root') {
            return { allowed: true, reason: 'root', matchedSid: null, policies: [] };
        }

        const docs = await this.policies.getEffectiveDocuments(admin.id);
        const verdict = evaluate(
            docs.map(d => d.document),
            action,
            resource
        );
        return { ...verdict, policies: docs.map(d => d.name) };
    }

    // ── Governance: admins (root only) ───────────────────────────────────────

    _assertRoot(actor) {
        if (actor?.role !== 'root') {
            throw new AdminError('GOV::ROOT-ONLY', 'Only the root admin can perform governance actions', 403);
        }
    }

    /**
     * Creates a passwordless system admin. Policy assignment at creation:
     * an explicit policy, a group membership, or (neither given) the built-in
     * read-only default. An invite magic link is emailed immediately.
     */
    async createAdmin(actor, { email, displayName = null, policyId = null, groupId = null }, ip = null) {
        this._assertRoot(actor);

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new AdminError('GOV::INVALID-EMAIL', 'A valid email address is required', 400);
        }
        if (await this.admins.findByEmail(email)) {
            throw new AdminError('GOV::EMAIL-TAKEN', 'An admin with this email already exists', 409);
        }
        if (policyId && !(await this.policies.findById(policyId))) {
            throw new AdminError('GOV::POLICY-NOT-FOUND', 'Policy not found', 404);
        }
        if (groupId && !(await this.groups.findById(groupId))) {
            throw new AdminError('GOV::GROUP-NOT-FOUND', 'Group not found', 404);
        }

        const admin = await this.admins.create({ email, displayName, role: 'admin', createdBy: actor.id });

        if (groupId) {
            await this.groups.addMember(groupId, admin.id, actor.id);
        }
        if (policyId) {
            await this.policies.attach(policyId, 'admin', admin.id, actor.id);
        }
        if (!policyId && !groupId) {
            await this.policies.attach(DEFAULT_READ_ONLY_POLICY_ID, 'admin', admin.id, actor.id);
        }

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:admin-created',
            resource: `admin:${admin.id}`,
            decision: 'allow',
            details: { email: admin.email, policyId: policyId || (groupId ? null : DEFAULT_READ_ONLY_POLICY_ID), groupId }
        });

        // Invite: the new admin's first factor is the same magic-link flow.
        await this.requestMagicLink(admin.email, ip);

        return publicAdmin(admin);
    }

    async listAdmins(actor) {
        this._assertRoot(actor);
        const rows = await this.admins.list();
        return rows.map(a => publicAdmin({ ...a, totp_enabled: a.totp_enabled }));
    }

    async setAdminStatus(actor, adminId, status, ip = null) {
        this._assertRoot(actor);
        if (!['active', 'suspended'].includes(status)) {
            throw new AdminError('GOV::INVALID-STATUS', 'Status must be "active" or "suspended"', 400);
        }

        const target = await this.admins.findById(adminId);
        if (!target) throw new AdminError('GOV::ADMIN-NOT-FOUND', 'Admin not found', 404);
        if (target.role === 'root') {
            throw new AdminError('GOV::ROOT-IMMUTABLE', 'The root admin cannot be suspended', 403);
        }

        // Un-suspending an account that never finished MFA re-enters 'pending'.
        const effective = status === 'active' && !target.totp_enabled ? 'pending' : status;
        const updated = await this.admins.setStatus(adminId, effective);
        if (status === 'suspended') {
            await this.sessions.revokeAllForAdmin(adminId);
        }

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: `governance:admin-${status === 'suspended' ? 'suspended' : 'reinstated'}`,
            resource: `admin:${adminId}`,
            decision: 'allow',
            details: { email: target.email, resultingStatus: effective }
        });

        return publicAdmin(updated);
    }

    async deleteAdmin(actor, adminId, ip = null) {
        this._assertRoot(actor);

        const target = await this.admins.findById(adminId);
        if (!target) throw new AdminError('GOV::ADMIN-NOT-FOUND', 'Admin not found', 404);
        if (target.role === 'root') {
            throw new AdminError('GOV::ROOT-IMMUTABLE', 'The root admin cannot be deleted', 403);
        }

        await this.sessions.revokeAllForAdmin(adminId);
        await this.admins.delete(adminId);

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:admin-deleted',
            resource: `admin:${adminId}`,
            decision: 'allow',
            details: { email: target.email }
        });

        return { deleted: true };
    }

    // ── Governance: policies (root only) ─────────────────────────────────────

    async createPolicy(actor, { name, description = null, document }, ip = null) {
        this._assertRoot(actor);

        if (!name || typeof name !== 'string') {
            throw new AdminError('GOV::INVALID-NAME', 'Policy name is required', 400);
        }
        const { valid, errors } = validatePolicyDocument(document);
        if (!valid) {
            throw new AdminError('GOV::INVALID-POLICY-DOCUMENT', `Policy document invalid: ${errors.join('; ')}`, 400);
        }
        if (await this.policies.findByName(name)) {
            throw new AdminError('GOV::POLICY-NAME-TAKEN', 'A policy with this name already exists', 409);
        }

        const policy = await this.policies.create({ name, description, document, createdBy: actor.id });

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:policy-created',
            resource: `policy:${policy.id}`,
            decision: 'allow',
            details: { name, document }
        });

        return policy;
    }

    async updatePolicy(actor, policyId, { name, description, document }, ip = null) {
        this._assertRoot(actor);

        if (document !== undefined) {
            const { valid, errors } = validatePolicyDocument(document);
            if (!valid) {
                throw new AdminError('GOV::INVALID-POLICY-DOCUMENT', `Policy document invalid: ${errors.join('; ')}`, 400);
            }
        }

        const updated = await this.policies.update(policyId, { name, description, document });
        if (!updated) {
            throw new AdminError('GOV::POLICY-IMMUTABLE', 'Policy not found or is a managed built-in', 404);
        }

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:policy-updated',
            resource: `policy:${policyId}`,
            decision: 'allow',
            details: { name: updated.name, document: updated.document }
        });

        return updated;
    }

    async deletePolicy(actor, policyId, ip = null) {
        this._assertRoot(actor);

        const deleted = await this.policies.delete(policyId);
        if (!deleted) {
            throw new AdminError('GOV::POLICY-IMMUTABLE', 'Policy not found or is a managed built-in', 404);
        }

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:policy-deleted',
            resource: `policy:${policyId}`,
            decision: 'allow',
            details: {}
        });

        return { deleted: true };
    }

    async attachPolicy(actor, policyId, principalType, principalId, ip = null) {
        this._assertRoot(actor);

        if (!(await this.policies.findById(policyId))) {
            throw new AdminError('GOV::POLICY-NOT-FOUND', 'Policy not found', 404);
        }
        if (principalType === 'admin' && !(await this.admins.findById(principalId))) {
            throw new AdminError('GOV::ADMIN-NOT-FOUND', 'Admin not found', 404);
        }
        if (principalType === 'group' && !(await this.groups.findById(principalId))) {
            throw new AdminError('GOV::GROUP-NOT-FOUND', 'Group not found', 404);
        }
        if (!['admin', 'group'].includes(principalType)) {
            throw new AdminError('GOV::INVALID-PRINCIPAL', 'principalType must be "admin" or "group"', 400);
        }

        await this.policies.attach(policyId, principalType, principalId, actor.id);

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:policy-attached',
            resource: `policy:${policyId}`,
            decision: 'allow',
            details: { principalType, principalId }
        });

        return { attached: true };
    }

    async detachPolicy(actor, policyId, principalType, principalId, ip = null) {
        this._assertRoot(actor);

        const detached = await this.policies.detach(policyId, principalType, principalId);

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:policy-detached',
            resource: `policy:${policyId}`,
            decision: 'allow',
            details: { principalType, principalId, existed: detached }
        });

        return { detached };
    }

    // ── Governance: groups (root only) ───────────────────────────────────────

    async createGroup(actor, { name, description = null }, ip = null) {
        this._assertRoot(actor);
        if (!name || typeof name !== 'string') {
            throw new AdminError('GOV::INVALID-NAME', 'Group name is required', 400);
        }

        const group = await this.groups.create({ name, description, createdBy: actor.id });

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:group-created',
            resource: `group:${group.id}`,
            decision: 'allow',
            details: { name }
        });

        return group;
    }

    async deleteGroup(actor, groupId, ip = null) {
        this._assertRoot(actor);

        const deleted = await this.groups.delete(groupId);
        if (!deleted) throw new AdminError('GOV::GROUP-NOT-FOUND', 'Group not found', 404);

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:group-deleted',
            resource: `group:${groupId}`,
            decision: 'allow',
            details: {}
        });

        return { deleted: true };
    }

    async addGroupMember(actor, groupId, adminId, ip = null) {
        this._assertRoot(actor);

        if (!(await this.groups.findById(groupId))) {
            throw new AdminError('GOV::GROUP-NOT-FOUND', 'Group not found', 404);
        }
        const target = await this.admins.findById(adminId);
        if (!target) throw new AdminError('GOV::ADMIN-NOT-FOUND', 'Admin not found', 404);

        await this.groups.addMember(groupId, adminId, actor.id);

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:group-member-added',
            resource: `group:${groupId}`,
            decision: 'allow',
            details: { adminId, email: target.email }
        });

        return { added: true };
    }

    async removeGroupMember(actor, groupId, adminId, ip = null) {
        this._assertRoot(actor);

        const removed = await this.groups.removeMember(groupId, adminId);

        await this.audit.write({
            adminId: actor.id,
            adminEmail: actor.email,
            ip,
            action: 'governance:group-member-removed',
            resource: `group:${groupId}`,
            decision: 'allow',
            details: { adminId, existed: removed }
        });

        return { removed };
    }
}

export { SystemAdminService, AdminError, publicAdmin, DEFAULT_READ_ONLY_POLICY_ID };
