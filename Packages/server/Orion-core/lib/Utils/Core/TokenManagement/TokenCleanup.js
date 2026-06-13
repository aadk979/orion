import { TokenModel } from '../../Databases/models/index.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';

export async function cleanUpTokens(uid) {
    const Function = async (parameters) => {
        await TokenModel.removeExpiredTokens(parameters.uid);
        return { error: false, completed: true };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);

    return await tryCatch(Function, false, parameters, 'cleanUpTokens', functionSource);
}
