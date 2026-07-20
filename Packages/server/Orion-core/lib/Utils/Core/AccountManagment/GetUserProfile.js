import { respondWithError, respondWithSuccess } from '../../../Server/Response/response.js';
import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { UserModel, PasskeyModel, TOTPModel, DeviceModel, UserProviderModel } from '../../Databases/models/index.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';

const getUserProfile = async uid => {
    const Function = async parameters => {
        const user = await UserModel.getUserByUid(parameters.uid);

        if (!user) {
            return { error: true, errorCode: 'ACCOUNT-SIGNIN::ACCOUNT-NOT-FOUND::A::p' };
        }

        const hasPasskey = await PasskeyModel.hasPasskey(parameters.uid);
        const totpEnabled = await TOTPModel.isEnabled(parameters.uid);
        const deviceCount = await DeviceModel.getActiveDeviceCount(parameters.uid);
        const hasOAuth = await UserProviderModel.getProviders(parameters.uid);

        const profile = {
            email: user.email,
            security: {
                twoFA: hasPasskey || totpEnabled,
                passkey: {
                    enabled: hasPasskey
                },
                totp: {
                    enabled: totpEnabled
                },
                recognizedDevices: deviceCount
            },
            authMethods: {
                password: !!user.password_hash,
                oauth: hasOAuth.length > 0
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
