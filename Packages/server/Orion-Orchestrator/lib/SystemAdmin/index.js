/**
 * System-admin plane exports (orion-orch/system-admin).
 *
 * Kept OUT of the package root export on purpose: importing these pulls in
 * pg/express/nodemailer, which deployments that never enable the admin plane
 * should not pay for. OrionOrchestrator loads this module dynamically when
 * `systemAdmin.enabled` is true.
 */

export { AdminDatabase } from './AdminDatabase.js';
export { SystemAdminService, AdminError, publicAdmin, DEFAULT_READ_ONLY_POLICY_ID } from './SystemAdminService.js';
export { AdminServer, SESSION_COOKIE } from './AdminServer.js';
export { AuditLog } from './AuditLog.js';
export { AdminMailer } from './AdminMailer.js';
export { SystemAdminModel, PolicyModel, GroupModel, MagicLinkModel, SessionModel } from './models.js';
export { evaluate, matchesPattern, validatePolicyDocument } from './PBACEngine.js';
export { AdminActions, commandAction, nodeResource, CLUSTER_RESOURCE } from './adminActions.js';
export { hashPassword, verifyPassword, generateToken, hashToken } from './authCrypto.js';
