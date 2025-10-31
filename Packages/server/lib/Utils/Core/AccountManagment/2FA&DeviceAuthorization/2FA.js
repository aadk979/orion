// Module not implemented in current release but device authoirzation module will ensure security until then

import { globalAccessPoint } from "../../../GlobalAccessPoint";

const userRequires2FAByUser = (user) => {
    return !!user.security.twoFA;
};

const userRequires2FAByEmail = async (email) => {
    const userEmailLink = await globalAccessPoint.db().getData("Users-email", email);
    const user = await globalAccessPoint.db().getData("Users", userEmailLink.data.uid);

    return !!user.data.security.twoFA;
};

const userRequires2FAByUID = async (uid) => {
    const user = await globalAccessPoint.db().getData("Users", uid);

    return !!user.data.security.twoFA;
};

