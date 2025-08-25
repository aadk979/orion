import { ApiInterface } from "../Utils/Api.js";
import { checkAndDeployCaptcha } from "../Utils/Captcha.js";
import { orion } from "../Root.js";
import { getAuthHeader } from "../Utils/Authorisation.js";

async function x() {
    orion.initialize()
    /*const c = await orion.signInUser("tom@tmail.com" , "Amelie@260908");
    console.log(c); */

    const head = await getAuthHeader(false, "NO_AUTH_BEARER")

   // const x = await orion.Api.fetch("/p", "GET", head.authHead, null);


}

export { x }