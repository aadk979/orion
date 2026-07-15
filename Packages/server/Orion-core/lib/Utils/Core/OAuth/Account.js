import { UserModel, UserProviderModel } from '../../Databases/models/index.js';
import { generateUID } from '../../valueGenerator.js';
import { requestContext } from '../../../Server/Middleware/requestMetadata.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';
import { logger } from '../../logger.js';
import { SafeModuleHandler } from '../../UnavailableModuleWrapper.js';

const systemConfigModule = new SafeModuleHandler('SystemConfig', 'systemConfig', 'Account.js');


/**
 * Check if an account exists for the given email.
 */
const accountExist = async email => {
    const user = await UserModel.getUserByEmail(email);
    if (!user) {
        return { error: false, userExist: false };
    }
    return { error: false, userExist: true, uid: user.uid };
};

/**
 * If the user already has an account, ensure the OAuth provider is linked.
 */
const checkAndAddProviderToAccount = async (email, providerName) => {
    const Function = async parameters => {
        const user = await UserModel.getUserByEmail(parameters.email);

        if (!user) {
            return { error: true, errorCode: 'OAUTH::ACCOUNT-NOT-FOUND::A::p' };
        }

        const hasProvider = await UserProviderModel.hasProvider(user.uid, parameters.providerName);

        if (!hasProvider) {
            await UserProviderModel.addProvider(user.uid, parameters.providerName);
        }

        return { error: false, uid: user.uid };
    };

    const parameters = { email, providerName };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'checkAndAddProviderToAccount', functionSource);
};

/**
 * Create a new account for a user that signed up via an OAuth provider.
 */
const createAccountWithProvider = async (email, providerName) => {
    const Function = async parameters => {
        const systemConfig = systemConfigModule.getModule();
        const uid = generateUID(parameters.email);

        const createResult = await UserModel.createUser({
            uid,
            email: parameters.email,
            passwordHash: null,
            role: 'USER'
        });

        if (createResult.error) {
            return { error: true, errorCode: 'OAUTH::CREATE-ACCOUNT-FAILED::A::i' };
        }

        await UserProviderModel.addProvider(uid, parameters.providerName);

        try {
            systemConfig?.utilities?.onUserCreation(parameters.email, uid);
        } catch (e) {
            logger.error('An error occurred in the onUserCreation callback: ' + e);
        }

        return { error: false, uid };
    };

    const parameters = { email, providerName };
    const functionSource = fileURLToPath(import.meta.url);
    return await tryCatch(Function, true, parameters, 'createAccountWithProvider', functionSource);
};

export { accountExist, checkAndAddProviderToAccount, createAccountWithProvider };
