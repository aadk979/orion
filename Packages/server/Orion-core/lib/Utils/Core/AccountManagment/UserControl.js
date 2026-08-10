import { hashString } from '../../CryptoFunctions.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel } from '../../Databases/models/index.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';
import { emitRoleChange, emitAccountDisabled, emitCredentialChange, CredentialTypes, ChangeTypes } from '../SharedSignals/emitters.js';

const auditTrailSystemModule = new SafeModuleHandler('AuditTrailSystem', 'auditTrailSystem', 'UserControl.js');

class OrionUserControl {
    constructor() {
        if (OrionUserControl.instance) {
            throw new Error('Only one instance of orion user control is allowed');
        }

        OrionUserControl.instance = this;
    }

    checkUserExist() {
        const byEmail = async email => {
            const auditTrail = auditTrailSystemModule.getModule();

            if (!email) {
                auditTrail.record({
                    user: {},
                    device: {},
                    action: 'USER_EXISTENCE_CHECK_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'checkUserExist.byEmail',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User existence check failed - no email provided',
                    metadata: { reason: 'NO_EMAIL_PROVIDED' },
                    errorCode: 'USER-CONTROL::NO-EMAIL-PROVIDED::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-EMAIL-PROVIDED::A::p' };
            }

            const exists = await UserModel.emailExists(email);

            if (!exists) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: 'USER_EXISTENCE_CHECK',
                    status: 'SUCCESS',
                    source: 'UserControl.js',
                    functionName: 'checkUserExist.byEmail',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User existence check completed - user does not exist',
                    metadata: { email: email, exists: false }
                });
                return { error: false, exist: false };
            }

            const uid = await UserModel.getUidByEmail(email);

            auditTrail.record({
                user: { email: email, uid },
                device: {},
                action: 'USER_EXISTENCE_CHECK',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'checkUserExist.byEmail',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User existence check completed - user exists',
                metadata: { email: email, uid, exists: true }
            });

