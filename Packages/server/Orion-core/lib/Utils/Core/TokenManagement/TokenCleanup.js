import { TokenModel } from '../../Databases/models/index.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';

export async function cleanUpTokens(uid) {
    const Function = async parameters => {
        await TokenModel.removeExpiredTokens(parameters.uid);
        return { error: false, completed: true };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);

    // Function is async: tryCatch must await it inside its own try block, otherwise a
    // rejected pool query escapes unlogged instead of returning a handled error object.
    return await tryCatch(Function, true, parameters, 'cleanUpTokens', functionSource);
}
