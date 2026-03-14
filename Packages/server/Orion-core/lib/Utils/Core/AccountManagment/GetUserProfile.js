import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';

const getUserProfile = async (uid) => {
    const Function = async (parameters) => {
        const user = await globalAccessPoint.db().getData('Users', parameters.uid);

        if (!user.data) {
            return { error: true, errorCode: 'ACC-SIGN-IN-ACC-NO-EXISTS' };
        }

        const profile = {
            email: user.data.email,
            security: {
                twoFA: !!user.data.security?.twoFA,
                passkey: {
                    enabled: !!user.data.credentials?.passkey?.exist
                },
                totp: {
                    enabled: !!user.data.credentials?.totp?.enabled
                },
                recognizedDevices: (user.data.security?.recognizedDevices || []).length
            },
            authMethods: {
                password: !!user.data.credentials?.password,
                oauth: !!user.data.credentials?.oauth
            }
        };

        return { error: false, profile };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'getUserProfile', functionSource);
};

const routeHandlerGetUserProfile = async (request, response) => {
    const uid = request.user.uid;

    const callback = await getUserProfile(uid);

    if (callback.error) {
        return respondWithError(response, callback.errorCode);
    }

    return respondWithSuccess(response, 200, callback.profile);
};

export { getUserProfile, routeHandlerGetUserProfile };