            return { error: false, exist: true };
        };

        const byUid = async uid => {
            const auditTrail = auditTrailSystemModule.getModule();

            if (!uid) {
                auditTrail.record({
                    user: {},
                    device: {},
                    action: 'USER_EXISTENCE_CHECK_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'checkUserExist.byUid',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User existence check failed - no UID provided',
                    metadata: { reason: 'NO_UID_PROVIDED' },
                    errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p' };
            }

            const user = await UserModel.getUserByUid(uid);

            if (!user) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: 'USER_EXISTENCE_CHECK',
                    status: 'SUCCESS',
                    source: 'UserControl.js',
                    functionName: 'checkUserExist.byUid',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User existence check completed - user does not exist',
                    metadata: { uid: uid, exists: false }
                });
                return { error: false, exist: false };
            }

            auditTrail.record({
                user: { email: user.email, uid: uid },
                device: {},
                action: 'USER_EXISTENCE_CHECK',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'checkUserExist.byUid',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User existence check completed - user exists',
                metadata: { uid: uid, email: user.email, exists: true }
            });

            return { error: false, exist: true };
        };

        return { byEmail, byUid };
    }

    disableUserAccount() {
        const byUid = async uid => {
            const auditTrail = auditTrailSystemModule.getModule();

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: 'USER_ACCOUNT_DISABLE_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'disableUserAccount.byUid',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User account disable failed - user does not exist',
                    metadata: { uid: uid, reason: 'USER_NOT_FOUND' },
                    errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
            }

            const user = await UserModel.getUserByUid(uid);
            await UserModel.setDisabled(uid, true);

            // Disabling ends every session. Receivers must hear that, or a
            // disabled account keeps working downstream until its tokens age out.
            emitAccountDisabled({ uid, reason: 'account disabled' });

            auditTrail.record({
                user: { email: user?.email, uid: uid },
                device: {},
                action: 'USER_ACCOUNT_DISABLED',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'disableUserAccount.byUid',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User account has been disabled',
                metadata: { uid: uid, email: user?.email, disabled: true }
            });

            return { error: false, disabled: true };
        };

        const byEmail = async email => {
            const auditTrail = auditTrailSystemModule.getModule();

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: 'USER_ACCOUNT_DISABLE_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'disableUserAccount.byEmail',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User account disable failed - user does not exist',
                    metadata: { email: email, reason: 'USER_NOT_FOUND' },
                    errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
            }

            const uid = await UserModel.getUidByEmail(email);
            await UserModel.setDisabled(uid, true);

            // Same reasoning as the byUid path above — both entry points reach
            // the same state and must transmit the same fact.
            emitAccountDisabled({ uid, reason: 'account disabled' });

            auditTrail.record({
                user: { email: email, uid },
                device: {},
                action: 'USER_ACCOUNT_DISABLED',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'disableUserAccount.byEmail',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User account has been disabled',
                metadata: { uid, email: email, disabled: true }
            });

            return { error: false, disabled: true };
        };

        return { byEmail, byUid };
    }

    enableUserAccount() {
        const byUid = async uid => {
            const auditTrail = auditTrailSystemModule.getModule();

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: 'USER_ACCOUNT_ENABLE_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'enableUserAccount.byUid',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User account enable failed - user does not exist',
                    metadata: { uid: uid, reason: 'USER_NOT_FOUND' },
                    errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
            }

            const user = await UserModel.getUserByUid(uid);
            await UserModel.setDisabled(uid, false);

            auditTrail.record({
                user: { email: user?.email, uid: uid },
                device: {},
                action: 'USER_ACCOUNT_ENABLED',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'enableUserAccount.byUid',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User account has been enabled',
                metadata: { uid: uid, email: user?.email, disabled: false }
            });

            return { error: false, enabled: true };
        };

        const byEmail = async email => {
            const auditTrail = auditTrailSystemModule.getModule();

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: 'USER_ACCOUNT_ENABLE_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'enableUserAccount.byEmail',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User account enable failed - user does not exist',
                    metadata: { email: email, reason: 'USER_NOT_FOUND' },
                    errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
            }

            const uid = await UserModel.getUidByEmail(email);
            await UserModel.setDisabled(uid, false);

            auditTrail.record({
                user: { email: email, uid },
                device: {},
                action: 'USER_ACCOUNT_ENABLED',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'enableUserAccount.byEmail',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User account has been enabled',
                metadata: { uid, email: email, disabled: false }
            });

            return { error: false, enabled: true };
        };

        return { byEmail, byUid };
    }

    getUserAccountState() {
        const byUid = async uid => {
            const auditTrail = auditTrailSystemModule.getModule();

            const user = await UserModel.getUserByUid(uid);

            if (!user) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: 'USER_ACCOUNT_STATE_CHECK_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'getUserAccountState.byUid',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User account state check failed - user does not exist',
                    metadata: { uid: uid, reason: 'USER_NOT_FOUND' },
                    errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
            }

            auditTrail.record({
                user: { email: user.email, uid: uid },
                device: {},
                action: 'USER_ACCOUNT_STATE_CHECK',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'getUserAccountState.byUid',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User account state retrieved',
                metadata: { uid: uid, email: user.email, disabled: user.disabled }
            });

            return { error: false, disabled: user.disabled };
        };

        const byEmail = async email => {
            const auditTrail = auditTrailSystemModule.getModule();

            const user = await UserModel.getUserByEmail(email);

            if (!user) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: 'USER_ACCOUNT_STATE_CHECK_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'getUserAccountState.byEmail',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User account state check failed - user does not exist',
                    metadata: { email: email, reason: 'USER_NOT_FOUND' },
                    errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
            }

            auditTrail.record({
                user: { email: email, uid: user.uid },
                device: {},
                action: 'USER_ACCOUNT_STATE_CHECK',
                status: 'SUCCESS',
                source: 'UserControl.js',
                functionName: 'getUserAccountState.byEmail',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User account state retrieved',
                metadata: { uid: user.uid, email: email, disabled: user.disabled }
            });

            return { error: false, disabled: user.disabled };
        };

        return { byEmail, byUid };
    }

    async getUserUidByEmail(email) {
        const auditTrail = auditTrailSystemModule.getModule();

        if (!email) {
            auditTrail.record({
                user: {},
                device: {},
                action: 'USER_UID_LOOKUP_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'getUserUidByEmail',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User UID lookup failed - no email provided',
                metadata: { reason: 'NO_EMAIL_PROVIDED' },
                errorCode: 'USER-CONTROL::NO-EMAIL-PROVIDED::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-EMAIL-PROVIDED::A::p' };
        }

        const uid = await UserModel.getUidByEmail(email);

        if (!uid) {
            auditTrail.record({
                user: { email: email },
                device: {},
                action: 'USER_UID_LOOKUP_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'getUserUidByEmail',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User UID lookup failed - user does not exist',
                metadata: { email: email, reason: 'USER_NOT_FOUND' },
                errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        auditTrail.record({
            user: { email: email, uid },
            device: {},
            action: 'USER_UID_LOOKUP',
            status: 'SUCCESS',
            source: 'UserControl.js',
            functionName: 'getUserUidByEmail',
            requestId: 'LOCAL-SYSTEM',
            ipAddress: 'LOCAL-SYSTEM',
            impact: 'User UID retrieved successfully',
            metadata: { email: email, uid }
        });

        return { error: false, uid };
    }

    async getUserEmailByUid(uid) {
        const auditTrail = auditTrailSystemModule.getModule();

        if (!uid) {
            auditTrail.record({
                user: {},
                device: {},
                action: 'USER_EMAIL_LOOKUP_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'getUserEmailByUid',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User email lookup failed - no UID provided',
                metadata: { reason: 'NO_UID_PROVIDED' },
                errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p' };
        }

        const user = await UserModel.getUserByUid(uid);

        if (!user) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: 'USER_EMAIL_LOOKUP_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'getUserEmailByUid',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User email lookup failed - user does not exist',
                metadata: { uid: uid, reason: 'USER_NOT_FOUND' },
                errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        auditTrail.record({
            user: { email: user.email, uid: uid },
            device: {},
            action: 'USER_EMAIL_LOOKUP',
            status: 'SUCCESS',
            source: 'UserControl.js',
            functionName: 'getUserEmailByUid',
            requestId: 'LOCAL-SYSTEM',
            ipAddress: 'LOCAL-SYSTEM',
            impact: 'User email retrieved successfully',
            metadata: { uid: uid, email: user.email }
        });

        return { error: false, email: user.email };
    }

    async updateUserRole(uid, role, customRolesAllowed) {
        const auditTrail = auditTrailSystemModule.getModule();
        const STANDARD_ROLES = ['USER', 'ADMIN'];

        if (!role) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: 'USER_ROLE_UPDATE_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'updateUserRole',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User role update failed - no role provided',
                metadata: { uid: uid, reason: 'NO_ROLE_PROVIDED' },
                errorCode: 'USER-CONTROL::NO-ROLE-PROVIDED::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-ROLE-PROVIDED::A::p' };
        }

        if (!uid) {
            auditTrail.record({
                user: {},
                device: {},
                action: 'USER_ROLE_UPDATE_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'updateUserRole',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User role update failed - no UID provided',
                metadata: { role: role, reason: 'NO_UID_PROVIDED' },
                errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p' };
        }

        if (!STANDARD_ROLES.includes(role.toUpperCase()) && !customRolesAllowed) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: 'USER_ROLE_UPDATE_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'updateUserRole',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User role update failed - not a standard role and custom roles not allowed',
                metadata: { uid: uid, role: role, reason: 'NOT_STANDARD_ROLE' },
                errorCode: 'USER-CONTROL::NOT-STANDARD-ROLE::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NOT-STANDARD-ROLE::A::p' };
        }

        if (customRolesAllowed) {
            const allowedRoles = globalAccessPoint.allowedUserRoles();

            if (!allowedRoles) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: 'USER_ROLE_UPDATE_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'updateUserRole',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User role update failed - custom roles allowed but not configured',
                    metadata: { uid: uid, role: role, reason: 'CUSTOM_ROLES_NOT_CONFIGURED' },
                    errorCode: 'USER-CONTROL::CUSTOM-ROLES-NOT-CONFIGURED::A::i'
                });
                return { error: true, errorCode: 'USER-CONTROL::CUSTOM-ROLES-NOT-CONFIGURED::A::i' };
            }

            if (!allowedRoles.includes(role.toUpperCase())) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: 'USER_ROLE_UPDATE_ATTEMPT',
                    status: 'FAILED',
                    source: 'UserControl.js',
                    functionName: 'updateUserRole',
                    requestId: 'LOCAL-SYSTEM',
                    ipAddress: 'LOCAL-SYSTEM',
                    impact: 'User role update failed - role not found in custom role configuration',
                    metadata: { uid: uid, role: role, allowedRoles: allowedRoles, reason: 'ROLE_NOT_IN_CONFIGURATION' },
                    errorCode: 'USER-CONTROL::ROLE-NOT-FOUND-IN-CONFIG::A::p'
                });
                return { error: true, errorCode: 'USER-CONTROL::ROLE-NOT-FOUND-IN-CONFIG::A::p' };
            }
        }

        const user = await UserModel.getUserByUid(uid);

        if (!user) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: 'USER_ROLE_UPDATE_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'updateUserRole',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User role update failed - user does not exist',
                metadata: { uid: uid, role: role, reason: 'USER_NOT_FOUND' },
                errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        const previousRole = user.role;
        await UserModel.updateRole(uid, role.toUpperCase());

        // Tell receivers the claim changed. Without this a downstream service
        // keeps authorizing on the role baked into a token it already holds,
        // for as long as that token lives — a demotion that does not take
        // effect anywhere but here.
        emitRoleChange({ uid, role: role.toUpperCase(), reason: `role changed from ${previousRole}` });

        auditTrail.record({
            user: { email: user.email, uid: uid },
            device: {},
            action: 'USER_ROLE_UPDATED',
            status: 'SUCCESS',
            source: 'UserControl.js',
            functionName: 'updateUserRole',
            requestId: 'LOCAL-SYSTEM',
            ipAddress: 'LOCAL-SYSTEM',
            impact: 'User role has been updated',
            metadata: {
                uid: uid,
                email: user.email,
                previousRole: previousRole,
                newRole: role.toUpperCase(),
                customRolesAllowed: customRolesAllowed
            }
        });

        return { error: false, updated: true };
    }

    async updateUserPassword(uid, newPassword) {
        const auditTrail = auditTrailSystemModule.getModule();

        if (!uid) {
            auditTrail.record({
                user: {},
                device: {},
                action: 'USER_PASSWORD_UPDATE_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'updateUserPassword',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User password update failed - no UID provided',
                metadata: { reason: 'NO_UID_PROVIDED' },
                errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-UID-PROVIDED::A::p' };
        }

        if (!newPassword) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: 'USER_PASSWORD_UPDATE_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'updateUserPassword',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User password update failed - no password provided',
                metadata: { uid: uid, reason: 'NO_PASSWORD_PROVIDED' },
                errorCode: 'USER-CONTROL::NO-PASSWORD-PROVIDED::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-PASSWORD-PROVIDED::A::p' };
        }

        const user = await UserModel.getUserByUid(uid);

        if (!user) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: 'USER_PASSWORD_UPDATE_ATTEMPT',
                status: 'FAILED',
                source: 'UserControl.js',
                functionName: 'updateUserPassword',
                requestId: 'LOCAL-SYSTEM',
                ipAddress: 'LOCAL-SYSTEM',
                impact: 'User password update failed - user does not exist',
                metadata: { uid: uid, reason: 'USER_NOT_FOUND' },
                errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p'
            });
            return { error: true, errorCode: 'USER-CONTROL::NO-SUCH-USER::A::p' };
        }

        const newPasswordHash = await hashString(newPassword);
        await UserModel.updatePassword(uid, newPasswordHash);

        emitCredentialChange({
            uid,
            credentialType: CredentialTypes.PASSWORD,
            changeType: ChangeTypes.UPDATE,
            reason: 'password changed'
        });

        auditTrail.record({
            user: { email: user.email, uid: uid },
            device: {},
            action: 'USER_PASSWORD_UPDATED',
            status: 'SUCCESS',
            source: 'UserControl.js',
            functionName: 'updateUserPassword',
            requestId: 'LOCAL-SYSTEM',
            ipAddress: 'LOCAL-SYSTEM',
            impact: 'User password has been updated',
            metadata: { uid: uid, email: user.email }
        });

        return { error: false, updated: true };
    }
}

const userControl = new OrionUserControl();

export { userControl };
