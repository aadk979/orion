/**
 * AdminServer — the orch panel's HTTP surface: /api/* JSON endpoints plus the
 * statically-exported Next.js GUI (gui/out), served same-origin.
 *
 * Request pipeline for governed routes:
 *
 *   session (bearer or cookie) → stage gate (TOTP done?) → account gate
 *   (active? suspended?) → role gate (root-only for governance) or PBAC gate
 *   (policy evaluation for cluster actions) → handler → audit row
 *
 * Every authenticated API request lands in the immutable orch audit trail
 * (action, resource, decision, status code, admin, ip) — PBAC denials
 * included. The GUI and CLI speak the exact same API; there is no privileged
 * side door.
 */

import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, normalize, sep } from 'path';
import { logger } from 'r-sync';
import { AdminError } from './SystemAdminService.js';
import { AdminActions, commandAction, nodeResource, mailingJobResource, CLUSTER_RESOURCE, MAILING_RESOURCE, NOTIFICATIONS_RESOURCE } from './adminActions.js';
import { isKnownCommand, ClusterCommands, ConsensusTopics, isKnownTopic } from '../protocol.js';
import http from 'http';
import https from 'https';
import { thumbprintFromSocket } from './certBinding.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUI_DIR = join(__dirname, '..', '..', 'gui', 'out');

const SESSION_COOKIE = 'orch_admin_session';

// Panel themes shipped in gui/app/globals.css. Selected at process start via
// systemAdmin.http.theme or ORION_GUI_THEME — the static export carries both,
// so switching is a restart, not a rebuild.
const GUI_THEMES = new Set(['modern', 'classic']);
const DEFAULT_GUI_THEME = 'modern';

/** config value wins over env; an unrecognised name falls back with a warning. */
const resolveGuiTheme = configured => {
    const raw = String(configured ?? process.env.ORION_GUI_THEME ?? '')
        .trim()
        .toLowerCase();
    if (!raw) return DEFAULT_GUI_THEME;
    if (GUI_THEMES.has(raw)) return raw;
    logger.warn(`AdminServer: unknown GUI theme '${raw}' — falling back to '${DEFAULT_GUI_THEME}'. Valid: ${[...GUI_THEMES].join(', ')}`);
    return DEFAULT_GUI_THEME;
};

// Endpoints a pending_totp session may reach — nothing else until MFA passes.
const PENDING_STAGE_ALLOWED = new Set([
    'POST /api/auth/totp/setup',
    'POST /api/auth/totp/activate',
    'POST /api/auth/totp/verify',
    'GET /api/auth/session',
    'POST /api/auth/logout'
]);

// Endpoints a fully-authenticated but still-'pending' ACCOUNT may reach
// (root that enrolled TOTP but has not rotated the bootstrap password yet).
const PENDING_ACCOUNT_ALLOWED = new Set([...PENDING_STAGE_ALLOWED, 'POST /api/auth/root/change-password']);

const parseCookies = header => {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
};

/** Tiny fixed-window limiter for the auth endpoints — no external deps. */
class RateLimiter {
    constructor(max, windowMs) {
        this.max = max;
        this.windowMs = windowMs;
        this.hits = new Map();
    }

    allow(key) {
        const now = Date.now();
        const entry = this.hits.get(key);
        if (!entry || now - entry.start > this.windowMs) {
            this.hits.set(key, { start: now, count: 1 });
            if (this.hits.size > 10_000) this._sweep(now);
            return true;
        }
        entry.count += 1;
        return entry.count <= this.max;
    }

    _sweep(now) {
        for (const [key, entry] of this.hits) {
            if (now - entry.start > this.windowMs) this.hits.delete(key);
        }
    }
}

