/**
 * Two-Factor Authentication (2FA) Module
 *
 * NOTE: This module is not fully implemented in the current release.
 * The device authorisation module provides security coverage until 2FA
 * implementation is complete.
 */

import { globalAccessPoint } from '../../../GlobalAccessPoint';

const userRequires2FAByUser = user => {
    return !!user.security.twoFA;
};

const userRequires2FAByEmail = async email => {
    const userEmailLink = await globalAccessPoint.db().getData('Users-email', email);
    const user = await globalAccessPoint.db().getData('Users', userEmailLink.data.uid);

    return !!user.data.security.twoFA;
};

const userRequires2FAByUID = async uid => {
    const user = await globalAccessPoint.db().getData('Users', uid);

    return !!user.data.security.twoFA;
};
