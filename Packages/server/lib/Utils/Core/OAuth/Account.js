import { globalAccessPoint } from "../../GlobalAccessPoint.js"
import { tryCatch } from "../../TryCatch.js";
import { generateUID } from "../../valueGenerator.js";

const accountExist = async (email) => {
    const Function = async (parameters) => {
        const user = await globalAccessPoint.db().getData("Users-email", parameters.email); // ← added await

        if (!user || user.data === undefined) {
            return { error: false, userExist: false };
        }

        return { error: false, userExist: true, uid: user.data.uid };
    };

    const parameters = { email };
    return await tryCatch(Function, true, parameters);
};

const checkAndAddProviderToAccount = async (email, provider) => {
    const Function = async (parameters) => {
        let userLink = await globalAccessPoint.db().getData("Users-email", parameters.email);
        let user = await globalAccessPoint.db().getData("Users", userLink.data.uid);

        if (user.data.credentials.providers.includes(parameters.provider.toUpperCase())) {
            return { error: false, complete: true, uid: userLink.data.uid }
        }

        user.data.credentials.providers.push(parameters.provider.trim().toUpperCase());

        await globalAccessPoint.db().addData("Users", userLink.data.uid, user.data);

        return { error: false, complete: true, uid: userLink.data.uid }
    }

    const parameters = {
        email,
        provider
    }

    return await tryCatch(Function, true, parameters);
}

const createAccountWithProvider = async (email, provider) => {
    const Function = async (parameters) => {
        const uid = generateUID(parameters.email);

        const userObject = {
            role: "USER",
            credentials: {
                password: false,
                passkey: {
                    exist: false
                },
                uid: uid,
                providers: [
                    parameters.provider.trim().toUpperCase()
                ],
                email: parameters.email
            },
            security: {
                emailVerified: false,
                activeTokens: [

                ],
                twoFA: {
                    enabled: false
                },
                methods: [

                ],
                recognizedDevices: [
                    
                ]
            },
            profile: {
                fields: [

                ]
            },
            customData: {

            }
        }

        const userLinkObject = {
            email: parameters.email,
            uid: uid
        }

        const userStorage = await globalAccessPoint.db().addData("Users" , uid , userObject);
        const userLinkStorage = await globalAccessPoint.db().addData("Users-email" , parameters.email , userLinkObject);

        if(userStorage.error || userLinkStorage.error){
            return { error: true , errorCode: "ACC-REG-UNABLE-TO-CREATE-ACC" }
        }

        return { error: false, complete: true, uid }
    }

    const parameters = {
        email,
        provider
    }

    return await tryCatch(Function, true, parameters);
}

export { createAccountWithProvider, checkAndAddProviderToAccount, accountExist }