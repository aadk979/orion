/**
 * This file contains all default endpoints that are added by the orion system.
 * You are highly discouraged from modifying this file as some client SDK's may rely on these if not properly modifed or maintained.
*/

const { routeHandlerCreateAccount } = require("../../Utils/Core/AccountManagment/CreateAccount");
const { routeHandlerSignInWithPassword } = require("../../Utils/Core/AccountManagment/SignIn");
const { globalAccessPoint } = require("../../Utils/GlobalAccessPoint");

const name = "point-break";

const defaultServerRoutes = {
    endpoints: [
        {
            path: `/${name}/api/v1/action/register-user`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerCreateAccount
        },
        {
            path: `/${name}/api/v1/action/sign-in-user`,
            requireAuth: false,
            method: "POST",
            callback: routeHandlerSignInWithPassword
        },
    ]
}

module.exports = { defaultServerRoutes }