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
            if (!email) {
                return { error: true, errorCode: "USER-CONTROL-NO-EMAIL-PROVIDED" }
            }

            const user = await globalAccessPoint.db().getData("Users-email", email);

            if (!user.data) {
                return { error: false, exist: false }
            }

            return { error: false, exist: true }
        }

        const byUid = async (uid) => {
            if (!uid) {
                return { error: true, errorCode: "USER-CONTROL-NO-UID-PROVIDED" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            if (!user.data) {
                return { error: false, exist: false }
            }

            return { error: false, exist: true }
        }

        return { byEmail, byUid }
    }

    disableUserAccount() {

        const byUid = async (uid) => {

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            user.data.disabled = true;

            await globalAccessPoint.db().addData("Users", uid, user.data);

            return { error: false, disabled: true };
        }

        const byEmail = async (email) => {

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const userLink = await globalAccessPoint.db().getData("Users-email", email);

            const user = await globalAccessPoint.db().getData("Users", userLink.data.uid);

            user.data.disabled = true;

            await globalAccessPoint.db().addData("Users", userLink.data.uid, user.data);

            return { error: false, disabled: true };
        }

        return { byEmail, byUid }

    }

    enableUserAccount() {

        const byUid = async (uid) => {

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            user.data.disabled = false;

            await globalAccessPoint.db().addData("Users", uid, user.data);

            return { error: false, enabled: true };
        }

        const byEmail = async (email) => {

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const userLink = await globalAccessPoint.db().getData("Users-email", email);

            const user = await globalAccessPoint.db().getData("Users", userLink.data.uid);

            user.data.disabled = false;

            await globalAccessPoint.db().addData("Users", userLink.data.uid, user.data);

            return { error: false, enabled: true };
        }

        return { byEmail, byUid }

    }

    getUserAccountState() {

        const byUid = async (uid) => {

            const userExist = await this.checkUserExist().byUid(uid);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const user = await globalAccessPoint.db().getData("Users", uid);

            return { error: false, disabled: user.data.disabled };
        }

        const byEmail = async (email) => {

            const userExist = await this.checkUserExist().byEmail(email);

            if (userExist.error) {
                return userExist;
            }

            if (!userExist.exist) {
                return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
            }

            const userLink = await globalAccessPoint.db().getData("Users-email", email);

            const user = await globalAccessPoint.db().getData("Users", userLink.data.uid);

            return { error: false, disabled: user.data.disabled };
        }

        return { byEmail, byUid }
    }

    async getUserUidByEmail (email) {

        if (!email) {
            return { error: true, errorCode: "USER-CONTROL-NO-EMAIL-PROVIDED" }
        }

        const user = await globalAccessPoint.db().getData("Users-email", email);

        if (!user.data) {
            return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
        }

        return { error: false, uid: user.data.uid }
    }

    async getUserEmailByUid (uid) {

        if (!uid) {
            return { error: true, errorCode: "USER-CONTROL-NO-UID-PROVIDED" }
        }

        const user = await globalAccessPoint.db().getData("Users", uid);

        if (!user.data) {
            return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
        }

        return { error: false, email: user.data.credentials.email }
    }

    async updateUserRole(uid, role, customRolesAllowed) {

        const STANDARD_ROLES = [ "USER", "ADMIN" ]

        if (!role) {
            return { error: true, errorCode: "USER-CONTROL-NO-USER-ROLE-PROVIDED" }
        }

        if (!uid) {
            return { error: true, errorCode: "USER-CONTROL-NO-UID-PROVIDED" }
        }

        if (!STANDARD_ROLES.includes(role.toUpperCase()) && !customRolesAllowed) {
            return { error: true, errorCode: "USER-CONTROL-NOT-STANDARD-ROLE" }
        }

        if (customRolesAllowed) {

            const allowedRoles = globalAccessPoint.getValue("allowedUserRoles");

            if (!allowedRoles) {
                return { error: true, errorCode: "USER-CONTROL-CUSTOM-ROLES-ALLOWED-BUT-NOT-CONFIGURED" }
            }

            if (!allowedRoles.includes(role.toUpperCase())) {
                return { error: true, errorCode: "USER-CONTROL-ROLE-NOT-FOUND-IN-CUSTOM-ROLE-CONFIGURATION" }
            }

        }

        const userExist = await this.checkUserExist().byUid(uid);

        if (userExist.error) {
            return userExist;
        }

        if (!userExist.exist) {
            return { error: true, errorCode: "USER-CONTROL-NO-SUCH-USER" }
        }

        const user = await globalAccessPoint.db().getData("Users", uid);

        user.data.role = role.toUpperCase();

        await globalAccessPoint.db().addData("Users", uid, user.data);

        return { error: false, updated: true }
    }
}

const userControl = new OrionUserControl();

export { userControl }