import { globalAccessPoint } from '../../GlobalAccessPoint.js';
import { isUnixExpired } from '../../Date&Time.js';
import { tryCatch } from '../../TryCatch.js';
import { fileURLToPath } from 'url';

export async function cleanUpTokens(uid) {
    const Function = async (parameters) => {
        const data = await globalAccessPoint.db().getData('Users', parameters.uid);

        if (data.error || !data.data || !data.data.security) {
            return { error: false, completed: true, skipped: true };
        }

        const user = data.data;
        const activeTokens = user.security.activeTokens || [];

        let hasChanges = false;
        const validTokens = [];

        for (const tokenMeta of activeTokens) {
            if (isUnixExpired(tokenMeta.exp)) {
                // Delete the actual token document asynchronously
                globalAccessPoint.db().deleteData('Tokens', tokenMeta.tokenId).catch(() => { });
                hasChanges = true;
            } else {
                validTokens.push(tokenMeta);
            }
        }

        if (hasChanges) {
            user.security.activeTokens = validTokens;
            await globalAccessPoint.db().addData('Users', parameters.uid, user);
        }

        return { error: false, completed: true };
    };

    const parameters = { uid };
    const functionSource = fileURLToPath(import.meta.url);

    return await tryCatch(Function, false, parameters, 'cleanUpTokens', functionSource);
}