class AdminServer {
    /**
     * @param {import('../OrionOrchestrator.js').OrionOrchestrator} orch
     * @param {import('./SystemAdminService.js').SystemAdminService} service
     */
    constructor(orch, service, config = {}) {
        this.orch = orch;
        this.service = service;
        this.config = {
            host: '0.0.0.0',
            port: 55330,
            trustProxy: false,
            secureCookies: true,
            authRateLimit: { max: 10, windowMs: 5 * 60 * 1000 },
            ...config
        };

        this.app = null;
        this.httpServer = null;
        this._authLimiter = new RateLimiter(this.config.authRateLimit.max, this.config.authRateLimit.windowMs);
        this.guiTheme = resolveGuiTheme(this.config.theme);
        this._htmlCache = new Map();
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async start() {
        this.app = express();
        this.app.disable('x-powered-by');
        if (this.config.trustProxy) this.app.set('trust proxy', this.config.trustProxy);

        this.app.use(express.json({ limit: '100kb' }));

        this._mountAuthRoutes();
        this._mountClusterRoutes();
        this._mountMailingRoutes();
        this._mountNotificationRoutes();
        this._mountGovernanceRoutes();
        this._mountAuditRoutes();
        this._mountGui();
        this._mountErrorHandler();

        await new Promise((resolve, reject) => {
            this.httpServer = this._createTransport();
            this.httpServer.listen(this.config.port, this.config.host, resolve);
            this.httpServer.once('error', reject);
        });

        logger.info(
            `AdminServer: orch panel + API listening on ${this.config.host}:${this.config.port}${
                existsSync(GUI_DIR) ? ` (theme: ${this.guiTheme})` : ' (GUI build not found — API only)'
            }`
        );
    }

    async stop() {
        if (this.httpServer) {
            await new Promise(resolve => this.httpServer.close(resolve));
            this.httpServer = null;
        }
    }

    // ── Shared helpers ────────────────────────────────────────────────────────

    /**
     * Builds the listening server.
     *
     * With `mtls` configured this is an HTTPS server that REQUESTS a client
     * certificate. `rejectUnauthorized` follows the configured CA: with one, the
     * TLS layer refuses anything it does not chain to; without one, self-signed
     * client certificates are accepted at the TLS layer and the RFC 8705
     * thumbprint match is what actually authenticates them — which is the point
     * of x5t#S256 covering the whole certificate rather than just its subject.
     *
     * Without `mtls` this stays plain HTTP, unchanged, so an existing deployment
     * is not broken by upgrading.
     */
    _createTransport() {
        const mtls = this.config.mtls;

        if (!mtls?.enabled) {
            return http.createServer(this.app);
        }

        if (!mtls.key || !mtls.cert) {
            throw new Error('AdminServer: systemAdmin.http.mtls.enabled requires mtls.key and mtls.cert (PEM paths or contents)');
        }

        const read = value => (typeof value === 'string' && value.includes('-----BEGIN') ? value : readFileSync(value));

        const options = {
            key: read(mtls.key),
            cert: read(mtls.cert),
            requestCert: true,
            rejectUnauthorized: Boolean(mtls.ca)
        };

        if (mtls.ca) options.ca = read(mtls.ca);

        logger.info(`AdminServer: mTLS enabled — admin sessions are bound to client certificates (RFC 8705)${mtls.ca ? ' with CA verification' : ' (self-signed clients permitted; binding enforced by thumbprint)'}`);

        return https.createServer(options, this.app);
    }

    /** True when this deployment binds admin sessions to client certificates. */
    _certBindingRequired() {
        return this.config.mtls?.enabled === true;
    }

    /** RFC 8705 x5t#S256 for the certificate on this request's connection. */
    _certThumbprint(req) {
        return thumbprintFromSocket(req.socket);
    }

    _ip(req) {
        return req.ip || req.socket?.remoteAddress || null;
    }

    _sessionToken(req) {
        const auth = req.headers.authorization;
        if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
        return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
    }

    _setSessionCookie(res, token, maxAgeSeconds) {
        const attrs = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'HttpOnly', 'Path=/', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
        if (this.config.secureCookies) attrs.push('Secure');
        res.append('Set-Cookie', attrs.join('; '));
    }

    _clearSessionCookie(res) {
        res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${this.config.secureCookies ? '; Secure' : ''}`);
    }

    /** Wraps async handlers so rejections reach the error handler. */
    _h(fn) {
        return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    }

    _rateLimitAuth() {
        return (req, res, next) => {
            if (!this._authLimiter.allow(this._ip(req) || 'unknown')) {
                return res.status(429).json({ error: true, code: 'AUTH::RATE-LIMITED', message: 'Too many attempts — try again later' });
            }
            next();
        };
    }

    /** Resolves the session; 401 without one. Stage/account gating included. */
    _requireSession() {
        return this._h(async (req, res, next) => {
            const session = await this.service.resolveSession(this._sessionToken(req), {
                required: this._certBindingRequired(),
                presentedThumbprint: this._certThumbprint(req)
            });
            if (!session) {
                return res.status(401).json({ error: true, code: 'AUTH::NO-SESSION', message: 'Authentication required' });
            }

            const admin = session.admin;
            if (admin.status === 'suspended') {
                return res.status(403).json({ error: true, code: 'AUTH::SUSPENDED', message: 'This account is suspended' });
            }

            const routeKey = `${req.method} ${req.baseUrl}${req.route?.path === '/' ? '' : req.route?.path || req.path}`;

            if (session.stage !== 'active' && !PENDING_STAGE_ALLOWED.has(routeKey)) {
                return res.status(403).json({ error: true, code: 'AUTH::TOTP-REQUIRED', message: 'Complete TOTP verification first' });
            }
            if (admin.status === 'pending' && !PENDING_ACCOUNT_ALLOWED.has(routeKey)) {
                return res.status(403).json({ error: true, code: 'AUTH::ACCOUNT-PENDING', message: 'Finish account activation first' });
            }

            req.adminSession = session;
            next();
        });
    }

    _requireRoot() {
        return (req, res, next) => {
            if (req.adminSession?.admin?.role !== 'root') {
                this._audit(req, 'governance:refused', 'governance', 'deny', 403, { reason: 'not-root' });
                return res.status(403).json({ error: true, code: 'GOV::ROOT-ONLY', message: 'Only the root admin can perform governance actions' });
            }
            next();
        };
    }

    /**
     * PBAC gate. `actionFn`/`resourceFn` derive the action/resource from the
     * request (static strings accepted). Denials are audited with the policy
     * verdict; allowed requests are audited on response finish with the final
     * status code.
     */
    _gate(actionOrFn, resourceOrFn = CLUSTER_RESOURCE) {
        return this._h(async (req, res, next) => {
            const action = typeof actionOrFn === 'function' ? actionOrFn(req) : actionOrFn;
            const resource = typeof resourceOrFn === 'function' ? resourceOrFn(req) : resourceOrFn;
            const admin = req.adminSession.admin;

            const verdict = await this.service.authorize(admin, action, resource);
            if (!verdict.allowed) {
                this._audit(req, action, resource, 'deny', 403, { reason: verdict.reason, matchedSid: verdict.matchedSid });
                return res.status(403).json({
                    error: true,
                    code: 'PBAC::DENIED',
                    message: `Policy denies "${action}" on "${resource}" (${verdict.reason})`
                });
            }

            res.once('finish', () => {
                this._audit(req, action, resource, res.statusCode < 500 ? 'allow' : 'error', res.statusCode, {
                    matchedSid: verdict.matchedSid,
                    via: verdict.reason
                });
            });
            next();
        });
    }

    _audit(req, action, resource, decision, statusCode, details = {}) {
        const admin = req.adminSession?.admin;
        this.service.audit.writeSafe({
            adminId: admin?.id || null,
            adminEmail: admin?.email || null,
            ip: this._ip(req),
            method: req.method,
            path: req.originalUrl,
            action,
            resource,
            decision,
            statusCode,
            details
        });
    }

    _actor(req) {
        const admin = req.adminSession.admin;
        return { type: 'admin', id: admin.id, email: admin.email, role: admin.role };
    }

    // ── Auth routes ───────────────────────────────────────────────────────────

    _mountAuthRoutes() {
        const router = express.Router();
        const limited = this._rateLimitAuth();

        router.post(
            '/magic-link',
            limited,
            this._h(async (req, res) => {
                await this.service.requestMagicLink(req.body?.email, this._ip(req));
                // Identical response whether or not the email exists.
                res.json({ error: false, requested: true });
            })
        );

        router.post(
            '/magic-link/verify',
            limited,
            this._h(async (req, res) => {
                const result = await this.service.verifyMagicLink(req.body?.code, this._ip(req), req.headers['user-agent'], this._certThumbprint(req));
                this._setSessionCookie(res, result.token, this.service.config.pendingSessionTtlMinutes * 60);
                res.json({ error: false, ...result });
            })
        );

        router.post(
            '/root/login',
            limited,
            this._h(async (req, res) => {
                const result = await this.service.rootLogin(req.body?.email, req.body?.password, this._ip(req), req.headers['user-agent'], this._certThumbprint(req));
                this._setSessionCookie(res, result.token, this.service.config.pendingSessionTtlMinutes * 60);
                res.json({ error: false, ...result });
            })
        );

        router.post(
            '/totp/setup',
            this._requireSession(),
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this.service.totpSetupStart(req.adminSession)) });
            })
        );

        router.post(
            '/totp/activate',
            limited,
            this._requireSession(),
            this._h(async (req, res) => {
                const result = await this.service.totpActivate(req.adminSession, req.body?.token, this._ip(req), this._certThumbprint(req));
                // Elevation issues a fresh credential — the pending one is revoked.
                this._setSessionCookie(res, result.token, this.service.config.sessionTtlHours * 3600);
                res.json({ error: false, ...result });
            })
        );

        router.post(
            '/totp/verify',
            limited,
            this._requireSession(),
            this._h(async (req, res) => {
                const result = await this.service.totpVerify(req.adminSession, req.body?.token, this._ip(req), this._certThumbprint(req));
                // Elevation issues a fresh credential — the pending one is revoked.
                this._setSessionCookie(res, result.token, this.service.config.sessionTtlHours * 3600);
                res.json({ error: false, ...result });
            })
        );

        router.post(
            '/root/change-password',
            limited,
            this._requireSession(),
            this._h(async (req, res) => {
                const result = await this.service.rootChangePassword(req.adminSession, req.body?.currentPassword, req.body?.newPassword, this._ip(req));
                res.json({ error: false, ...result });
            })
        );

        router.get('/session', this._requireSession(), (req, res) => {
            const { admin, stage, expiresAt } = req.adminSession;
            res.json({
                error: false,
                stage,
                expiresAt,
                admin: {
                    id: admin.id,
                    email: admin.email,
                    displayName: admin.display_name,
                    role: admin.role,
                    status: admin.status,
                    totpEnrolled: admin.totp_enabled === true,
                    passwordChangeRequired: admin.password_change_required === true
                }
            });
        });

        router.post(
            '/logout',
            this._requireSession(),
            this._h(async (req, res) => {
                await this.service.logout(req.adminSession.sessionId, req.adminSession.admin, this._ip(req));
                this._clearSessionCookie(res);
                res.json({ error: false, loggedOut: true });
            })
        );

        this.app.use('/api/auth', router);
    }

    // ── Cluster routes (PBAC-governed) ────────────────────────────────────────

    _mountClusterRoutes() {
        const router = express.Router();
        router.use(this._requireSession());

        // Reads
        router.get(
            '/status',
            this._gate(AdminActions.READ_STATUS),
            this._h(async (req, res) => {
                res.json({ error: false, status: await this.orch.getClusterStatus() });
            })
        );

        router.get('/nodes', this._gate(AdminActions.READ_NODES), (req, res) => {
            res.json({ error: false, nodes: this.orch.getNodes() });
        });

        router.get(
            '/nodes/:workerId',
            this._gate(AdminActions.READ_NODES, req => nodeResource(req.params.workerId)),
            (req, res) => {
                const node = this.orch.getNode(req.params.workerId);
                if (!node) return res.status(404).json({ error: true, code: 'CLUSTER::NODE-NOT-FOUND', message: 'Node not found' });
                res.json({ error: false, node });
            }
        );

        router.get('/health', this._gate(AdminActions.READ_HEALTH), (req, res) => {
            res.json({ error: false, health: this.orch.getClusterHealth() });
        });

        router.get('/escalations', this._gate(AdminActions.READ_ESCALATIONS), (req, res) => {
            res.json({ error: false, escalations: this.orch.getEscalations(Number(req.query.limit) || 50) });
        });

        router.get('/consensus-history', this._gate(AdminActions.READ_CONSENSUS), (req, res) => {
            res.json({ error: false, history: this.orch.getConsensusHistory(Number(req.query.limit) || 10) });
        });

        router.get('/policy-rules', this._gate(AdminActions.READ_POLICY_RULES), (req, res) => {
            res.json({ error: false, rules: this.orch.getPolicyRules() });
        });

        router.get('/policy-outcomes', this._gate(AdminActions.READ_POLICY_OUTCOMES), (req, res) => {
            res.json({ error: false, outcomes: this.orch.getPolicyOutcomes(Number(req.query.limit) || 20) });
        });

        router.get('/command-log', this._gate(AdminActions.READ_COMMAND_LOG), (req, res) => {
            res.json({ error: false, commandLog: this.orch.getCommandLog(Number(req.query.limit) || 50) });
        });

        router.get('/commands', this._gate(AdminActions.READ_NODES), (req, res) => {
            res.json({ error: false, commands: Object.values(ClusterCommands), consensusTopics: Object.values(ConsensusTopics) });
        });

        // Node command execution — PBAC action carries the node action itself,
        // so policies can grant e.g. status reads but never lockdown clears.
        router.post(
            '/nodes/:workerId/command',
            this._gate(
                req => commandAction(String(req.body?.action || 'unknown')),
                req => nodeResource(req.params.workerId)
            ),
            this._h(async (req, res) => {
                const { action, args, timeoutMs } = req.body || {};
                if (!isKnownCommand(action)) {
                    return res
                        .status(400)
                        .json({ error: true, code: 'CLUSTER::UNKNOWN-COMMAND', message: `"${action}" is not an allowlisted cluster command` });
                }
                const outcome = await this.orch.command(
                    req.params.workerId,
                    action,
                    args || {},
                    Math.min(Number(timeoutMs) || this.orch.config.commandTimeoutMs, 60_000),
                    this._actor(req)
                );
                res.json({ error: false, outcome });
            })
        );

        router.post(
            '/command-all',
            this._gate(req => commandAction(String(req.body?.action || 'unknown')), CLUSTER_RESOURCE),
            this._h(async (req, res) => {
                const { action, args, timeoutMs } = req.body || {};
                if (!isKnownCommand(action)) {
                    return res
                        .status(400)
                        .json({ error: true, code: 'CLUSTER::UNKNOWN-COMMAND', message: `"${action}" is not an allowlisted cluster command` });
                }
                const results = await this.orch.commandAll(
                    action,
                    args || {},
                    Math.min(Number(timeoutMs) || this.orch.config.commandTimeoutMs, 60_000),
                    this._actor(req)
                );
                res.json({ error: false, results });
            })
        );

        // Cluster operations
        router.post(
            '/lock',
            this._gate(AdminActions.OPS_LOCK_CLUSTER),
            this._h(async (req, res) => {
                res.json({ error: false, results: await this.orch.lockCluster(this._actor(req)) });
            })
        );

        router.post(
            '/unlock',
            this._gate(AdminActions.OPS_UNLOCK_CLUSTER),
            this._h(async (req, res) => {
                res.json({ error: false, results: await this.orch.unlockCluster(this._actor(req)) });
            })
        );

        router.post(
            '/incident/declare',
            this._gate(AdminActions.OPS_DECLARE_INCIDENT),
            this._h(async (req, res) => {
                const reason = String(req.body?.reason || `declared by ${req.adminSession.admin.email}`);
                res.json({ error: false, health: await this.orch.declareIncident(reason) });
            })
        );

        router.post(
            '/incident/resolve',
            this._gate(AdminActions.OPS_RESOLVE_INCIDENT),
            this._h(async (req, res) => {
                const reason = String(req.body?.reason || `resolved by ${req.adminSession.admin.email}`);
                res.json({ error: false, health: await this.orch.resolveIncident(reason) });
            })
        );

        router.post(
            '/consensus',
            this._gate(AdminActions.OPS_PROPOSE_CONSENSUS),
            this._h(async (req, res) => {
                const { topic, params } = req.body || {};
                if (!isKnownTopic(topic)) {
                    return res.status(400).json({ error: true, code: 'CLUSTER::UNKNOWN-TOPIC', message: `"${topic}" is not a known consensus topic` });
                }
                res.json({ error: false, vote: await this.orch.proposeConsensus(topic, params || {}) });
            })
        );

        router.post(
            '/client-urls',
            this._gate(AdminActions.OPS_ADD_CLIENT_URLS),
            this._h(async (req, res) => {
                const { clientUrls } = req.body || {};
                if (!Array.isArray(clientUrls) || clientUrls.length === 0) {
                    return res.status(400).json({ error: true, code: 'CLUSTER::INVALID-CLIENT-URLS', message: 'clientUrls must be a non-empty array' });
                }
                res.json({ error: false, results: await this.orch.addClientUrls(clientUrls, this._actor(req)) });
            })
        );

        // ── Signing-key revocation plane ──────────────────────────────────────
        // PBAC actions reuse the cluster:command:<node action> vocabulary so a
        // policy can grant the key inventory read without granting revocation.

        // Active (non-expired) signing/verification kids of every node
        router.get(
            '/secrets/keys',
            this._gate(commandAction(ClusterCommands.SECRETS_LIST_KIDS)),
            this._h(async (req, res) => {
                res.json({ error: false, nodes: await this.orch.listClusterSigningKeys(this._actor(req)) });
            })
        );

        // Broadcast revocation of specific kids — the owning node rotates,
        // everyone else wipes their verification pools + Redis.
        router.post(
            '/secrets/revoke',
            this._gate(commandAction(ClusterCommands.SECRETS_REVOKE_KIDS)),
            this._h(async (req, res) => {
                const { kids } = req.body || {};
                if (!Array.isArray(kids) || kids.length === 0 || !kids.every(k => typeof k === 'string' && k.trim())) {
                    return res.status(400).json({ error: true, code: 'CLUSTER::INVALID-KIDS', message: 'kids must be a non-empty array of kid strings' });
                }
                res.json({ error: false, results: await this.orch.revokeSigningKids(kids, this._actor(req)) });
            })
        );

        // Decommission ALL of one node's signing keys (fleet-wide broadcast)
        router.post(
            '/secrets/rotate-node',
            this._gate(
                commandAction(ClusterCommands.SECRETS_FORCE_ROTATE),
                req => nodeResource(String(req.body?.workerId || 'unknown'))
            ),
            this._h(async (req, res) => {
                const workerId = String(req.body?.workerId || '').trim();
                if (!workerId) {
                    return res.status(400).json({ error: true, code: 'CLUSTER::INVALID-WORKER', message: 'workerId is required' });
                }
                res.json({ error: false, outcome: await this.orch.forceRotateNodeKeys(workerId, this._actor(req)) });
            })
        );

        // ── Field encryption (key vault) plane ────────────────────────────────
        // Four graded capabilities. The read is as safe as any status read; KEK
        // rotation is routine; DEK rotation rewrites every encrypted row; the
        // wipe destroys user enrollments. They are separate PBAC actions so a
        // policy can grant the safe ones without implying the destructive one.

        router.get(
            '/keyvault/status',
            this._gate(AdminActions.KEYVAULT_READ_STATUS),
            this._h(async (req, res) => {
                res.json({ error: false, nodes: await this.orch.getClusterKeyVaultStatus(this._actor(req)) });
            })
        );

        router.post(
            '/keyvault/rotate-kek',
            this._gate(AdminActions.KEYVAULT_ROTATE_KEK),
            this._h(async (req, res) => {
                const workerId = req.body?.workerId ? String(req.body.workerId) : null;
                res.json({ error: false, result: await this.orch.rotateEncryptionKek(workerId, this._actor(req)) });
            })
        );

        router.post(
            '/keyvault/rotate-dek',
            this._gate(AdminActions.KEYVAULT_ROTATE_DEK),
            this._h(async (req, res) => {
                const { workerId, batchSize, reencrypt } = req.body || {};

                res.json({
                    error: false,
                    result: await this.orch.rotateEncryptionDek(
                        {
                            workerId: workerId ? String(workerId) : null,
                            batchSize: Number(batchSize) > 0 ? Number(batchSize) : null,
                            reencrypt: reencrypt !== false
                        },
                        this._actor(req)
                    )
                });
            })
        );

        // Read-only preview of the consensus that gates the wipe, so an operator
        // can see whether the fleet actually agrees the data is unrecoverable
        // BEFORE reaching for the destructive endpoint.
        router.post(
            '/keyvault/confirm-unrecoverable',
            this._gate(AdminActions.KEYVAULT_READ_STATUS),
            this._h(async (req, res) => {
                res.json({ error: false, consensus: await this.orch.confirmEncryptionUnrecoverable(this._actor(req)) });
            })
        );

        // DESTRUCTIVE. Root-only ON TOP of the PBAC action: a policy grant alone
        // must never be enough to destroy every user's second factor.
        router.post(
            '/keyvault/wipe',
            this._requireRoot(),
            this._gate(AdminActions.KEYVAULT_WIPE),
            this._h(async (req, res) => {
                const { confirmation, fields, reason, overrideConsensus, includeAdmins, includeRootAdmin } = req.body || {};

                if (!reason || String(reason).trim().length < 10) {
                    return res.status(400).json({
                        error: true,
                        code: 'KEYVAULT::REASON-REQUIRED',
                        message: 'A reason of at least 10 characters is required — this action is irreversible and is recorded in the audit trail'
                    });
                }

                try {
                    const result = await this.orch.wipeEncryptedFields(
                        {
                            confirmation,
                            fields: Array.isArray(fields) ? fields.map(String) : null,
                            reason: String(reason).trim(),
                            overrideConsensus: overrideConsensus === true
                        },
                        this._actor(req)
                    );

                    // Opt-in second half of the reset: the orchestrator's own
                    // administrators. Their secrets are not sealed by the core
                    // key vault, so this is a governance choice rather than a
                    // recovery necessity — hence explicit rather than implied.
                    const admins = includeAdmins
                        ? await this.service.wipeAdminTotpEnrollments(
                              req.adminSession.admin,
                              { includeRoot: includeRootAdmin === true, reason: String(reason).trim() },
                              this._ip(req)
                          )
                        : null;

                    await this.service.audit.write({
                        adminId: req.adminSession.admin.id,
                        adminEmail: req.adminSession.admin.email,
                        ip: req.ip,
                        action: 'keyvault:encrypted-fields-wiped',
                        resource: CLUSTER_RESOURCE,
                        decision: 'allow',
                        details: {
                            reason: String(reason).trim(),
                            fields: Array.isArray(fields) ? fields : 'all',
                            consensusOverridden: result.consensusOverridden === true,
                            consensus: result.consensus,
                            workerId: result.workerId,
                            adminsWiped: admins?.wiped ?? 0,
                            rootAdminIncluded: includeRootAdmin === true
                        }
                    });

                    res.json({ error: false, result: { ...result, admins } });
                } catch (error) {
                    if (error.code === 'KEYVAULT::CONSENSUS-REFUSED') {
                        return res.status(409).json({ error: true, code: error.code, message: error.message, consensus: error.consensus });
                    }
                    throw error;
                }
            })
        );

        this.app.use('/api/cluster', router);
    }

    // ── Batch mailing routes (PBAC-governed) ──────────────────────────────────

    /**
     * The mailing plane is optional, so every route here first checks that it
     * is actually running. A 503 naming the config key is far more useful than
     * a 404 that looks like a typo in the URL.
     */
    _mailing() {
        const service = this.orch.getMailingService?.();
        if (!service) {
            throw new AdminError('MAILING::DISABLED', 'The batch mailing plane is not enabled on this orchestrator (mailing.enabled)', 503);
        }
        return service;
    }

    _mountMailingRoutes() {
        const router = express.Router();
        router.use(this._requireSession());

        // Sheet upload. The bytes arrive as a raw body rather than multipart:
        // there is exactly one file and no other fields, so a parser dependency
        // would buy nothing. The 50MB ceiling is well clear of a large sheet
        // (a 250k-row xlsx is a few MB) while still bounding what one request
        // can make the orchestrator hold in memory.
        router.post(
            '/jobs',
            express.raw({
                type: [
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.ms-excel',
                    'text/csv',
                    'application/octet-stream'
                ],
                limit: '50mb'
            }),
            this._gate(AdminActions.MAILING_SUBMIT, MAILING_RESOURCE),
            this._h(async (req, res) => {
                const service = this._mailing();

                if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                    return res.status(400).json({
                        error: true,
                        code: 'MAILING::NO-FILE',
                        message: 'Send the .xlsx or .csv file as the raw request body with its content-type set'
                    });
                }

                const filename = String(req.query.filename || req.headers['x-filename'] || '').slice(0, 255);
                const { parseMailingSheet, SheetParseError } = await import('../Mailing/SheetParser.js');

                let parsed;
                try {
                    parsed = await parseMailingSheet(req.body, { filename });
                } catch (err) {
                    if (err instanceof SheetParseError || err.code === 'MAILING::SHEET-INVALID') {
                        // Every problem at once: an operator fixing a sheet one
                        // error per upload is an operator uploading ten times.
                        return res.status(400).json({ error: true, code: err.code, message: err.message, details: err.details || [] });
                    }
                    return res.status(400).json({ error: true, code: 'MAILING::UNREADABLE', message: `The file could not be read as a spreadsheet: ${err.message}` });
                }

                const { job, plan } = await service.submitJob(parsed, this._actor(req));

                // The submission itself is audited beyond the route-level row:
                // this is the record of who authorised mail going out under the
                // organisation's name, and to how many people.
                await this.service.audit.write({
                    adminId: req.adminSession.admin.id,
                    adminEmail: req.adminSession.admin.email,
                    ip: this._ip(req),
                    action: 'mailing:job-submitted',
                    resource: mailingJobResource(job.id),
                    decision: 'allow',
                    details: {
                        jobId: job.id,
                        jobName: job.name,
                        priority: job.priority,
                        recipients: plan.totalRecipients,
                        groups: plan.groupCount,
                        groupSize: plan.groupSize,
                        sourceFilename: parsed.filename,
                        generatedJobId: parsed.generatedJobId,
                        extraColumns: parsed.extraColumns
                    }
                });

                res.status(201).json({ error: false, job, plan, extraColumns: parsed.extraColumns, generatedJobId: parsed.generatedJobId });
            })
        );

        router.get(
            '/jobs',
            this._gate(AdminActions.MAILING_READ_JOBS, MAILING_RESOURCE),
            this._h(async (req, res) => {
                const jobs = await this._mailing().listJobs({ status: req.query.status || null, limit: req.query.limit, offset: req.query.offset });
                res.json({ error: false, jobs });
            })
        );

        router.get(
            '/queue',
            this._gate(AdminActions.MAILING_READ_QUEUE, MAILING_RESOURCE),
            this._h(async (req, res) => {
                res.json({ error: false, queue: await this._mailing().getQueueState() });
            })
        );

        router.get(
            '/jobs/:jobId',
            this._gate(AdminActions.MAILING_READ_JOBS, req => mailingJobResource(req.params.jobId)),
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this._mailing().getJobDetail(req.params.jobId)) });
            })
        );

        router.get(
            '/jobs/:jobId/dead-letters',
            this._gate(AdminActions.MAILING_READ_JOBS, req => mailingJobResource(req.params.jobId)),
            this._h(async (req, res) => {
                const deadLetters = await this._mailing().listDeadLetters(req.params.jobId, { limit: req.query.limit, offset: req.query.offset });
                res.json({ error: false, deadLetters });
            })
        );

        router.get(
            '/jobs/:jobId/archive',
            this._gate(AdminActions.MAILING_READ_JOBS, req => mailingJobResource(req.params.jobId)),
            this._h(async (req, res) => {
                const archive = await this._mailing().archive.list(req.params.jobId, {
                    outcome: req.query.outcome || null,
                    limit: req.query.limit,
                    offset: req.query.offset
                });
                res.json({ error: false, archive });
            })
        );

        router.post(
            '/jobs/:jobId/cancel',
            this._gate(AdminActions.MAILING_CANCEL, req => mailingJobResource(req.params.jobId)),
            this._h(async (req, res) => {
                const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : null;
                const result = await this._mailing().cancelJob(req.params.jobId, this._actor(req), reason);

                await this.service.audit.write({
                    adminId: req.adminSession.admin.id,
                    adminEmail: req.adminSession.admin.email,
                    ip: this._ip(req),
                    action: 'mailing:job-cancelled',
                    resource: mailingJobResource(req.params.jobId),
                    decision: 'allow',
                    details: { ...result, reason }
                });

                res.json({ error: false, ...result });
            })
        );

        this.app.use('/api/mailing', router);
    }

    // ── Notification routes ───────────────────────────────────────────────────

    _mountNotificationRoutes() {
        const router = express.Router();
        router.use(this._requireSession());

        router.get(
            '/',
            this._gate(AdminActions.NOTIFICATIONS_READ, NOTIFICATIONS_RESOURCE),
            this._h(async (req, res) => {
                const adminId = req.adminSession.admin.id;
                const notifications = this._mailing().notifications;

                const [items, unread] = await Promise.all([
                    notifications.listFor(adminId, { limit: req.query.limit, offset: req.query.offset, unreadOnly: req.query.unread === 'true' }),
                    notifications.unreadCount(adminId)
                ]);

                res.json({ error: false, notifications: items, unread });
            })
        );

        router.post(
            '/:id/read',
            this._gate(AdminActions.NOTIFICATIONS_READ, NOTIFICATIONS_RESOURCE),
            this._h(async (req, res) => {
                await this._mailing().notifications.markRead(req.params.id, req.adminSession.admin.id);
                res.json({ error: false, read: true });
            })
        );

        router.post(
            '/read-all',
            this._gate(AdminActions.NOTIFICATIONS_READ, NOTIFICATIONS_RESOURCE),
            this._h(async (req, res) => {
                const marked = await this._mailing().notifications.markAllRead(req.adminSession.admin.id);
                res.json({ error: false, marked });
            })
        );

        this.app.use('/api/notifications', router);
    }

    // ── Governance routes (root only) ─────────────────────────────────────────

    _mountGovernanceRoutes() {
        // Root-only guards are mounted per prefix — a router-level guard on
        // /api would also swallow /api/meta and unmatched /api/* paths.
        const guard = [this._requireSession(), this._requireRoot()];

        const admins = express.Router();

        admins.get(
            '/',
            this._h(async (req, res) => {
                res.json({ error: false, admins: await this.service.listAdmins(this._actor(req)) });
            })
        );

        admins.post(
            '/',
            this._h(async (req, res) => {
                const admin = await this.service.createAdmin(this._actor(req), req.body || {}, this._ip(req));
                res.status(201).json({ error: false, admin });
            })
        );

        admins.post(
            '/:id/status',
            this._h(async (req, res) => {
                res.json({ error: false, admin: await this.service.setAdminStatus(this._actor(req), req.params.id, req.body?.status, this._ip(req)) });
            })
        );

        admins.delete(
            '/:id',
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this.service.deleteAdmin(this._actor(req), req.params.id, this._ip(req))) });
            })
        );

        const policies = express.Router();

        policies.get(
            '/',
            this._h(async (req, res) => {
                res.json({ error: false, policies: await this.service.policies.list() });
            })
        );

        policies.get(
            '/:id/attachments',
            this._h(async (req, res) => {
                res.json({ error: false, attachments: await this.service.policies.listAttachments(req.params.id) });
            })
        );

        policies.post(
            '/',
            this._h(async (req, res) => {
                res.status(201).json({ error: false, policy: await this.service.createPolicy(this._actor(req), req.body || {}, this._ip(req)) });
            })
        );

        policies.patch(
            '/:id',
            this._h(async (req, res) => {
                res.json({ error: false, policy: await this.service.updatePolicy(this._actor(req), req.params.id, req.body || {}, this._ip(req)) });
            })
        );

        policies.delete(
            '/:id',
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this.service.deletePolicy(this._actor(req), req.params.id, this._ip(req))) });
            })
        );

        policies.post(
            '/:id/attach',
            this._h(async (req, res) => {
                res.json({
                    error: false,
                    ...(await this.service.attachPolicy(this._actor(req), req.params.id, req.body?.principalType, req.body?.principalId, this._ip(req)))
                });
            })
        );

        policies.post(
            '/:id/detach',
            this._h(async (req, res) => {
                res.json({
                    error: false,
                    ...(await this.service.detachPolicy(this._actor(req), req.params.id, req.body?.principalType, req.body?.principalId, this._ip(req)))
                });
            })
        );

        const groups = express.Router();

        groups.get(
            '/',
            this._h(async (req, res) => {
                res.json({ error: false, groups: await this.service.groups.list() });
            })
        );

        groups.post(
            '/',
            this._h(async (req, res) => {
                res.status(201).json({ error: false, group: await this.service.createGroup(this._actor(req), req.body || {}, this._ip(req)) });
            })
        );

        groups.delete(
            '/:id',
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this.service.deleteGroup(this._actor(req), req.params.id, this._ip(req))) });
            })
        );

        groups.get(
            '/:id/members',
            this._h(async (req, res) => {
                res.json({ error: false, members: await this.service.groups.listMembers(req.params.id) });
            })
        );

        groups.post(
            '/:id/members',
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this.service.addGroupMember(this._actor(req), req.params.id, req.body?.adminId, this._ip(req))) });
            })
        );

        groups.delete(
            '/:id/members/:adminId',
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this.service.removeGroupMember(this._actor(req), req.params.id, req.params.adminId, this._ip(req))) });
            })
        );

        // The service writes fine-grained governance:* audit rows with the
        // mutation details for every one of these endpoints.
        this.app.use('/api/admins', guard, admins);
        this.app.use('/api/policies', guard, policies);
        this.app.use('/api/groups', guard, groups);
    }

    // ── Audit routes ──────────────────────────────────────────────────────────

    _mountAuditRoutes() {
        const router = express.Router();
        router.use(this._requireSession());

        router.get(
            '/',
            this._gate(AdminActions.READ_AUDIT, 'audit'),
            this._h(async (req, res) => {
                const rows = await this.service.audit.list({
                    limit: req.query.limit,
                    offset: req.query.offset,
                    adminId: req.query.adminId || null,
                    action: req.query.action || null,
                    since: req.query.since || null
                });
                res.json({ error: false, audit: rows });
            })
        );

        router.get(
            '/verify',
            this._requireRoot(),
            this._h(async (req, res) => {
                res.json({ error: false, ...(await this.service.audit.verifyChain()) });
            })
        );

        this.app.use('/api/audit', router);
    }

    // ── GUI + meta + errors ───────────────────────────────────────────────────

    _mountGui() {
        this.app.get('/api/meta', (req, res) => {
            res.json({
                error: false,
                name: 'orion-orch',
                cluster: this.orch.cluster,
                panel: true,
                guiAvailable: existsSync(GUI_DIR),
                guiTheme: this.guiTheme,
                // Lets the panel hide the Mailing nav entirely rather than
                // offering a page that can only ever return 503.
                mailingAvailable: !!this.orch.getMailingService?.()
            });
        });

        if (existsSync(GUI_DIR)) {
            // Themed-HTML interceptor sits ahead of express.static so every
            // document leaves with the operator's data-theme stamped on <html>.
            this.app.use((req, res, next) => {
                if (req.method !== 'GET' && req.method !== 'HEAD') return next();
                if (req.path.startsWith('/api/')) return next();
                const file = this._resolveHtml(req.path);
                if (!file) return next();
                res.type('html').send(this._themedHtml(file));
            });

            this.app.use(express.static(GUI_DIR, { extensions: ['html'] }));

            // SPA-ish fallback: unknown non-API paths get the panel shell so a
            // hard refresh on a client-side route still resolves.
            this.app.use((req, res, next) => {
                if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
                res.type('html').send(this._themedHtml(join(GUI_DIR, 'index.html')));
            });
        }
    }

    /**
     * Map a request path to the exported HTML document backing it, or null when
     * the path is not a document (assets, missing routes — express.static and the
     * SPA fallback handle those). Resolved paths are confined to GUI_DIR.
     */
    _resolveHtml(urlPath) {
        const clean = decodeURIComponent(urlPath).replace(/^\/+/, '');
        const candidates = clean === '' ? ['index.html'] : clean.endsWith('.html') ? [clean] : [join(clean, 'index.html'), `${clean}.html`];

        for (const candidate of candidates) {
            const full = normalize(join(GUI_DIR, candidate));
            if (full !== GUI_DIR && !full.startsWith(GUI_DIR + sep)) continue; // traversal guard
            if (existsSync(full)) return full;
        }
        return null;
    }

    /** Read-through cache of theme-stamped documents; the theme is fixed per process. */
    _themedHtml(file) {
        const cached = this._htmlCache.get(file);
        if (cached !== undefined) return cached;

        let html = readFileSync(file, 'utf8');
        html = html.replace(/<html\b([^>]*)>/i, (match, attrs) => {
            const stripped = attrs.replace(/\sdata-theme=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
            return `<html${stripped} data-theme="${this.guiTheme}">`;
        });

        this._htmlCache.set(file, html);
        return html;
    }

    _mountErrorHandler() {
        this.app.use((req, res) => {
            res.status(404).json({ error: true, code: 'API::NOT-FOUND', message: 'Unknown endpoint' });
        });

        // eslint-disable-next-line no-unused-vars
        this.app.use((err, req, res, next) => {
            if (err instanceof AdminError) {
                return res.status(err.status).json({ error: true, code: err.code, message: err.message });
            }
            // MailingError carries the same shape without importing the mailing
            // plane here — it is optional, and the error handler must work
            // whether or not it was loaded.
            if (err?.code?.startsWith?.('MAILING::') && Number.isInteger(err.status)) {
                return res.status(err.status).json({ error: true, code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
            }
            if (err?.type === 'entity.too.large') {
                return res.status(413).json({ error: true, code: 'API::BODY-TOO-LARGE', message: 'The uploaded body exceeds the size limit for this endpoint' });
            }
            if (err?.type === 'entity.parse.failed') {
                return res.status(400).json({ error: true, code: 'API::BAD-BODY', message: 'Malformed request body' });
            }
            logger.error(`AdminServer: unhandled error on ${req.method} ${req.originalUrl} — ${err.message}`);
            this._audit(req, 'api:error', req.originalUrl, 'error', 500, { message: err.message });
            res.status(500).json({ error: true, code: 'API::INTERNAL', message: 'Internal error' });
        });
    }
}

export { AdminServer, SESSION_COOKIE };
