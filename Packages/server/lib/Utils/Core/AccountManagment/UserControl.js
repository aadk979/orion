import { hashString } from "../../CryptoFunctions.js";
import { globalAccessPoint } from "../../GlobalAccessPoint.js";

class OrionUserControl {

    constructor () {

        if (OrionUserControl.instance) {
            throw new Error("Only one instance of orion user control is allowed")
        }

        OrionUserControl.instance = this;
    }

    checkUserExist() {

        const byEmail = async (email) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
            
            if (!email) {
                auditTrail.record({
                    user: {},
                    device: {},
                    action: "USER_EXISTENCE_CHECK_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "checkUserExist.byEmail",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User existence check failed - no email provided",
                    metadata: { reason: "NO_EMAIL_PROVIDED" },
                    errorCode: "USER-CONTROL-NO-EMAIL-PROVIDED"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-EMAIL-PROVIDED" }
            }

            const user = await globalAccessPoint.db().getData("Users-email", email);

            if (!user.data) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: "USER_EXISTENCE_CHECK",
                    status: "SUCCESS",
                    source: "UserControl.js",
                    functionName: "checkUserExist.byEmail",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User existence check completed - user does not exist",
                    metadata: { email: email, exists: false }
                });
                return { error: false, exist: false }
            }

            auditTrail.record({
                user: { email: email, uid: user.data.uid },
                device: {},
                action: "USER_EXISTENCE_CHECK",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "checkUserExist.byEmail",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User existence check completed - user exists",
                metadata: { email: email, uid: user.data.uid, exists: true }
            });

