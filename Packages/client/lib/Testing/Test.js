import { orion } from "../Root.js";
import { getAuthHeader } from "../Utils/Authorisation.js";

async function test() {
    const authHeader = await getAuthHeader(true, "ACCESS_BEARER")

    const request = await orion.Api.fetch("/custom-endpoint", "GET", head.authHead, null);
}

export { x }