import { routeHandlerCreateAccount } from '../../Utils/Core/AccountManagment/CreateAccount.js';
import { routeHandlerSignInWithPasskey } from '../../Utils/Core/AccountManagment/Passkeys/AuthFlows/SignInWithPasskey.js';
import { routeHandlerVerifyAndCompletePasskeyRegistration } from '../../Utils/Core/AccountManagment/Passkeys/completeRegistration.js';
import { routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser } from '../../Utils/Core/AccountManagment/Passkeys/generateAuthenticationOptions.js';
import { routeHandlerGeneratePasskeyRegistrationOptionsExistingUser } from '../../Utils/Core/AccountManagment/Passkeys/generateRegistrationOptions.js';
import { routeHandlerSignInWithPassword } from '../../Utils/Core/AccountManagment/SignIn.js';
import { routeHandlerSignOutUser } from '../../Utils/Core/AccountManagment/SignOutUser.js';
import { routeHandlerGenerateOAuthRedirectURL } from '../../Utils/Core/OAuth/GenerateRedirectURL.js';
import { routeHandlerHandleOAuthCallback } from '../../Utils/Core/OAuth/HandleOAuthCallback.js';
import { routeHandlerDeviceAuthorization } from '../../Utils/Core/SecurityManagment/DeviceAuthorization.js';
import { routeHandlerGenerateDipConfig } from '../../Utils/Core/SecurityManagment/Dip.js';
import { routeHandlerKeyRequest } from '../../Utils/Core/SecurityManagment/KeyRequest.js';
import {
    routeHandlerGenerateNoAuthTokenCreationTransaction,
    routeHandlerGenerateNoAuthToken,
    routeHandlerDeviceHasNoAuthToken
} from '../../Utils/Core/SecurityManagment/NoAuthToken.js';
import { routeHandlerInitiatePasswordReset, routeHandlerCompletePasswordReset } from '../../Utils/Core/AccountManagment/PasswordReset.js';
import { globalAccessPoint } from '../../Utils/GlobalAccessPoint.js';

const NAME_SPACE = globalAccessPoint.nameSpace();

const defaultServerRoutes = {
    endpoints: [
        {
            path: `/${NAME_SPACE}/api/v1/action/sign-up-user`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerCreateAccount
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/sign-in-user`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerSignInWithPassword
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/initiate-password-reset`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerInitiatePasswordReset
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/complete-password-reset`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerCompletePasswordReset
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/generate-no-auth-token-transaction`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerGenerateNoAuthTokenCreationTransaction
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/generate-no-auth-token`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerGenerateNoAuthToken
        },
        {
            path: `/${NAME_SPACE}/api/v1/request/have-no-auth-token`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerDeviceHasNoAuthToken
        },
        {
            path: `/${NAME_SPACE}/api/v1/request/encryption-request-key`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerKeyRequest
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/configure-dip`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerGenerateDipConfig
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/generate-passkey-registration-options`,
            requireAuth: true,
            method: 'POST',
            callback: routeHandlerGeneratePasskeyRegistrationOptionsExistingUser
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/complete-passkey-registration`,
            requireAuth: true,
            method: 'POST',
            callback: routeHandlerVerifyAndCompletePasskeyRegistration
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/generate-passkey-authentication-options`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/sign-in-with-passkey-authentication`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerSignInWithPasskey
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/sign-out-user`,
            requireAuth: true,
            method: 'POST',
            callback: routeHandlerSignOutUser
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/get-o-auth-redirect-url`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerGenerateOAuthRedirectURL
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/authorize-me`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerDeviceAuthorization
        },
        {
            path: `/${NAME_SPACE}/api/v1/action/handle-o-auth-callback`,
            requireAuth: false,
            method: 'POST',
            callback: routeHandlerHandleOAuthCallback
        }
    ]
};

export { defaultServerRoutes };