            return { error: false, exist: true }
        }

        const byUid = async (uid) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
            
            if (!uid) {
                auditTrail.record({
                    user: {},
                    device: {},
                    action: "USER_EXISTENCE_CHECK_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "checkUserExist.byUid",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User existence check failed - no UID provided",
                    metadata: { reason: "NO_UID_PROVIDED" },
                    errorCode: "USER-CONTROL-NO-UID-PROVIDED"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-UID-PROVIDED" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            if (!user.data) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: "USER_EXISTENCE_CHECK",
                    status: "SUCCESS",
                    source: "UserControl.js",
                    functionName: "checkUserExist.byUid",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User existence check completed - user does not exist",
                    metadata: { uid: uid, exists: false }
                });
                return { error: false, exist: false }
            }

            auditTrail.record({
                user: { email: user.data.credentials?.email, uid: uid },
                device: {},
                action: "USER_EXISTENCE_CHECK",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "checkUserExist.byUid",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User existence check completed - user exists",
                metadata: { uid: uid, email: user.data.credentials?.email, exists: true }
            });

            return { error: false, exist: true }
        }

        return { byEmail, byUid }
    }

    disableUserAccount() {

        const byUid = async (uid) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: "USER_ACCOUNT_DISABLE_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "disableUserAccount.byUid",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User account disable failed - user does not exist",
                    metadata: { uid: uid, reason: "USER_NOT_FOUND" },
                    errorCode: "USER-CONTROL-NO-SUCH-USER"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            user.data.disabled = true;

            await globalAccessPoint.db().addData("Users", uid, user.data);

            auditTrail.record({
                user: { email: user.data.credentials?.email, uid: uid },
                device: {},
                action: "USER_ACCOUNT_DISABLED",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "disableUserAccount.byUid",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User account has been disabled",
                metadata: { uid: uid, email: user.data.credentials?.email, disabled: true }
            });

            return { error: false, disabled: true };
        }

        const byEmail = async (email) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: "USER_ACCOUNT_DISABLE_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "disableUserAccount.byEmail",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User account disable failed - user does not exist",
                    metadata: { email: email, reason: "USER_NOT_FOUND" },
                    errorCode: "USER-CONTROL-NO-SUCH-USER"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const userLink = await globalAccessPoint.db().getData("Users-email", email);

            const user = await globalAccessPoint.db().getData("Users", userLink.data.uid);

            user.data.disabled = true;

            await globalAccessPoint.db().addData("Users", userLink.data.uid, user.data);

            auditTrail.record({
                user: { email: email, uid: userLink.data.uid },
                device: {},
                action: "USER_ACCOUNT_DISABLED",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "disableUserAccount.byEmail",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User account has been disabled",
                metadata: { uid: userLink.data.uid, email: email, disabled: true }
            });

            return { error: false, disabled: true };
        }

        return { byEmail, byUid }

    }

    enableUserAccount() {

        const byUid = async (uid) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: "USER_ACCOUNT_ENABLE_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "enableUserAccount.byUid",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User account enable failed - user does not exist",
                    metadata: { uid: uid, reason: "USER_NOT_FOUND" },
                    errorCode: "USER-CONTROL-NO-SUCH-USER"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            user.data.disabled = false;

            await globalAccessPoint.db().addData("Users", uid, user.data);

            auditTrail.record({
                user: { email: user.data.credentials?.email, uid: uid },
                device: {},
                action: "USER_ACCOUNT_ENABLED",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "enableUserAccount.byUid",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User account has been enabled",
                metadata: { uid: uid, email: user.data.credentials?.email, disabled: false }
            });

            return { error: false, enabled: true };
        }

        const byEmail = async (email) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: "USER_ACCOUNT_ENABLE_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "enableUserAccount.byEmail",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User account enable failed - user does not exist",
                    metadata: { email: email, reason: "USER_NOT_FOUND" },
                    errorCode: "USER-CONTROL-NO-SUCH-USER"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const userLink = await globalAccessPoint.db().getData("Users-email", email);

            const user = await globalAccessPoint.db().getData("Users", userLink.data.uid);

            user.data.disabled = false;

            await globalAccessPoint.db().addData("Users", userLink.data.uid, user.data);

            auditTrail.record({
                user: { email: email, uid: userLink.data.uid },
                device: {},
                action: "USER_ACCOUNT_ENABLED",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "enableUserAccount.byEmail",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User account has been enabled",
                metadata: { uid: userLink.data.uid, email: email, disabled: false }
            });

            return { error: false, enabled: true };
        }

        return { byEmail, byUid }

    }

    getUserAccountState() {

        const byUid = async (uid) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: "USER_ACCOUNT_STATE_CHECK_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "getUserAccountState.byUid",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User account state check failed - user does not exist",
                    metadata: { uid: uid, reason: "USER_NOT_FOUND" },
                    errorCode: "USER-CONTROL-NO-SUCH-USER"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            auditTrail.record({
                user: { email: user.data.credentials?.email, uid: uid },
                device: {},
                action: "USER_ACCOUNT_STATE_CHECK",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "getUserAccountState.byUid",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User account state retrieved",
                metadata: { uid: uid, email: user.data.credentials?.email, disabled: user.data.disabled }
            });

            return { error: false, disabled: user.data.disabled };
        }

        const byEmail = async (email) => {
            const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                auditTrail.record({
                    user: { email: email },
                    device: {},
                    action: "USER_ACCOUNT_STATE_CHECK_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "getUserAccountState.byEmail",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User account state check failed - user does not exist",
                    metadata: { email: email, reason: "USER_NOT_FOUND" },
                    errorCode: "USER-CONTROL-NO-SUCH-USER"
                });
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const userLink = await globalAccessPoint.db().getData("Users-email", email);

            const user = await globalAccessPoint.db().getData("Users", userLink.data.uid);

            auditTrail.record({
                user: { email: email, uid: userLink.data.uid },
                device: {},
                action: "USER_ACCOUNT_STATE_CHECK",
                status: "SUCCESS",
                source: "UserControl.js",
                functionName: "getUserAccountState.byEmail",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User account state retrieved",
                metadata: { uid: userLink.data.uid, email: email, disabled: user.data.disabled }
            });

            return { error: false, disabled: user.data.disabled };
        }

        return { byEmail, byUid }
    }

    async getUserUidByEmail (email) {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

        if (!email) {
            auditTrail.record({
                user: {},
                device: {},
                action: "USER_UID_LOOKUP_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "getUserUidByEmail",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User UID lookup failed - no email provided",
                metadata: { reason: "NO_EMAIL_PROVIDED" },
                errorCode: "USER-CONTROL-NO-EMAIL-PROVIDED"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-EMAIL-PROVIDED" }
        }

        const user = await globalAccessPoint.db().getData("Users-email", email);

        if (!user.data) {
            auditTrail.record({
                user: { email: email },
                device: {},
                action: "USER_UID_LOOKUP_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "getUserUidByEmail",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User UID lookup failed - user does not exist",
                metadata: { email: email, reason: "USER_NOT_FOUND" },
                errorCode: "USER-CONTROL-NO-SUCH-USER"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
        }

        auditTrail.record({
            user: { email: email, uid: user.data.uid },
            device: {},
            action: "USER_UID_LOOKUP",
            status: "SUCCESS",
            source: "UserControl.js",
            functionName: "getUserUidByEmail",
            requestId: "LOCAL-SYSTEM",
            ipAddress: "LOCAL-SYSTEM",
            impact: "User UID retrieved successfully",
            metadata: { email: email, uid: user.data.uid }
        });

        return { error: false, uid: user.data.uid }
    }

    async getUserEmailByUid (uid) {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

        if (!uid) {
            auditTrail.record({
                user: {},
                device: {},
                action: "USER_EMAIL_LOOKUP_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "getUserEmailByUid",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User email lookup failed - no UID provided",
                metadata: { reason: "NO_UID_PROVIDED" },
                errorCode: "USER-CONTROL-NO-UID-PROVIDED"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-UID-PROVIDED" }
        }

        const user = await globalAccessPoint.db().getData("Users", uid);

        if (!user.data) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: "USER_EMAIL_LOOKUP_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "getUserEmailByUid",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User email lookup failed - user does not exist",
                metadata: { uid: uid, reason: "USER_NOT_FOUND" },
                errorCode: "USER-CONTROL-NO-SUCH-USER"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
        }

        auditTrail.record({
            user: { email: user.data.credentials.email, uid: uid },
            device: {},
            action: "USER_EMAIL_LOOKUP",
            status: "SUCCESS",
            source: "UserControl.js",
            functionName: "getUserEmailByUid",
            requestId: "LOCAL-SYSTEM",
            ipAddress: "LOCAL-SYSTEM",
            impact: "User email retrieved successfully",
            metadata: { uid: uid, email: user.data.credentials.email }
        });

        return { error: false, email: user.data.credentials.email }
    }

    async updateUserRole(uid, role, customRolesAllowed) {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');
        const STANDARD_ROLES = [ "USER", "ADMIN" ]

        if (!role) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: "USER_ROLE_UPDATE_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "updateUserRole",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User role update failed - no role provided",
                metadata: { uid: uid, reason: "NO_ROLE_PROVIDED" },
                errorCode: "USER-CONTROL-NO-USER-ROLE-PROVIDED"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-USER-ROLE-PROVIDED" }
        }

        if (!uid) {
            auditTrail.record({
                user: {},
                device: {},
                action: "USER_ROLE_UPDATE_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "updateUserRole",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User role update failed - no UID provided",
                metadata: { role: role, reason: "NO_UID_PROVIDED" },
                errorCode: "USER-CONTROL-NO-UID-PROVIDED"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-UID-PROVIDED" }
        }

        if (!STANDARD_ROLES.includes(role.toUpperCase()) && !customRolesAllowed) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: "USER_ROLE_UPDATE_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "updateUserRole",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User role update failed - not a standard role and custom roles not allowed",
                metadata: { uid: uid, role: role, reason: "NOT_STANDARD_ROLE" },
                errorCode: "USER-CONTROL-NOT-STANDARD-ROLE"
            });
            return { error: true, errorCode: "USER-CONTROL-NOT-STANDARD-ROLE" }
        }

        if (customRolesAllowed) {

            const allowedRoles = globalAccessPoint.getValue("allowedUserRoles");

            if (!allowedRoles) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: "USER_ROLE_UPDATE_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "updateUserRole",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User role update failed - custom roles allowed but not configured",
                    metadata: { uid: uid, role: role, reason: "CUSTOM_ROLES_NOT_CONFIGURED" },
                    errorCode: "USER-CONTROL-CUSTOM-ROLES-ALLOWED-BUT-NOT-CONFIGURED"
                });
                return { error: true, errorCode: "USER-CONTROL-CUSTOM-ROLES-ALLOWED-BUT-NOT-CONFIGURED" }
            }

            if (!allowedRoles.includes(role.toUpperCase())) {
                auditTrail.record({
                    user: { uid: uid },
                    device: {},
                    action: "USER_ROLE_UPDATE_ATTEMPT",
                    status: "FAILED",
                    source: "UserControl.js",
                    functionName: "updateUserRole",
                    requestId: "LOCAL-SYSTEM",
                    ipAddress: "LOCAL-SYSTEM",
                    impact: "User role update failed - role not found in custom role configuration",
                    metadata: { uid: uid, role: role, allowedRoles: allowedRoles, reason: "ROLE_NOT_IN_CONFIGURATION" },
                    errorCode: "USER-CONTROL-ROLE-NOT-FOUND-IN-CUSTOM-ROLE-CONFIGURATION"
                });
                return { error: true, errorCode: "USER-CONTROL-ROLE-NOT-FOUND-IN-CUSTOM-ROLE-CONFIGURATION" }
            }

        }

        const userExist = await this.checkUserExist().byUid(uid);

        if (userExist.error) {
            return userExist;
        }

        if (!userExist.exist) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: "USER_ROLE_UPDATE_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "updateUserRole",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User role update failed - user does not exist",
                metadata: { uid: uid, role: role, reason: "USER_NOT_FOUND" },
                errorCode: "USER-CONTROL-NO-SUCH-USER"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
        }

        const user = await globalAccessPoint.db().getData("Users", uid);
        const previousRole = user.data.role;
        user.data.role = role.toUpperCase();

        await globalAccessPoint.db().addData("Users", uid, user.data);

        auditTrail.record({
            user: { email: user.data.credentials?.email, uid: uid },
            device: {},
            action: "USER_ROLE_UPDATED",
            status: "SUCCESS",
            source: "UserControl.js",
            functionName: "updateUserRole",
            requestId: "LOCAL-SYSTEM",
            ipAddress: "LOCAL-SYSTEM",
            impact: "User role has been updated",
            metadata: { 
                uid: uid, 
                email: user.data.credentials?.email,
                previousRole: previousRole,
                newRole: role.toUpperCase(),
                customRolesAllowed: customRolesAllowed
            }
        });

        return { error: false, updated: true }
    }

    async updateUserPassword(uid, newPassword) {
        const auditTrail = globalAccessPoint.getValue('auditTrailSystem');

        if (!uid) {
            auditTrail.record({
                user: {},
                device: {},
                action: "USER_PASSWORD_UPDATE_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "updateUserPassword",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User password update failed - no UID provided",
                metadata: { reason: "NO_UID_PROVIDED" },
                errorCode: "USER-CONTROL-NO-UID-PROVIDED"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-UID-PROVIDED" };
        }

        if (!newPassword) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: "USER_PASSWORD_UPDATE_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "updateUserPassword",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User password update failed - no password provided",
                metadata: { uid: uid, reason: "NO_PASSWORD_PROVIDED" },
                errorCode: "USER-CONTROL-NO-PASSWORD-PROVIDED"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-PASSWORD-PROVIDED" }
        }

        const userExist = await this.checkUserExist().byUid(uid);

        if (userExist.error) {
            return userExist;
        }

        if (!userExist.exist) {
            auditTrail.record({
                user: { uid: uid },
                device: {},
                action: "USER_PASSWORD_UPDATE_ATTEMPT",
                status: "FAILED",
                source: "UserControl.js",
                functionName: "updateUserPassword",
                requestId: "LOCAL-SYSTEM",
                ipAddress: "LOCAL-SYSTEM",
                impact: "User password update failed - user does not exist",
                metadata: { uid: uid, reason: "USER_NOT_FOUND" },
                errorCode: "USER-CONTROL-NO-SUCH-USER"
            });
            return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
        }

        let user = await globalAccessPoint.db().getData("Users", uid);

        const newPasswordHash = await hashString(newPassword);

        user.data.credentials.password = newPasswordHash;

        await globalAccessPoint.db().addData("Users", uid, user.data);

        auditTrail.record({
            user: { email: user.data.credentials?.email, uid: uid },
            device: {},
            action: "USER_PASSWORD_UPDATED",
            status: "SUCCESS",
            source: "UserControl.js",
            functionName: "updateUserPassword",
            requestId: "LOCAL-SYSTEM",
            ipAddress: "LOCAL-SYSTEM",
            impact: "User password has been updated",
            metadata: { uid: uid, email: user.data.credentials?.email }
        });

        return { error: false, updated: true };
    }
}

const userControl = new OrionUserControl();

export { userControl }