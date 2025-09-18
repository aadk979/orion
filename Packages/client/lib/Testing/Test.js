import { orion } from "../Root.js";
import { getAuthHeader } from "../Utils/Authorisation.js";

async function x() {
    const authState = await orion.authState(async (activeSession) => {
        if (!activeSession) {
            await orion.signInUser("aadk979@gmail.com", "Amelie260908")
        }
        
        console.log("Signed In!");
    })
}

export { x }