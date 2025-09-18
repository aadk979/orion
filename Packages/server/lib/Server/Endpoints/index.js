/**
 * This file contains all default endpoints that are added by the orion system.
 * You are highly discouraged from modifying this file as some client SDK's may rely on these if not properly modifed or maintained.
*/

const { routeHandlerCreateAccount } = require("../../Utils/Core/AccountManagment/CreateAccount");
const { routeHandlerSignInWithPasskey } = require("../../Utils/Core/AccountManagment/Passkeys/AuthFlows/SignInWithPasskey");
const { routeHandlerVerifyAndCompletePasskeyRegistration } = require("../../Utils/Core/AccountManagment/Passkeys/completeRegistration");
const { routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser } = require("../../Utils/Core/AccountManagment/Passkeys/generateAuthenticationOptions");
const { routeHandlerGeneratePasskeyRegistrationOptionsExistingUser } = require("../../Utils/Core/AccountManagment/Passkeys/generateRegistrationOptions");
const { routeHandlerSignInWithPassword } = require("../../Utils/Core/AccountManagment/SignIn");
const { routeHandlerSignOutUser } = require("../../Utils/Core/AccountManagment/SignOutUser");
const { routeHandlerResetCookies } = require("../../Utils/Core/SecurityManagment/CookieReset");
const { routeHandlerGenerateDipConfig } = require("../../Utils/Core/SecurityManagment/Dip");
const { routeHandlerKeyRequest } = require("../../Utils/Core/SecurityManagment/KeyRequest");
const { routeHandlerGenerateNoAuthTokenCreationTransaction, routeHandlerGenerateNoAuthToken, routeHandlerDeviceHasNoAuthToken } = require("../../Utils/Core/SecurityManagment/NoAuthToken");

const NAME = "point-break";

const defaultServerRoutes = {
    endpoints: [
        {
            path: `/${NAME}/api/v1/action/sign-up-user`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerCreateAccount
        },
        {
            path: `/${NAME}/api/v1/action/sign-in-user`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerSignInWithPassword
        },
        {
            path: `/${NAME}/api/v1/action/generate-no-auth-token-transaction`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerGenerateNoAuthTokenCreationTransaction
        },
        {
            path: `/${NAME}/api/v1/action/generate-no-auth-token`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerGenerateNoAuthToken
        },
        {
            path: `/${NAME}/api/v1/request/have-no-auth-token`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerDeviceHasNoAuthToken
        },
        {
            path: `/${NAME}/api/v1/request/encryption-request-key`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerKeyRequest
        },
        {
            path: `/${NAME}/api/v1/action/configure-dip`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerGenerateDipConfig
        },
        {
            path: `/${NAME}/api/v1/action/generate-passkey-registration-options`,
            requireAuth: true,
            method: "POST",
            callback: routeHandlerGeneratePasskeyRegistrationOptionsExistingUser
        },
        {
            path: `/${NAME}/api/v1/action/complete-passkey-registration`,
            requireAuth: true,
            method: "POST",
            callback: routeHandlerVerifyAndCompletePasskeyRegistration
        },
        {
            path: `/${NAME}/api/v1/action/generate-passkey-authentication-options`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerGeneratePasskeyAuthenticationOptionsExistingUser
        },
        {
            path: `/${NAME}/api/v1/action/complete-passkey-authentication`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerSignInWithPasskey
        },
        {
            path: `/${NAME}/api/v1/action/sign-out-user`,
            requireAuth: true,
            method: "POST",
            callback: routeHandlerSignOutUser
        },
        {
            path: `/${NAME}/api/v1/action/reset-cookies`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerResetCookies
        }
    ]
}

module.exports = { defaultServerRoutes }